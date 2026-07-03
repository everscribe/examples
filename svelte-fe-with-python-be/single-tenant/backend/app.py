"""Demo backend for the Everscribe secrets-vault example
(single-tenant, React frontend, Python backend).

In-memory vault with seven verbs -- list, reveal, create, revoke, rotate,
share, expire -- each emitting an audit event via the Everscribe SDK's
recorder. The frontend mounts <AuditTrail /> using a token minted here.

Uses FastAPI + the SDK's ASGI adapter (``EverscribeMiddleware``): the
middleware installs a per-request event (actor + origin) that handlers
enrich via ``current_event()``, and auto-records it on response finish when
an ``action`` was set.
"""

from __future__ import annotations

import os
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, AsyncIterator

from dotenv import load_dotenv
from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, JSONResponse, PlainTextResponse, Response

import everscribe
from everscribe.asgi import EverscribeMiddleware, current_event
from everscribe.event import Actor, Target
from everscribe.minter import TokenOptions

load_dotenv()

DIST_DIR = Path(__file__).resolve().parent.parent / "frontend" / "dist"


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


# -------------------------- types --------------------------


@dataclass
class User:
    id: str
    name: str
    email: str
    role: str  # "admin" | "member"


@dataclass
class Secret:
    """Internal shape -- ``value`` is never marshaled to clients."""

    id: str
    name: str
    value: str
    created_by: str
    created_at: str
    shared_with: list[str] = field(default_factory=list)
    rotated_at: str = ""
    expires_at: str = ""
    revoked: bool = False


def to_wire(s: Secret) -> dict[str, Any]:
    """Public (snake_case) shape returned by the API -- omits ``value``."""
    out: dict[str, Any] = {
        "id": s.id,
        "name": s.name,
        "created_by": s.created_by,
        "created_at": s.created_at,
        "shared_with": list(s.shared_with),
        "revoked": s.revoked,
    }
    if s.rotated_at:
        out["rotated_at"] = s.rotated_at
    if s.expires_at:
        out["expires_at"] = s.expires_at
    return out


def snapshot(s: Secret) -> dict[str, Any]:
    """Snapshot for diffs -- ``value`` is always ``[REDACTED]`` so plaintext
    never leaves the process via the audit log."""
    return {
        "name": s.name,
        "value": "[REDACTED]",
        "shared_with": list(s.shared_with),
        "expires_at": s.expires_at,
        "revoked": s.revoked,
    }


# -------------------------- vault store --------------------------

vault: dict[str, Secret] = {}
_seq = 0


def create_secret(name: str, value: str, created_by: str) -> Secret:
    global _seq
    _seq += 1
    s = Secret(
        id=f"sec_{_seq:03d}",
        name=name,
        value=value,
        created_by=created_by,
        created_at=_now_iso(),
    )
    vault[s.id] = s
    return s


create_secret("stripe_api_key", "sk_live_demo_seed_value", "u_ada")
create_secret("github_pat", "ghp_demo_seed_value", "u_ada")
create_secret("datadog_api_key", "dd_demo_seed_value", "u_alan")


# -------------------------- seeded cast --------------------------

users: dict[str, User] = {
    "u_ada": User("u_ada", "Ada Lovelace", "ada@acme.test", "admin"),
    "u_alan": User("u_alan", "Alan Turing", "alan@acme.test", "member"),
    "u_grace": User("u_grace", "Grace Hopper", "grace@acme.test", "member"),
}


# -------------------------- SDK wiring --------------------------

project_id = os.environ.get("EVERSCRIBE_PROJECT_ID", "")
api_key = os.environ.get("EVERSCRIBE_API_KEY", "")
port = int(os.environ.get("PORT", "9000"))

if not project_id or not api_key:
    raise SystemExit(
        "EVERSCRIBE_PROJECT_ID and EVERSCRIBE_API_KEY must be set (see .env.example)"
    )

es = everscribe.new(project_id, api_key)
rec = es.new_recorder(flush_interval=2.0)
minter = es.new_minter()


def resolve_actor(request: Request) -> Actor:
    """Reads the X-Demo-Actor header set by the frontend's login dropdown.
    Real apps read session/JWT here; the header is a demo shortcut."""
    actor_id = request.headers.get("x-demo-actor", "")
    u = users.get(actor_id)
    if u is None:
        return Actor(type="anonymous")
    return Actor(type="user", id=u.id, display_name=u.name, email=u.email)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    print(f"listening on http://localhost:{port} (project={project_id})")
    yield
    rec.close()  # drain pending events on shutdown


app = FastAPI(lifespan=lifespan)

# Audit middleware: installs the per-request event (actor + origin) and
# auto-records it on response finish when current_event().action is set.
app.add_middleware(EverscribeMiddleware, recorder=rec, resolve_actor=resolve_actor)


# ----- API routes -----


@app.get("/api/health")
async def health() -> JSONResponse:
    return JSONResponse({"status": "ok"})


@app.get("/api/users")
async def list_users() -> JSONResponse:
    out = [
        {"id": u.id, "name": u.name, "email": u.email, "role": u.role}
        for u in sorted(users.values(), key=lambda u: u.id)
    ]
    return JSONResponse(out)


@app.get("/api/secrets")
async def list_secrets() -> JSONResponse:
    out = [to_wire(s) for s in sorted(vault.values(), key=lambda s: s.id)]
    return JSONResponse(out)


