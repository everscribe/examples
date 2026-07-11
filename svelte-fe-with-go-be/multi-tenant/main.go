// Demo backend for the Everscribe secrets-vault example
// (multi-tenant, React frontend, Go backend).
//
// Two tenants seed the vault. The login dropdown picks an actor whose
// tenant binding determines (a) which secrets they can see/operate on,
// and (b) which TenantID lands on the recorded audit events. Two embed-
// token endpoints scope <AuditTrail /> two ways:
//
//   - /api/embed-token/admin    - no TenantID, cross-tenant view
//   - /api/embed-token/customer - TenantID = actor's tenant, scoped view
package main

import (
	"context"
	"embed"
	"encoding/json"
	"encoding/hex"
	"crypto/rand"
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

// Tenant is a customer business in this multi-tenant demo.
type Tenant struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

// User is one entry in the seeded cast that the frontend's login dropdown
// shows. Users are bound to a tenant; the audit middleware uses both the
// actor identity and tenant on every recorded event.
type User struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Email    string `json:"email"`
	Role     string `json:"role"`      // "admin" or "member"
	TenantID string `json:"tenant_id"`
}

// Secret is a vault entry, scoped to a tenant. Value is never returned
// by /api/secrets; only the explicit /reveal endpoint returns it (and
// records an event).
type Secret struct {
	ID         string     `json:"id"`
	Name       string     `json:"name"`
	TenantID   string     `json:"tenant_id"`
	value      string     // unexported - never marshaled
	CreatedBy  string     `json:"created_by"`
	CreatedAt  time.Time  `json:"created_at"`
	RotatedAt  *time.Time `json:"rotated_at,omitempty"`
	SharedWith []string   `json:"shared_with"`
	ExpiresAt  *time.Time `json:"expires_at,omitempty"`
	Revoked    bool       `json:"revoked"`
}

// vault stores secrets partitioned by tenant. All operations are
// tenant-scoped - the actor's tenant determines which subset they can
// see and mutate.
type vault struct {
	mu      sync.Mutex
	byID    map[string]*Secret // global id → secret (for fast id lookup)
	byOwner map[string][]string // tenantID → secret ids in that tenant
}

func newVault() *vault {
	v := &vault{
		byID:    map[string]*Secret{},
		byOwner: map[string][]string{},
	}
	v.create("acme", "stripe_api_key", "sk_live_acme_seed", "u_ada")
	v.create("acme", "github_pat", "ghp_acme_seed", "u_ada")
	v.create("initech", "aws_access_key", "AKIA_initech_seed", "u_grace")
	v.create("initech", "slack_webhook", "https://hooks.slack.com/initech_seed", "u_grace")
	return v
}

func (v *vault) create(tenantID, name, value, createdBy string) *Secret {
	v.mu.Lock()
	defer v.mu.Unlock()
	s := &Secret{
		ID:         "sec_" + randomID(),
		Name:       name,
		TenantID:   tenantID,
		value:      value,
		CreatedBy:  createdBy,
		CreatedAt:  time.Now().UTC(),
		SharedWith: []string{},
	}
	v.byID[s.ID] = s
	v.byOwner[tenantID] = append(v.byOwner[tenantID], s.ID)
	return s
}

func (v *vault) listForTenant(tenantID string) []*Secret {
	v.mu.Lock()
	defer v.mu.Unlock()
	ids := v.byOwner[tenantID]
	out := make([]*Secret, 0, len(ids))
	for _, id := range ids {
		out = append(out, v.byID[id])
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ID < out[j].ID })
	return out
}

// secretSnapshot is the redacted shape used in event diffs - value is
// always "[REDACTED]" so plaintext never leaves the process via the
// audit log.
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
	tenants := seedTenants()
	users := seedUsers()

	staticHandler, err := newStaticHandler()
	if err != nil {
		log.Fatalf("static fs: %v", err)
	}

	apiMux := http.NewServeMux()
	apiMux.HandleFunc("GET /api/health", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	})
	apiMux.HandleFunc("GET /api/tenants", listTenants(tenants))
	apiMux.HandleFunc("GET /api/users", listUsersHandler(users))
	apiMux.HandleFunc("GET /api/secrets", listSecrets(v, users))
	apiMux.HandleFunc("POST /api/secrets", createSecret(v, users, rec))
	apiMux.HandleFunc("POST /api/secrets/{id}/reveal", revealSecret(v, users, rec))
	apiMux.HandleFunc("DELETE /api/secrets/{id}", revokeSecret(v, users, rec))
	apiMux.HandleFunc("POST /api/secrets/{id}/rotate", rotateSecret(v, users, rec))
	apiMux.HandleFunc("POST /api/secrets/{id}/share", shareSecret(v, users, rec))
	apiMux.HandleFunc("POST /api/secrets/{id}/expire", expireSecret(v, users, rec))
	apiMux.HandleFunc("GET /api/embed-token/admin", embedTokenAdmin(mint))
	apiMux.HandleFunc("GET /api/embed-token/customer", embedTokenCustomer(mint, users))

	auditMW := event.NewMiddleware(actorResolver(users))
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

