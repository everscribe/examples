//! Demo backend for the Everscribe secrets-vault example
//! (multi-tenant, React frontend, Rust backend).
//!
//! Two tenants seed the vault. The login dropdown picks an actor whose tenant
//! binding determines (a) which secrets they can see/operate on, and (b) which
//! tenant_id lands on the recorded audit events. Two embed-token endpoints
//! scope <AuditTrail /> two ways:
//!
//!   - /api/embed-token/admin    -- no tenant_id, cross-tenant view
//!   - /api/embed-token/customer -- tenant_id = actor's tenant, scoped view
//!
//! Uses axum + the SDK's tower middleware (`EverscribeLayer`): handlers enrich
//! `CurrentEvent` and the layer auto-records on response finish.

use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::{delete, get, post};
use axum::{Json, Router};
use everscribe::axum::{CurrentEvent, EverscribeLayer};
use everscribe::event::{Actor, Target};
use everscribe::minter::{self, TokenOptions};
use everscribe::recorder::RecorderOptions;
use http::request::Parts;
use serde_json::{json, Value};
use tower_http::services::{ServeDir, ServeFile};

// -------------------------- domain --------------------------

#[derive(Clone)]
struct Secret {
    id: String,
    name: String,
    tenant_id: String,
    value: String,
    created_by: String,
    created_at: String,
    shared_with: Vec<String>,
    rotated_at: String,
    expires_at: String,
    revoked: bool,
}

impl Secret {
    fn to_wire(&self) -> Value {
        let mut m = json!({
            "id": self.id,
            "name": self.name,
            "tenant_id": self.tenant_id,
            "created_by": self.created_by,
            "created_at": self.created_at,
            "shared_with": self.shared_with,
            "revoked": self.revoked,
        });
        if !self.rotated_at.is_empty() {
            m["rotated_at"] = json!(self.rotated_at);
        }
        if !self.expires_at.is_empty() {
            m["expires_at"] = json!(self.expires_at);
        }
        m
    }

    fn snapshot(&self) -> Value {
        json!({
            "name": self.name,
            "value": "[REDACTED]",
            "shared_with": self.shared_with,
            "expires_at": self.expires_at,
            "revoked": self.revoked,
        })
    }
}

#[derive(Clone)]
struct User {
    id: String,
    name: String,
    email: String,
    role: String,
    tenant_id: String,
}

struct Vault {
    secrets: HashMap<String, Secret>,
    seq: u32,
}

impl Vault {
    fn new() -> Self {
        Vault { secrets: HashMap::new(), seq: 0 }
    }

    fn create(&mut self, tenant_id: &str, name: &str, value: &str, created_by: &str) -> Secret {
        self.seq += 1;
        let s = Secret {
            id: format!("sec_{:03}", self.seq),
            name: name.to_string(),
            tenant_id: tenant_id.to_string(),
            value: value.to_string(),
            created_by: created_by.to_string(),
            created_at: now(),
            shared_with: Vec::new(),
            rotated_at: String::new(),
            expires_at: String::new(),
            revoked: false,
        };
        self.secrets.insert(s.id.clone(), s.clone());
        s
    }

    fn list_for_tenant(&self, tenant_id: &str) -> Vec<Secret> {
        let mut out: Vec<Secret> =
            self.secrets.values().filter(|s| s.tenant_id == tenant_id).cloned().collect();
        out.sort_by(|a, b| a.id.cmp(&b.id));
        out
    }

    fn seeded() -> Self {
        let mut v = Vault::new();
        v.create("acme", "stripe_api_key", "sk_live_acme_seed", "u_ada");
        v.create("acme", "github_pat", "ghp_acme_seed", "u_ada");
        v.create("initech", "aws_access_key", "AKIA_initech_seed", "u_grace");
        v.create("initech", "slack_webhook", "https://hooks.slack.com/initech_seed", "u_grace");
        v
    }
}

fn now() -> String {
    chrono::Utc::now().to_rfc3339()
}

