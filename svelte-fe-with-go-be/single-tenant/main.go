// Demo backend for the Everscribe secrets-vault example
// (single-tenant, React frontend, Go backend).
//
// In-memory vault with seven verbs - list, reveal, create, revoke,
// rotate, share, expire - each emitting an audit event via sdk-go's
// Recorder. The frontend mounts <AuditTrail /> using a token minted
// here.
package main

import (
	"context"
	"embed"
	"encoding/json"
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

//go:embed all:web/dist
var staticFS embed.FS

// Config - see .env.example. The 'required' tag surfaces missing
// credentials clearly at startup.
type Config struct {
	ProjectID string `env:"EVERSCRIBE_PROJECT_ID,required"`
	APIKey    string `env:"EVERSCRIBE_API_KEY,required"`
	Port      string `env:"PORT,default=9000"`
}

// User is one entry in the seeded cast that the frontend's login dropdown
// shows. The frontend sends X-Demo-Actor on every request to identify
// who is "logged in" - see actorResolver below.
type User struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	Email string `json:"email"`
	Role  string `json:"role"` // "admin" or "member"
}

// Secret is a vault entry. Value is never returned by /api/secrets;
// only the explicit /reveal endpoint returns it (and records an event).
type Secret struct {
	ID         string     `json:"id"`
	Name       string     `json:"name"`
	value      string     // unexported - never marshaled
	CreatedBy  string     `json:"created_by"`
	CreatedAt  time.Time  `json:"created_at"`
	RotatedAt  *time.Time `json:"rotated_at,omitempty"`
	SharedWith []string   `json:"shared_with"`
	ExpiresAt  *time.Time `json:"expires_at,omitempty"`
	Revoked    bool       `json:"revoked"`
}

type vault struct {
	mu      sync.Mutex
	secrets map[string]*Secret
	seq     int
}

func newVault() *vault {
	v := &vault{secrets: map[string]*Secret{}}
	// Seed so the audit trail has things to reveal/rotate from the start.
	v.create("stripe_api_key", "sk_live_demo_seed_value", "u_ada")
	v.create("github_pat", "ghp_demo_seed_value", "u_ada")
	v.create("datadog_api_key", "dd_demo_seed_value", "u_alan")
	return v
}

func (v *vault) create(name, value, createdBy string) *Secret {
	v.mu.Lock()
	defer v.mu.Unlock()
	v.seq++
	s := &Secret{
		ID:         fmt.Sprintf("sec_%03d", v.seq),
		Name:       name,
		value:      value,
		CreatedBy:  createdBy,
		CreatedAt:  time.Now().UTC(),
		SharedWith: []string{},
	}
	v.secrets[s.ID] = s
	return s
}

func (v *vault) list() []*Secret {
	v.mu.Lock()
	defer v.mu.Unlock()
	out := make([]*Secret, 0, len(v.secrets))
	for _, s := range v.secrets {
		out = append(out, s)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ID < out[j].ID })
	return out
}

func (v *vault) get(id string) (*Secret, bool) {
	v.mu.Lock()
	defer v.mu.Unlock()
	s, ok := v.secrets[id]
	return s, ok
}

// snapshot returns a redacted copy suitable for use in event diffs -
// the value field is replaced with "[REDACTED]" so plaintext never
// leaves the process via the audit log.
type secretSnapshot struct {
	Name       string     `json:"name"`
	Value      string     `json:"value"`
	SharedWith []string   `json:"shared_with"`
	ExpiresAt  *time.Time `json:"expires_at,omitempty"`
	Revoked    bool       `json:"revoked"`
}

func snapshot(s *Secret) secretSnapshot {
	return secretSnapshot{
		Name:       s.Name,
		Value:      "[REDACTED]",
		SharedWith: append([]string(nil), s.SharedWith...),
		ExpiresAt:  s.ExpiresAt,
		Revoked:    s.Revoked,
	}
}

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

	v := newVault()
	users := seedUsers()

	staticHandler, err := newStaticHandler()
	if err != nil {
		log.Fatalf("static fs: %v", err)
	}

	apiMux := http.NewServeMux()
	apiMux.HandleFunc("GET /api/health", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	})
	apiMux.HandleFunc("GET /api/users", listUsersHandler(users))
	apiMux.HandleFunc("GET /api/secrets", listSecrets(v))
	apiMux.HandleFunc("POST /api/secrets", createSecret(v))
	apiMux.HandleFunc("POST /api/secrets/{id}/reveal", revealSecret(v))
	apiMux.HandleFunc("DELETE /api/secrets/{id}", revokeSecret(v))
	apiMux.HandleFunc("POST /api/secrets/{id}/rotate", rotateSecret(v))
	apiMux.HandleFunc("POST /api/secrets/{id}/share", shareSecret(v, users))
	apiMux.HandleFunc("POST /api/secrets/{id}/expire", expireSecret(v))
	apiMux.HandleFunc("POST /api/embed-token", embedToken(mint))

	auditMW := event.Middleware(event.Options{
		ActorResolver: actorResolver(users),
		Recorder:      rec,
	})
	// withActorHeader must run BEFORE auditMW so the X-Demo-Actor value
	// lands on context before actorResolver is invoked.
	apiHandler := withActorHeader(auditMW(apiMux))

	root := http.NewServeMux()
	root.Handle("/api/", apiHandler)
	root.Handle("/", staticHandler)

	log.Printf("listening on http://localhost:%s (project=%s)", cfg.Port, cfg.ProjectID)
	if err := http.ListenAndServe(":"+cfg.Port, root); err != nil {
		log.Fatal(err)
	}
}

