// Demo backend for the Everscribe team-management example.
//
// Exposes a tiny in-memory team API that records every mutation as an
// audit event via sdk-go's Recorder, plus an embed-token endpoint that
// the React frontend uses to authenticate <EverscribeEvents />.
package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
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
)

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
	cfg := loadConfig()

	es, err := everscribe.New(cfg.projectID, cfg.apiKey)
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

	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/health", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	})
	mux.HandleFunc("GET /api/users", listUsers(users))
	mux.HandleFunc("POST /api/users", inviteUser(users, rec))
	mux.HandleFunc("PATCH /api/users/{id}/role", changeRole(users, rec))
	mux.HandleFunc("DELETE /api/users/{id}", removeUser(users, rec))
	mux.HandleFunc("GET /api/embed-token", embedToken(mint, cfg.tenantID))

	// Audit middleware populates the per-request Event template (Origin
	// from the request, Actor from our resolver). In a real app the
	// resolver reads session state; here we hard-code the demo admin.
	auditMW := event.NewMiddleware(demoActorResolver(cfg.tenantID))

	handler := withCORS(auditMW(mux))

	log.Printf("listening on http://localhost:%s (project=%s tenant=%s)", cfg.port, cfg.projectID, cfg.tenantID)
	if err := http.ListenAndServe(":"+cfg.port, handler); err != nil {
		log.Fatal(err)
	}
}

type config struct {
	projectID string
	apiKey    string
	port      string
	tenantID  string
}

func loadConfig() config {
	cfg := config{
		projectID: os.Getenv("EVERSCRIBE_PROJECT_ID"),
		apiKey:    os.Getenv("EVERSCRIBE_API_KEY"),
		port:      os.Getenv("PORT"),
		tenantID:  os.Getenv("TENANT_ID"),
	}
	if cfg.projectID == "" || cfg.apiKey == "" {
		log.Fatal("EVERSCRIBE_PROJECT_ID and EVERSCRIBE_API_KEY must be set (see .env.example)")
	}
	if cfg.port == "" {
		cfg.port = "8080"
	}
	if cfg.tenantID == "" {
		cfg.tenantID = "tenant_demo"
	}
	return cfg
}

// demoActorResolver returns a fixed Actor representing the logged-in
// admin running this demo. A real app would parse a session/JWT/etc.
func demoActorResolver(tenantID string) event.ActorResolver {
	actor := event.Actor{
		Type:        "user",
		ID:          "u_demo_admin",
		DisplayName: "Demo Admin",
		Email:       "admin@example.com",
	}
	_ = tenantID
	return func(_ context.Context) event.Actor { return actor }
}

func listUsers(s *store) http.HandlerFunc {
	return func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, s.list())
	}
}

func inviteUser(s *store, rec recorder.Recorder) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		e := event.FromContext(r.Context())
		e.TenantID = tenantFromCtx(r)
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

func changeRole(s *store, rec recorder.Recorder) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		e := event.FromContext(r.Context())
		e.TenantID = tenantFromCtx(r)
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

func removeUser(s *store, rec recorder.Recorder) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		e := event.FromContext(r.Context())
		e.TenantID = tenantFromCtx(r)
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

// tenantFromCtx hardcodes the demo tenant. In a real app it'd come from
// the session via the audit middleware's actor resolver, or a separate
// tenant resolver — but a single-tenant demo doesn't need that.
func tenantFromCtx(r *http.Request) string {
	if v := os.Getenv("TENANT_ID"); v != "" {
		return v
	}
	return "tenant_demo"
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

// withCORS allows the Vite dev server (default :5173) to call the API
// during development. Adjust or remove for production.
func withCORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		if origin != "" {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Vary", "Origin")
			w.Header().Set("Access-Control-Allow-Credentials", "true")
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		}
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}
