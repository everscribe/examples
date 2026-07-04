//! Demo backend for the Everscribe secrets-vault example
//! (single-tenant, React frontend, Rust backend).
//!
//! In-memory vault with seven verbs -- list, reveal, create, revoke, rotate,
//! share, expire -- each emitting an audit event via the Everscribe SDK. The
//! frontend mounts <AuditTrail /> using a token minted here.
//!
//! Uses axum + the SDK's tower middleware (`EverscribeLayer`): it installs a
//! per-request event (actor + origin) that handlers enrich via the
//! `CurrentEvent` extractor, and auto-records it on response finish when an
//! `action` was set.

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
    value: String,
    created_by: String,
    created_at: String,
    shared_with: Vec<String>,
    rotated_at: String,
    expires_at: String,
    revoked: bool,
}

impl Secret {
    /// Public (snake_case) shape returned by the API -- omits `value`.
    fn to_wire(&self) -> Value {
        let mut m = json!({
            "id": self.id,
            "name": self.name,
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

    /// Snapshot for diffs -- `value` is always `[REDACTED]` so plaintext never
    /// leaves the process via the audit log.
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
}

struct Vault {
    secrets: HashMap<String, Secret>,
    seq: u32,
}

impl Vault {
    fn new() -> Self {
        Vault { secrets: HashMap::new(), seq: 0 }
    }

    fn create(&mut self, name: &str, value: &str, created_by: &str) -> Secret {
        self.seq += 1;
        let s = Secret {
            id: format!("sec_{:03}", self.seq),
            name: name.to_string(),
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

    fn seeded() -> Self {
        let mut v = Vault::new();
        v.create("stripe_api_key", "sk_live_demo_seed_value", "u_ada");
        v.create("github_pat", "ghp_demo_seed_value", "u_ada");
        v.create("datadog_api_key", "dd_demo_seed_value", "u_alan");
        v
    }
}

fn now() -> String {
    chrono::Utc::now().to_rfc3339()
}

fn seed_users() -> HashMap<String, User> {
    let mut m = HashMap::new();
    for (id, name, email, role) in [
        ("u_ada", "Ada Lovelace", "ada@acme.test", "admin"),
        ("u_alan", "Alan Turing", "alan@acme.test", "member"),
        ("u_grace", "Grace Hopper", "grace@acme.test", "member"),
    ] {
        m.insert(
            id.to_string(),
            User {
                id: id.to_string(),
                name: name.to_string(),
                email: email.to_string(),
                role: role.to_string(),
            },
        );
    }
    m
}

#[derive(Clone)]
struct AppState {
    vault: Arc<Mutex<Vault>>,
    users: Arc<HashMap<String, User>>,
    minter: minter::Client,
}

// -------------------------- actor resolver --------------------------

/// Reads the X-Demo-Actor header set by the frontend's login dropdown. Real
/// apps read session/JWT here; the header is a demo shortcut.
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

// -------------------------- handlers --------------------------

async fn health() -> Response {
    Json(json!({ "status": "ok" })).into_response()
}

async fn list_users(State(st): State<AppState>) -> Response {
    let mut users: Vec<&User> = st.users.values().collect();
    users.sort_by(|a, b| a.id.cmp(&b.id));
    let out: Vec<Value> = users
        .iter()
        .map(|u| json!({ "id": u.id, "name": u.name, "email": u.email, "role": u.role }))
        .collect();
    Json(out).into_response()
}

async fn list_secrets(State(st): State<AppState>) -> Response {
    let v = st.vault.lock().unwrap();
    let mut secrets: Vec<&Secret> = v.secrets.values().collect();
    secrets.sort_by(|a, b| a.id.cmp(&b.id));
    let out: Vec<Value> = secrets.iter().map(|s| s.to_wire()).collect();
    Json(out).into_response()
}

async fn create(State(st): State<AppState>, ev: CurrentEvent, Json(body): Json<Value>) -> Response {
    let name = body.get("name").and_then(Value::as_str).unwrap_or("").trim().to_string();
    let value = body.get("value").and_then(Value::as_str).unwrap_or("").to_string();
    if name.is_empty() || value.is_empty() {
        return (StatusCode::BAD_REQUEST, "name and value required").into_response();
    }
    let actor_id = ev.with(|e| e.actor.id.clone());
    let actor_id = if actor_id.is_empty() { "unknown".to_string() } else { actor_id };

    let s = st.vault.lock().unwrap().create(&name, &value, &actor_id);
    ev.with(|e| {
        e.action = "secret.create".into();
        e.target = Target::new("secret", &s.id);
        e.with_field("name", &s.name);
    });
    (StatusCode::CREATED, Json(s.to_wire())).into_response()
}

async fn reveal(State(st): State<AppState>, ev: CurrentEvent, Path(id): Path<String>) -> Response {
    ev.with(|e| e.target = Target::new("secret", &id));
    let v = st.vault.lock().unwrap();
    let Some(s) = v.secrets.get(&id) else {
        return (StatusCode::NOT_FOUND, "not found").into_response();
    };
    if s.revoked {
        return (StatusCode::GONE, "revoked").into_response();
    }
    let value = s.value.clone();
    let name = s.name.clone();
    drop(v);
    ev.with(|e| {
        e.action = "secret.reveal".into();
        e.with_field("name", &name);
    });
    Json(json!({ "value": value })).into_response()
}

async fn revoke(State(st): State<AppState>, ev: CurrentEvent, Path(id): Path<String>) -> Response {
    ev.with(|e| e.target = Target::new("secret", &id));
    let mut v = st.vault.lock().unwrap();
    let Some(s) = v.secrets.get_mut(&id) else {
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
    ev.with(|e| e.target = Target::new("secret", &id));
    let value = body.get("value").and_then(Value::as_str).unwrap_or("").to_string();
    if value.is_empty() {
        return (StatusCode::BAD_REQUEST, "value required").into_response();
    }
    let mut v = st.vault.lock().unwrap();
    let Some(s) = v.secrets.get_mut(&id) else {
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
    ev.with(|e| e.target = Target::new("secret", &id));
    let user_id = body.get("user_id").and_then(Value::as_str).unwrap_or("").to_string();
    if user_id.is_empty() || !st.users.contains_key(&user_id) {
        return (StatusCode::BAD_REQUEST, "user_id required").into_response();
    }
    let mut v = st.vault.lock().unwrap();
    let Some(s) = v.secrets.get_mut(&id) else {
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
    ev.with(|e| e.target = Target::new("secret", &id));
    let minutes = body.get("in_minutes").and_then(Value::as_f64).unwrap_or(0.0);
    if minutes <= 0.0 {
        return (StatusCode::BAD_REQUEST, "in_minutes required (>0)").into_response();
    }
    let mut v = st.vault.lock().unwrap();
    let Some(s) = v.secrets.get_mut(&id) else {
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

async fn embed_token(State(st): State<AppState>) -> Response {
    let opts = TokenOptions {
        expires_in: Duration::from_secs(60 * 60), // 1 hour
        allowed_actions: Some(vec!["secret.*".into()]),
        // Enable both the AI (natural-language) and Query (advanced DSL) tabs.
        allow_dsl_input: true,
        allow_nlp: true,
        ..Default::default()
    };
    match st.minter.mint_token(&opts).await {
        Ok(token) => Json(json!({ "token": token })).into_response(),
        Err(err) => {
            eprintln!("mint token: {err}");
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
        .route("/users", get(list_users))
        .route("/secrets", get(list_secrets).post(create))
        .route("/secrets/:id/reveal", post(reveal))
        .route("/secrets/:id/rotate", post(rotate))
        .route("/secrets/:id/share", post(share))
        .route("/secrets/:id/expire", post(expire))
        .route("/secrets/:id", delete(revoke))
        .route("/embed-token", get(embed_token))
        .layer(EverscribeLayer::new(rec, move |p: &Parts| resolve_actor(p, &users_for_resolver)))
        .with_state(state);

    // Serve the built React app; unknown non-/api paths fall back to index.html.
    let serve_dir = ServeDir::new("frontend/dist")
        .not_found_service(ServeFile::new("frontend/dist/index.html"));
    let app = Router::new().nest("/api", api).fallback_service(serve_dir);

    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    let listener = tokio::net::TcpListener::bind(addr).await?;
    println!("listening on http://localhost:{port} (project={project_id})");
    axum::serve(listener, app).await?;
    Ok(())
}