fn seed_users() -> HashMap<String, User> {
    let mut m = HashMap::new();
    for (id, name, email, role, tenant) in [
        ("u_ada", "Ada Lovelace", "ada@acme.test", "admin", "acme"),
        ("u_linus", "Linus Torvalds", "linus@acme.test", "member", "acme"),
        ("u_grace", "Grace Hopper", "grace@initech.test", "admin", "initech"),
        ("u_alan", "Alan Turing", "alan@initech.test", "member", "initech"),
    ] {
        m.insert(
            id.to_string(),
            User {
                id: id.to_string(),
                name: name.to_string(),
                email: email.to_string(),
                role: role.to_string(),
                tenant_id: tenant.to_string(),
            },
        );
    }
    m
}

fn tenants() -> Vec<(&'static str, &'static str)> {
    vec![("acme", "Acme Corp"), ("initech", "Initech")]
}

#[derive(Clone)]
struct AppState {
    vault: Arc<Mutex<Vault>>,
    users: Arc<HashMap<String, User>>,
    minter: minter::Client,
}

impl AppState {
    /// The acting user behind the resolved actor, or None for an unknown actor.
    fn actor_user(&self, ev: &CurrentEvent) -> Option<User> {
        let id = ev.with(|e| e.actor.id.clone());
        self.users.get(&id).cloned()
    }
}

fn resolve_actor(parts: &Parts, users: &HashMap<String, User>) -> Actor {
    let id = parts.headers.get("x-demo-actor").and_then(|v| v.to_str().ok()).unwrap_or("");
    match users.get(id) {
        Some(u) => Actor {
            r#type: "user".into(),
            id: u.id.clone(),
            display_name: u.name.clone(),
            email: u.email.clone(),
        },
        None => Actor::new("anonymous"),
    }
}

fn unknown_actor() -> Response {
    (StatusCode::UNAUTHORIZED, "unknown actor").into_response()
}

// -------------------------- handlers --------------------------

async fn health() -> Response {
    Json(json!({ "status": "ok" })).into_response()
}

async fn list_tenants() -> Response {
    let out: Vec<Value> = tenants().iter().map(|(id, name)| json!({ "id": id, "name": name })).collect();
    Json(out).into_response()
}

async fn list_users(State(st): State<AppState>) -> Response {
    let mut users: Vec<&User> = st.users.values().collect();
    users.sort_by(|a, b| a.id.cmp(&b.id));
    let out: Vec<Value> = users
        .iter()
        .map(|u| {
            json!({ "id": u.id, "name": u.name, "email": u.email, "role": u.role, "tenant_id": u.tenant_id })
        })
        .collect();
    Json(out).into_response()
}

async fn list_secrets(State(st): State<AppState>, ev: CurrentEvent) -> Response {
    let Some(me) = st.actor_user(&ev) else { return unknown_actor() };
    let v = st.vault.lock().unwrap();
    let out: Vec<Value> = v.list_for_tenant(&me.tenant_id).iter().map(|s| s.to_wire()).collect();
    Json(out).into_response()
}

async fn create(State(st): State<AppState>, ev: CurrentEvent, Json(body): Json<Value>) -> Response {
    let Some(me) = st.actor_user(&ev) else { return unknown_actor() };
    ev.with(|e| e.tenant_id = me.tenant_id.clone());

    let name = body.get("name").and_then(Value::as_str).unwrap_or("").trim().to_string();
    let value = body.get("value").and_then(Value::as_str).unwrap_or("").to_string();
    if name.is_empty() || value.is_empty() {
        return (StatusCode::BAD_REQUEST, "name and value required").into_response();
    }
    let s = st.vault.lock().unwrap().create(&me.tenant_id, &name, &value, &me.id);
    ev.with(|e| {
        e.action = "secret.create".into();
        e.target = Target::new("secret", &s.id);
        e.with_field("name", &s.name);
    });
    (StatusCode::CREATED, Json(s.to_wire())).into_response()
}

async fn reveal(State(st): State<AppState>, ev: CurrentEvent, Path(id): Path<String>) -> Response {
    let Some(me) = st.actor_user(&ev) else { return unknown_actor() };
    ev.with(|e| {
        e.tenant_id = me.tenant_id.clone();
        e.target = Target::new("secret", &id);
    });
    let v = st.vault.lock().unwrap();
    let Some(s) = v.secrets.get(&id).filter(|s| s.tenant_id == me.tenant_id) else {
        return (StatusCode::NOT_FOUND, "not found").into_response();
    };
    if s.revoked {
        return (StatusCode::GONE, "revoked").into_response();
    }
    let (value, name) = (s.value.clone(), s.name.clone());
    drop(v);
    ev.with(|e| {
        e.action = "secret.reveal".into();
        e.with_field("name", &name);
    });
    Json(json!({ "value": value })).into_response()
}

