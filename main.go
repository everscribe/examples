// Demo backend for the Everscribe team-management example.
//
// Exposes a tiny in-memory team API that records every mutation as an
// audit event via sdk-go's Recorder, plus an embed-token endpoint that
// the React frontend uses to authenticate <AuditTrail />.
package main

import (
	"context"
	"embed"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"log"
	"log/slog"
	"net/http"
	"os"
	"sort"
	"strings"
	"sync"
	"time"

	everscribe "github.com/everscribe/sdk-go"
	"github.com/everscribe/sdk-go/pkg/event"
	"github.com/everscribe/sdk-go/pkg/minter"
	"github.com/everscribe/sdk-go/pkg/recorder"
	"github.com/fuskovic/env"
)

// staticFS holds the built React app. `npm run build` from web/ writes to
// web/dist, which is then baked into this binary.
//
//go:embed all:web/dist
var staticFS embed.FS

// User is a team member in the in-memory store.
type User struct {
	ID    string `json:"id"`
	Email string `json:"email"`
	Name  string `json:"name"`
	Role  string `json:"role"`
}

// store is a tiny thread-safe map of users keyed by id. Real code would
// use a database; this is just so the demo has something to mutate.
type store struct {
	mu    sync.Mutex
	users map[string]*User
	seq   int
}

func newStore() *store {
	s := &store{users: map[string]*User{}}
	// Seed a couple of users so the UI isn't empty on first load.
	s.create("ada@example.com", "Ada Lovelace", "admin")
	s.create("alan@example.com", "Alan Turing", "member")
	return s
}

func (s *store) create(email, name, role string) *User {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.seq++
	u := &User{ID: fmt.Sprintf("u_%03d", s.seq), Email: email, Name: name, Role: role}
	s.users[u.ID] = u
	return u
}

func (s *store) list() []*User {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]*User, 0, len(s.users))
	for _, u := range s.users {
		out = append(out, u)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ID < out[j].ID })
	return out
}

func (s *store) get(id string) (*User, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	u, ok := s.users[id]
	if !ok {
		return nil, false
	}
	clone := *u
	return &clone, true
}

func (s *store) updateRole(id, role string) (before, after *User, err error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	u, ok := s.users[id]
	if !ok {
		return nil, nil, errNotFound
	}
	b := *u
	u.Role = role
	a := *u
	return &b, &a, nil
}

func (s *store) remove(id string) (*User, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	u, ok := s.users[id]
	if !ok {
		return nil, errNotFound
	}
	delete(s.users, id)
	return u, nil
}

var errNotFound = errors.New("user not found")

func main() {
	cfg, err := loadConfig()
	if err != nil {
		log.Fatalf("config: %v", err)
	}

	es, err := everscribe.New(cfg.ProjectID, cfg.APIKey)
	if err != nil {
		log.Fatalf("everscribe.New: %v", err)
	}

	rec := es.NewRecorder(
		recorder.WithFlushInterval(2*time.Second),
		recorder.WithSlogLogger(slog.Default()),
	)
	defer rec.Close()

	mint := es.NewMinter()

	users := newStore()

	staticHandler, err := newStaticHandler()
	if err != nil {
		log.Fatalf("static fs: %v", err)
	}

	apiMux := http.NewServeMux()
	apiMux.HandleFunc("GET /api/health", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	})
	apiMux.HandleFunc("GET /api/users", listUsers(users))
	apiMux.HandleFunc("POST /api/users", inviteUser(users, rec, cfg.TenantID))
	apiMux.HandleFunc("PATCH /api/users/{id}/role", changeRole(users, rec, cfg.TenantID))
	apiMux.HandleFunc("DELETE /api/users/{id}", removeUser(users, rec, cfg.TenantID))
	apiMux.HandleFunc("GET /api/embed-token", embedToken(mint, cfg.TenantID))

	// Audit middleware populates the per-request Event template (Origin
	// from the request, Actor from our resolver). In a real app the
	// resolver reads session state; here we hard-code the demo admin.
	auditMW := event.NewMiddleware(demoActorResolver())
	apiHandler := auditMW(apiMux)

	root := http.NewServeMux()
	root.Handle("/api/", apiHandler)
	root.Handle("/", staticHandler)

	handler := http.Handler(root)

	log.Printf("listening on http://localhost:%s (project=%s tenant=%s)", cfg.Port, cfg.ProjectID, cfg.TenantID)
	if err := http.ListenAndServe(":"+cfg.Port, handler); err != nil {
		log.Fatal(err)
	}
}