func seedTenants() map[string]Tenant {
	cast := []Tenant{
		{ID: "acme", Name: "Acme Corp"},
		{ID: "initech", Name: "Initech"},
	}
	out := make(map[string]Tenant, len(cast))
	for _, t := range cast {
		out[t.ID] = t
	}
	return out
}

// seedUsers spans both tenants so the login dropdown lets the viewer
// jump between tenant contexts. Each tenant has an admin and a member.
func seedUsers() map[string]User {
	cast := []User{
		{ID: "u_ada", Name: "Ada Lovelace", Email: "ada@acme.test", Role: "admin", TenantID: "acme"},
		{ID: "u_linus", Name: "Linus Torvalds", Email: "linus@acme.test", Role: "member", TenantID: "acme"},
		{ID: "u_grace", Name: "Grace Hopper", Email: "grace@initech.test", Role: "admin", TenantID: "initech"},
		{ID: "u_alan", Name: "Alan Turing", Email: "alan@initech.test", Role: "member", TenantID: "initech"},
	}
	out := make(map[string]User, len(cast))
	for _, u := range cast {
		out[u.ID] = u
	}
	return out
}

// actorResolver reads the X-Demo-Actor value (planted on context by
// withActorHeader) and turns it into an Actor for the audit middleware.
// Real apps read session/JWT here.
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

// withActorHeader plants the X-Demo-Actor header on the request context
// so actorResolver (run from inside the audit middleware) can see it.
// Order matters: this must run BEFORE event.NewMiddleware.
func withActorHeader(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		actor := r.Header.Get("X-Demo-Actor")
		ctx := context.WithValue(r.Context(), actorIDKey{}, actor)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// actorFromRequest returns the User for the X-Demo-Actor header, or the
// zero-value User and false if absent/unknown. Most handlers need both
// the actor's ID (for created_by) and tenant (for scoping + e.TenantID).
func actorFromRequest(r *http.Request, users map[string]User) (User, bool) {
	id, _ := r.Context().Value(actorIDKey{}).(string)
	u, ok := users[id]
	return u, ok
}

func listTenants(tenants map[string]Tenant) http.HandlerFunc {
	return func(w http.ResponseWriter, _ *http.Request) {
		out := make([]Tenant, 0, len(tenants))
		for _, t := range tenants {
			out = append(out, t)
		}
		sort.Slice(out, func(i, j int) bool { return out[i].ID < out[j].ID })
		writeJSON(w, http.StatusOK, out)
	}
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

func listSecrets(v *vault, users map[string]User) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		me, ok := actorFromRequest(r, users)
		if !ok {
			http.Error(w, "unknown actor", http.StatusUnauthorized)
			return
		}
		writeJSON(w, http.StatusOK, v.listForTenant(me.TenantID))
	}
}

func createSecret(v *vault, users map[string]User, rec recorder.Recorder) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		me, ok := actorFromRequest(r, users)
		if !ok {
			http.Error(w, "unknown actor", http.StatusUnauthorized)
			return
		}
		e := event.FromContext(r.Context())
		e.TenantID = me.TenantID
		defer func() { _ = rec.Record(r.Context(), e) }()

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

		s := v.create(me.TenantID, in.Name, in.Value, me.ID)

		e.Action = "secret.create"
		e.Target = event.Target{Type: "secret", ID: s.ID}
		e.WithFields("name", s.Name)

		writeJSON(w, http.StatusCreated, s)
	}
}