func loadConfig() (*Config, error) {
	var cfg Config
	if _, err := os.Stat(".env"); err == nil {
		return &cfg, env.UnmarshalFromFile(".env", &cfg)
	}
	return &cfg, env.Unmarshal(&cfg)
}

// seedUsers is the cast shown in the frontend's login dropdown. Single-
// tenant demo, so they all share an implicit tenant.
func seedUsers() map[string]User {
	cast := []User{
		{ID: "u_ada", Name: "Ada Lovelace", Email: "ada@acme.test", Role: "admin"},
		{ID: "u_alan", Name: "Alan Turing", Email: "alan@acme.test", Role: "member"},
		{ID: "u_grace", Name: "Grace Hopper", Email: "grace@acme.test", Role: "member"},
	}
	out := make(map[string]User, len(cast))
	for _, u := range cast {
		out[u.ID] = u
	}
	return out
}

// actorResolver reads the X-Demo-Actor value (planted on context by
// withActorHeader) and turns it into an Actor for the audit middleware.
// Real apps read session/JWT here; the demo header is a shortcut so the
// frontend's login dropdown can drive the actor.
func actorResolver(users map[string]User) event.ActorResolver {
	return func(ctx context.Context) event.Actor {
		id, _ := ctx.Value(actorIDKey{}).(string)
		if u, ok := users[id]; ok {
			return event.Actor{
				Type:        "user",
				ID:          u.ID,
				DisplayName: u.Name,
				Email:       u.Email,
			}
		}
		return event.Actor{Type: "anonymous"}
	}
}

type actorIDKey struct{}

// withActorHeader plants the X-Demo-Actor header value on the request
// context so actorResolver (run from inside the audit middleware) can
// see it. Order matters: this must run BEFORE event.Middleware.
func withActorHeader(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		actor := r.Header.Get("X-Demo-Actor")
		ctx := context.WithValue(r.Context(), actorIDKey{}, actor)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

func listUsersHandler(users map[string]User) http.HandlerFunc {
	return func(w http.ResponseWriter, _ *http.Request) {
		out := make([]User, 0, len(users))
		for _, u := range users {
			out = append(out, u)
		}
		sort.Slice(out, func(i, j int) bool { return out[i].ID < out[j].ID })
		writeJSON(w, http.StatusOK, out)
	}
}

func listSecrets(v *vault) http.HandlerFunc {
	return func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, v.list())
	}
}

func createSecret(v *vault) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		e := event.Current(r.Context())

		var in struct {
			Name  string `json:"name"`
			Value string `json:"value"`
		}
		if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
			http.Error(w, "invalid body", http.StatusBadRequest)
			return
		}
		in.Name = strings.TrimSpace(in.Name)
		if in.Name == "" || in.Value == "" {
			http.Error(w, "name and value required", http.StatusBadRequest)
			return
		}

		s := v.create(in.Name, in.Value, e.Actor.ID)

		e.Action = "secret.create"
		e.Target = event.Target{Type: "secret", ID: s.ID}
		e.WithFields("name", s.Name)

		writeJSON(w, http.StatusCreated, s)
	}
}

func revealSecret(v *vault) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		e := event.Current(r.Context())
		e.Target = event.Target{Type: "secret", ID: id}

		s, ok := v.get(id)
		if !ok {
			http.Error(w, "not found", http.StatusNotFound)
			return
		}
		if s.Revoked {
			http.Error(w, "revoked", http.StatusGone)
			return
		}

		e.Action = "secret.reveal"
		e.WithFields("name", s.Name)

		writeJSON(w, http.StatusOK, map[string]string{"value": s.value})
	}
}