async fn revoke(State(st): State<AppState>, ev: CurrentEvent, Path(id): Path<String>) -> Response {
    let Some(me) = st.actor_user(&ev) else { return unknown_actor() };
    ev.with(|e| {
        e.tenant_id = me.tenant_id.clone();
        e.target = Target::new("secret", &id);
    });
    let mut v = st.vault.lock().unwrap();
    let Some(s) = v.secrets.get_mut(&id).filter(|s| s.tenant_id == me.tenant_id) else {
        return (StatusCode::NOT_FOUND, "not found").into_response();
    };
    let before = s.snapshot();
    s.revoked = true;
    let after = s.snapshot();
    let name = s.name.clone();
    drop(v);
    ev.with(|e| {
        e.action = "secret.revoke".into();
        e.with_field("name", &name);
        e.diff(&before, &after);
    });
    StatusCode::NO_CONTENT.into_response()
}

async fn rotate(State(st): State<AppState>, ev: CurrentEvent, Path(id): Path<String>, Json(body): Json<Value>) -> Response {
    let Some(me) = st.actor_user(&ev) else { return unknown_actor() };
    ev.with(|e| {
        e.tenant_id = me.tenant_id.clone();
        e.target = Target::new("secret", &id);
    });
    let value = body.get("value").and_then(Value::as_str).unwrap_or("").to_string();
    if value.is_empty() {
        return (StatusCode::BAD_REQUEST, "value required").into_response();
    }
    let mut v = st.vault.lock().unwrap();
    let Some(s) = v.secrets.get_mut(&id).filter(|s| s.tenant_id == me.tenant_id) else {
        return (StatusCode::NOT_FOUND, "not found").into_response();
    };
    if s.revoked {
        return (StatusCode::GONE, "revoked").into_response();
    }
    let before = s.snapshot();
    s.value = value;
    s.rotated_at = now();
    let after = s.snapshot();
    let name = s.name.clone();
    drop(v);
    ev.with(|e| {
        e.action = "secret.rotate".into();
        e.with_field("name", &name);
        e.diff(&before, &after);
    });
    StatusCode::NO_CONTENT.into_response()
}

async fn share(State(st): State<AppState>, ev: CurrentEvent, Path(id): Path<String>, Json(body): Json<Value>) -> Response {
    let Some(me) = st.actor_user(&ev) else { return unknown_actor() };
    ev.with(|e| {
        e.tenant_id = me.tenant_id.clone();
        e.target = Target::new("secret", &id);
    });
    let user_id = body.get("user_id").and_then(Value::as_str).unwrap_or("").to_string();
    // Sharing only makes sense within the same tenant.
    match st.users.get(&user_id) {
        Some(t) if t.tenant_id == me.tenant_id => {}
        _ => return (StatusCode::BAD_REQUEST, "unknown or out-of-tenant user_id").into_response(),
    }
    let mut v = st.vault.lock().unwrap();
    let Some(s) = v.secrets.get_mut(&id).filter(|s| s.tenant_id == me.tenant_id) else {
        return (StatusCode::NOT_FOUND, "not found").into_response();
    };
    if !s.shared_with.contains(&user_id) {
        s.shared_with.push(user_id.clone());
    }
    let name = s.name.clone();
    drop(v);
    ev.with(|e| {
        e.action = "secret.share".into();
        e.with_field("name", &name);
        e.with_field("shared_with", &user_id);
    });
    StatusCode::NO_CONTENT.into_response()
}