func revealSecret(v *vault, users map[string]User, rec recorder.Recorder) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		me, ok := actorFromRequest(r, users)
		if !ok {
			http.Error(w, "unknown actor", http.StatusUnauthorized)
			return
		}
		id := r.PathValue("id")
		e := event.FromContext(r.Context())
		e.TenantID = me.TenantID
		e.Target = event.Target{Type: "secret", ID: id}
		defer func() { _ = rec.Record(r.Context(), e) }()

		v.mu.Lock()
		s, present := v.byID[id]
		v.mu.Unlock()
		if !present || s.TenantID != me.TenantID {
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

func revokeSecret(v *vault, users map[string]User, rec recorder.Recorder) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		me, ok := actorFromRequest(r, users)
		if !ok {
			http.Error(w, "unknown actor", http.StatusUnauthorized)
			return
		}
		id := r.PathValue("id")
		e := event.FromContext(r.Context())
		e.TenantID = me.TenantID
		e.Target = event.Target{Type: "secret", ID: id}
		defer func() { _ = rec.Record(r.Context(), e) }()

		v.mu.Lock()
		s, present := v.byID[id]
		if !present || s.TenantID != me.TenantID {
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

func rotateSecret(v *vault, users map[string]User, rec recorder.Recorder) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		me, ok := actorFromRequest(r, users)
		if !ok {
			http.Error(w, "unknown actor", http.StatusUnauthorized)
			return
		}
		id := r.PathValue("id")
		e := event.FromContext(r.Context())
		e.TenantID = me.TenantID
		e.Target = event.Target{Type: "secret", ID: id}
		defer func() { _ = rec.Record(r.Context(), e) }()

		var in struct {
			Value string `json:"value"`
		}
		if err := json.NewDecoder(r.Body).Decode(&in); err != nil || in.Value == "" {
			http.Error(w, "value required", http.StatusBadRequest)
			return
		}

		v.mu.Lock()
		s, present := v.byID[id]
		if !present || s.TenantID != me.TenantID {
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

func shareSecret(v *vault, users map[string]User, rec recorder.Recorder) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		me, ok := actorFromRequest(r, users)
		if !ok {
			http.Error(w, "unknown actor", http.StatusUnauthorized)
			return
		}
		id := r.PathValue("id")
		e := event.FromContext(r.Context())
		e.TenantID = me.TenantID
		e.Target = event.Target{Type: "secret", ID: id}
		defer func() { _ = rec.Record(r.Context(), e) }()

		var in struct {
			UserID string `json:"user_id"`
		}
		if err := json.NewDecoder(r.Body).Decode(&in); err != nil || in.UserID == "" {
			http.Error(w, "user_id required", http.StatusBadRequest)
			return
		}
		// Sharing only makes sense within the same tenant.
		target, ok := users[in.UserID]
		if !ok || target.TenantID != me.TenantID {
			http.Error(w, "unknown or out-of-tenant user_id", http.StatusBadRequest)
			return
		}

		v.mu.Lock()
		s, present := v.byID[id]
		if !present || s.TenantID != me.TenantID {
			v.mu.Unlock()
			http.Error(w, "not found", http.StatusNotFound)
			return
		}
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

func expireSecret(v *vault, users map[string]User, rec recorder.Recorder) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		me, ok := actorFromRequest(r, users)
		if !ok {
			http.Error(w, "unknown actor", http.StatusUnauthorized)
			return
		}
		id := r.PathValue("id")
		e := event.FromContext(r.Context())
		e.TenantID = me.TenantID
		e.Target = event.Target{Type: "secret", ID: id}
		defer func() { _ = rec.Record(r.Context(), e) }()

		var in struct {
			InMinutes int `json:"in_minutes"`
		}
		if err := json.NewDecoder(r.Body).Decode(&in); err != nil || in.InMinutes <= 0 {
			http.Error(w, "in_minutes required (>0)", http.StatusBadRequest)
			return
		}

		expires := time.Now().UTC().Add(time.Duration(in.InMinutes) * time.Minute)

		v.mu.Lock()
		s, present := v.byID[id]
		if !present || s.TenantID != me.TenantID {
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

// embedTokenAdmin mints a token with no TenantID set - the embed sees
// events across all tenants in the project. This is the "your business's
// internal console" view.
func embedTokenAdmin(m *minter.Client) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		token, err := m.MintToken(r.Context(), minter.TokenOptions{
			ExpiresIn:      time.Hour,
			AllowedActions: []string{"secret.*"},
			// Admin token gets full AI + Query access.
			AllowDSLInput: true,
			AllowNLP:      true,
		})
		if err != nil {
			log.Printf("mint admin token: %v", err)
			http.Error(w, "could not mint token", http.StatusBadGateway)
			return
		}
		writeJSON(w, http.StatusOK, map[string]string{"token": token})
	}
}

// embedTokenCustomer mints a token scoped to the actor's tenant - the
// embed sees only that tenant's events. This is what your customer's
// user sees inside their workspace in production.
func embedTokenCustomer(m *minter.Client, users map[string]User) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		me, ok := actorFromRequest(r, users)
		if !ok {
			http.Error(w, "unknown actor", http.StatusUnauthorized)
			return
		}
		token, err := m.MintToken(r.Context(), minter.TokenOptions{
			TenantID:       me.TenantID,
			ExpiresIn:      time.Hour,
			AllowedActions: []string{"secret.*"},
			// Customer (tenant-scoped) tokens also get AI + Query -
			// the partner has opted their end users into both. Server-
			// side, TenantID is still enforced on every read, so the
			// NLP-generated DSL is naturally tenant-scoped.
			AllowDSLInput: true,
			AllowNLP:      true,
		})
		if err != nil {
			log.Printf("mint customer token (tenant=%s): %v", me.TenantID, err)
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

func newStaticHandler() (http.Handler, error) {
	sub, err := fs.Sub(staticFS, "web/dist")
	if err != nil {
		return nil, err
	}
	return http.FileServer(http.FS(sub)), nil
}

// randomID returns a short hex id for new secrets. We swapped from a
// monotonic counter (sec_001, _002, ...) to random ids so that ids
// don't leak per-tenant secret counts via a shared sequence.
func randomID() string {
	var b [4]byte
	if _, err := rand.Read(b[:]); err != nil {
		// rand.Read on Linux/macOS doesn't fail in practice; if it does
		// here, the demo can't safely continue minting ids.
		panic(fmt.Errorf("rand: %w", err))
	}
	return hex.EncodeToString(b[:])
}