@app.post("/api/secrets")
async def create(request: Request) -> Response:
    body = await _json(request)
    name = body.get("name")
    value = body.get("value")
    if not isinstance(name, str) or not name.strip() or not isinstance(value, str) or not value:
        return PlainTextResponse("name and value required", status_code=400)

    actor_id = current_event().actor.id or "unknown"
    s = create_secret(name.strip(), value, actor_id)

    e = current_event()
    e.action = "secret.create"
    e.target = Target(type="secret", id=s.id)
    e.with_field("name", s.name)

    return JSONResponse(to_wire(s), status_code=201)


@app.post("/api/secrets/{secret_id}/reveal")
async def reveal(secret_id: str) -> Response:
    e = current_event()
    e.target = Target(type="secret", id=secret_id)
    s = vault.get(secret_id)
    if s is None:
        return PlainTextResponse("not found", status_code=404)
    if s.revoked:
        return PlainTextResponse("revoked", status_code=410)

    e.action = "secret.reveal"
    e.with_field("name", s.name)
    return JSONResponse({"value": s.value})


@app.delete("/api/secrets/{secret_id}")
async def revoke(secret_id: str) -> Response:
    e = current_event()
    e.target = Target(type="secret", id=secret_id)
    s = vault.get(secret_id)
    if s is None:
        return PlainTextResponse("not found", status_code=404)

    before = snapshot(s)
    s.revoked = True
    after = snapshot(s)

    e.action = "secret.revoke"
    e.with_field("name", s.name)
    e.diff(before, after)
    return Response(status_code=204)


@app.post("/api/secrets/{secret_id}/rotate")
async def rotate(secret_id: str, request: Request) -> Response:
    e = current_event()
    e.target = Target(type="secret", id=secret_id)
    body = await _json(request)
    value = body.get("value")
    if not isinstance(value, str) or not value:
        return PlainTextResponse("value required", status_code=400)
    s = vault.get(secret_id)
    if s is None:
        return PlainTextResponse("not found", status_code=404)
    if s.revoked:
        return PlainTextResponse("revoked", status_code=410)

    before = snapshot(s)
    s.value = value
    s.rotated_at = _now_iso()
    after = snapshot(s)

    e.action = "secret.rotate"
    e.with_field("name", s.name)
    # Both snapshots already have value=[REDACTED]; you could instead redact at
    # diff time with e.diff(before, after, with_redacted_fields("/value")).
    e.diff(before, after)
    return Response(status_code=204)


@app.post("/api/secrets/{secret_id}/share")
async def share(secret_id: str, request: Request) -> Response:
    e = current_event()
    e.target = Target(type="secret", id=secret_id)
    body = await _json(request)
    user_id = body.get("user_id")
    if not isinstance(user_id, str) or user_id not in users:
        return PlainTextResponse("user_id required", status_code=400)
    s = vault.get(secret_id)
    if s is None:
        return PlainTextResponse("not found", status_code=404)
    if user_id not in s.shared_with:
        s.shared_with.append(user_id)

    e.action = "secret.share"
    e.with_fields("name", s.name, "shared_with", user_id)
    return Response(status_code=204)


@app.post("/api/secrets/{secret_id}/expire")
async def expire(secret_id: str, request: Request) -> Response:
    e = current_event()
    e.target = Target(type="secret", id=secret_id)
    body = await _json(request)
    in_minutes = body.get("in_minutes")
    if not isinstance(in_minutes, (int, float)) or in_minutes <= 0:
        return PlainTextResponse("in_minutes required (>0)", status_code=400)
    s = vault.get(secret_id)
    if s is None:
        return PlainTextResponse("not found", status_code=404)
    when = datetime.now(timezone.utc) + timedelta(minutes=in_minutes)
    s.expires_at = when.isoformat(timespec="seconds").replace("+00:00", "Z")

    e.action = "secret.expire"
    e.with_fields("name", s.name, "expires_at", s.expires_at)
    return Response(status_code=204)


@app.get("/api/embed-token")
async def embed_token() -> Response:
    try:
        token = minter.mint_token(
            TokenOptions(
                expires_in=60 * 60,  # 1 hour, in seconds
                allowed_actions=["secret.*"],
                # Enable both the AI (natural-language) and Query (advanced
                # DSL) tabs on the embedded events view.
                allow_dsl_input=True,
                allow_nlp=True,
            )
        )
        return JSONResponse({"token": token})
    except Exception as err:  # noqa: BLE001 - demo: surface any mint failure
        print("mint token:", err)
        return PlainTextResponse("could not mint token", status_code=502)


# ----- static frontend + SPA fallback -----


@app.get("/{full_path:path}")
async def spa(full_path: str) -> Response:
    """Serve the built React app from frontend/dist; any non-/api path that
    doesn't match a static file returns index.html for client-side routing."""
    if full_path.startswith("api/"):
        return PlainTextResponse("not found", status_code=404)
    index = DIST_DIR / "index.html"
    if not index.exists():
        return PlainTextResponse(
            "frontend not built -- run `cd frontend && npm install && npm run build`",
            status_code=200,
        )
    candidate = DIST_DIR / full_path
    if full_path and candidate.is_file():
        return FileResponse(candidate)
    return FileResponse(index)


async def _json(request: Request) -> dict[str, Any]:
    try:
        data = await request.json()
    except Exception:  # noqa: BLE001 - treat malformed/empty body as {}
        return {}
    return data if isinstance(data, dict) else {}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=port)