async fn expire(State(st): State<AppState>, ev: CurrentEvent, Path(id): Path<String>, Json(body): Json<Value>) -> Response {
    let Some(me) = st.actor_user(&ev) else { return unknown_actor() };
    ev.with(|e| {
        e.tenant_id = me.tenant_id.clone();
        e.target = Target::new("secret", &id);
    });
    let minutes = body.get("in_minutes").and_then(Value::as_f64).unwrap_or(0.0);
    if minutes <= 0.0 {
        return (StatusCode::BAD_REQUEST, "in_minutes required (>0)").into_response();
    }
    let mut v = st.vault.lock().unwrap();
    let Some(s) = v.secrets.get_mut(&id).filter(|s| s.tenant_id == me.tenant_id) else {
        return (StatusCode::NOT_FOUND, "not found").into_response();
    };
    let expires = chrono::Utc::now() + chrono::Duration::milliseconds((minutes * 60_000.0) as i64);
    s.expires_at = expires.to_rfc3339();
    let (name, expires_at) = (s.name.clone(), s.expires_at.clone());
    drop(v);
    ev.with(|e| {
        e.action = "secret.expire".into();
        e.with_field("name", &name);
        e.with_field("expires_at", &expires_at);
    });
    StatusCode::NO_CONTENT.into_response()
}

fn base_token_options() -> TokenOptions {
    TokenOptions {
        expires_in: Duration::from_secs(60 * 60),
        allowed_actions: Some(vec!["secret.*".into()]),
        allow_dsl_input: true,
        allow_nlp: true,
        ..Default::default()
    }
}

/// Admin embed: token has no tenant_id -- cross-tenant view of all events.
async fn embed_token_admin(State(st): State<AppState>) -> Response {
    match st.minter.mint_token(&base_token_options()).await {
        Ok(token) => Json(json!({ "token": token })).into_response(),
        Err(err) => {
            eprintln!("mint admin token: {err}");
            (StatusCode::BAD_GATEWAY, "could not mint token").into_response()
        }
    }
}

/// Customer embed: token scoped to the actor's tenant.
async fn embed_token_customer(State(st): State<AppState>, ev: CurrentEvent) -> Response {
    let Some(me) = st.actor_user(&ev) else { return unknown_actor() };
    let opts = TokenOptions { tenant_id: me.tenant_id.clone(), ..base_token_options() };
    match st.minter.mint_token(&opts).await {
        Ok(token) => Json(json!({ "token": token })).into_response(),
        Err(err) => {
            eprintln!("mint customer token (tenant={}): {err}", me.tenant_id);
            (StatusCode::BAD_GATEWAY, "could not mint token").into_response()
        }
    }
}

// -------------------------- main --------------------------

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    dotenvy::dotenv().ok();
    let project_id = std::env::var("EVERSCRIBE_PROJECT_ID")
        .expect("EVERSCRIBE_PROJECT_ID must be set (see .env.example)");
    let api_key = std::env::var("EVERSCRIBE_API_KEY")
        .expect("EVERSCRIBE_API_KEY must be set (see .env.example)");
    let port: u16 = std::env::var("PORT").ok().and_then(|p| p.parse().ok()).unwrap_or(9000);

    let es = everscribe::new(project_id.clone(), api_key)?;
    let rec = es.new_recorder(RecorderOptions::default());
    let minter = es.new_minter(Default::default());

    let state = AppState {
        vault: Arc::new(Mutex::new(Vault::seeded())),
        users: Arc::new(seed_users()),
        minter,
    };

    let users_for_resolver = state.users.clone();
    let api = Router::new()
        .route("/health", get(health))
        .route("/tenants", get(list_tenants))
        .route("/users", get(list_users))
        .route("/secrets", get(list_secrets).post(create))
        .route("/secrets/:id/reveal", post(reveal))
        .route("/secrets/:id/rotate", post(rotate))
        .route("/secrets/:id/share", post(share))
        .route("/secrets/:id/expire", post(expire))
        .route("/secrets/:id", delete(revoke))
        .route("/embed-token/admin", post(embed_token_admin))
        .route("/embed-token/customer", post(embed_token_customer))
        .layer(EverscribeLayer::new(rec, move |p: &Parts| resolve_actor(p, &users_for_resolver)))
        .with_state(state);

    let serve_dir = ServeDir::new("frontend/dist")
        .not_found_service(ServeFile::new("frontend/dist/index.html"));
    let app = Router::new().nest("/api", api).fallback_service(serve_dir);

    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    let listener = tokio::net::TcpListener::bind(addr).await?;
    println!("listening on http://localhost:{port} (project={project_id})");
    axum::serve(listener, app).await?;
    Ok(())
}