// Config is loaded from a .env file in the working directory if one
// exists, otherwise from the process environment. The "required" tag on
// the credentials surfaces a clear error at startup if they're missing.
type Config struct {
	ProjectID string `env:"EVERSCRIBE_PROJECT_ID,required"`
	APIKey    string `env:"EVERSCRIBE_API_KEY,required"`
	Port      string `env:"PORT,default=9000"`
	TenantID  string `env:"TENANT_ID,default=tenant_demo"`
}

func loadConfig() (*Config, error) {
	var cfg Config
	if _, err := os.Stat(".env"); err == nil {
		return &cfg, env.UnmarshalFromFile(".env", &cfg)
	}
	return &cfg, env.Unmarshal(&cfg)
}

// demoActorResolver returns a fixed Actor representing the logged-in
// admin running this demo. A real app would parse a session/JWT/etc.
func demoActorResolver() event.ActorResolver {
	actor := event.Actor{
		Type:        "user",
		ID:          "u_demo_admin",
		DisplayName: "Demo Admin",
		Email:       "admin@example.com",
	}
	return func(_ context.Context) event.Actor { return actor }
}

func listUsers(s *store) http.HandlerFunc {
	return func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, s.list())
	}
}

func inviteUser(s *store, rec recorder.Recorder, tenantID string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		e := event.FromContext(r.Context())
		e.TenantID = tenantID
		defer func() { _ = rec.Record(r.Context(), e) }()

		var in struct {
			Email string `json:"email"`
			Name  string `json:"name"`
			Role  string `json:"role"`
		}
		if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
			http.Error(w, "invalid body", http.StatusBadRequest)
			return
		}
		in.Email = strings.TrimSpace(in.Email)
		in.Name = strings.TrimSpace(in.Name)
		if in.Email == "" || in.Name == "" {
			http.Error(w, "email and name required", http.StatusBadRequest)
			return
		}
		if in.Role == "" {
			in.Role = "member"
		}

		u := s.create(in.Email, in.Name, in.Role)

		e.Action = "user.invite"
		e.Target = event.Target{Type: "user", ID: u.ID}
		e.WithFields("email", u.Email, "role", u.Role)

		writeJSON(w, http.StatusCreated, u)
	}
}

func changeRole(s *store, rec recorder.Recorder, tenantID string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		e := event.FromContext(r.Context())
		e.TenantID = tenantID
		e.Target = event.Target{Type: "user", ID: id}
		defer func() { _ = rec.Record(r.Context(), e) }()

		var in struct {
			Role string `json:"role"`
		}
		if err := json.NewDecoder(r.Body).Decode(&in); err != nil || in.Role == "" {
			http.Error(w, "role required", http.StatusBadRequest)
			return
		}

		before, after, err := s.updateRole(id, in.Role)
		if errors.Is(err, errNotFound) {
			http.Error(w, "not found", http.StatusNotFound)
			return
		}

		e.Action = "user.role.change"
		e.Diff(before, after)

		writeJSON(w, http.StatusOK, after)
	}
}

func removeUser(s *store, rec recorder.Recorder, tenantID string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		e := event.FromContext(r.Context())
		e.TenantID = tenantID
		e.Target = event.Target{Type: "user", ID: id}
		defer func() { _ = rec.Record(r.Context(), e) }()

		u, err := s.remove(id)
		if errors.Is(err, errNotFound) {
			http.Error(w, "not found", http.StatusNotFound)
			return
		}

		e.Action = "user.remove"
		e.WithFields("email", u.Email, "role", u.Role)

		w.WriteHeader(http.StatusNoContent)
	}
}

func embedToken(m *minter.Client, tenantID string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		token, err := m.MintToken(r.Context(), minter.TokenOptions{
			TenantID:       tenantID,
			ExpiresIn:      time.Hour,
			AllowedActions: []string{"user.*"},
		})
		if err != nil {
			log.Printf("mint token: %v", err)
			http.Error(w, "could not mint token", http.StatusBadGateway)
			return
		}
		writeJSON(w, http.StatusOK, map[string]string{"token": token})
	}
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

// newStaticHandler serves the embedded React build. fs.Sub strips the
// "web/dist/" prefix so requests to "/" map to the embedded index.html.
func newStaticHandler() (http.Handler, error) {
	sub, err := fs.Sub(staticFS, "web/dist")
	if err != nil {
		return nil, err
	}
	return http.FileServer(http.FS(sub)), nil
}