func revokeSecret(v *vault) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		e := event.Current(r.Context())
		e.Target = event.Target{Type: "secret", ID: id}

		v.mu.Lock()
		s, ok := v.secrets[id]
		if !ok {
			v.mu.Unlock()
			http.Error(w, "not found", http.StatusNotFound)
			return
		}
		before := snapshot(s)
		s.Revoked = true
		after := snapshot(s)
		name := s.Name
		v.mu.Unlock()

		e.Action = "secret.revoke"
		e.WithFields("name", name)
		e.Diff(before, after)

		w.WriteHeader(http.StatusNoContent)
	}
}

func rotateSecret(v *vault) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		e := event.Current(r.Context())
		e.Target = event.Target{Type: "secret", ID: id}

		var in struct {
			Value string `json:"value"`
		}
		if err := json.NewDecoder(r.Body).Decode(&in); err != nil || in.Value == "" {
			http.Error(w, "value required", http.StatusBadRequest)
			return
		}

		v.mu.Lock()
		s, ok := v.secrets[id]
		if !ok {
			v.mu.Unlock()
			http.Error(w, "not found", http.StatusNotFound)
			return
		}
		if s.Revoked {
			v.mu.Unlock()
			http.Error(w, "revoked", http.StatusGone)
			return
		}
		before := snapshot(s)
		s.value = in.Value
		now := time.Now().UTC()
		s.RotatedAt = &now
		after := snapshot(s)
		name := s.Name
		v.mu.Unlock()

		e.Action = "secret.rotate"
		e.WithFields("name", name)
		// Both snapshots already have value=[REDACTED]; the diff reflects
		// the rotation timestamp + any other field changes without ever
		// recording the plaintext.
		e.Diff(before, after)

		w.WriteHeader(http.StatusNoContent)
	}
}

func shareSecret(v *vault, users map[string]User) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		e := event.Current(r.Context())
		e.Target = event.Target{Type: "secret", ID: id}

		var in struct {
			UserID string `json:"user_id"`
		}
		if err := json.NewDecoder(r.Body).Decode(&in); err != nil || in.UserID == "" {
			http.Error(w, "user_id required", http.StatusBadRequest)
			return
		}
		if _, ok := users[in.UserID]; !ok {
			http.Error(w, "unknown user_id", http.StatusBadRequest)
			return
		}

		v.mu.Lock()
		s, ok := v.secrets[id]
		if !ok {
			v.mu.Unlock()
			http.Error(w, "not found", http.StatusNotFound)
			return
		}
		// no-op if already shared
		already := false
		for _, u := range s.SharedWith {
			if u == in.UserID {
				already = true
				break
			}
		}
		if !already {
			s.SharedWith = append(s.SharedWith, in.UserID)
		}
		name := s.Name
		v.mu.Unlock()

		e.Action = "secret.share"
		e.WithFields("name", name, "shared_with", in.UserID)

		w.WriteHeader(http.StatusNoContent)
	}
}

func expireSecret(v *vault) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		e := event.Current(r.Context())
		e.Target = event.Target{Type: "secret", ID: id}

		var in struct {
			InMinutes int `json:"in_minutes"`
		}
		if err := json.NewDecoder(r.Body).Decode(&in); err != nil || in.InMinutes <= 0 {
			http.Error(w, "in_minutes required (>0)", http.StatusBadRequest)
			return
		}

		expires := time.Now().UTC().Add(time.Duration(in.InMinutes) * time.Minute)

		v.mu.Lock()
		s, ok := v.secrets[id]
		if !ok {
			v.mu.Unlock()
			http.Error(w, "not found", http.StatusNotFound)
			return
		}
		s.ExpiresAt = &expires
		name := s.Name
		v.mu.Unlock()

		e.Action = "secret.expire"
		e.WithFields("name", name, "expires_at", expires.Format(time.RFC3339))

		w.WriteHeader(http.StatusNoContent)
	}
}

func embedToken(m *minter.Client) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		token, err := m.MintToken(r.Context(), minter.TokenOptions{
			ExpiresIn:      time.Hour,
			AllowedActions: []string{"secret.*"},
			// Enable both the AI (natural-language) and Query (advanced
			// DSL) tabs on the embedded events view.
			AllowDSLInput: true,
			AllowNLP:      true,
		})
		if err != nil {
			log.Printf("mint token: %v", err)
			http.Error(w, "could not mint token", http.StatusBadGateway)
			return
		}
		// The token is a bearer credential scoped to one viewer. Never
		// let a browser or a shared proxy hold on to it.
		w.Header().Set("Cache-Control", "no-store")
		writeJSON(w, http.StatusOK, map[string]string{"token": token})
	}
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func newStaticHandler() (http.Handler, error) {
	sub, err := fs.Sub(staticFS, "web/dist")
	if err != nil {
		return nil, err
	}
	return http.FileServer(http.FS(sub)), nil
}
