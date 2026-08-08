"""Demo backend for the Everscribe secrets-vault example
(multi-tenant, React frontend, Python backend).

Two tenants seed the vault. The login dropdown picks an actor whose tenant
binding determines (a) which secrets they can see/operate on, and (b) which
tenant_id lands on the recorded audit events. Two embed-token endpoints scope
<AuditTrail /> two ways:

  - /api/embed-token/admin    -- no tenant_id, cross-tenant view
  - /api/embed-token/customer -- tenant_id = actor's tenant, scoped view

Uses FastAPI + the SDK's ASGI adapter (``EverscribeMiddleware``): handlers
enrich ``current_event()`` and the middleware auto-records on response finish.
"""

from __future__ import annotations

import os
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path
from secrets import token_hex
from typing import Any, AsyncIterator, Optional

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
class Tenant:
    id: str
    name: str


@dataclass
class User:
    id: str
    name: str
    email: str
    role: str  # "admin" | "member"
    tenant_id: str


@dataclass
class Secret:
    """Internal shape -- ``value`` is never marshaled to clients."""

    id: str
    name: str
    tenant_id: str
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
        "tenant_id": s.tenant_id,
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
by_tenant: dict[str, list[str]] = {}


def create_secret(tenant_id: str, name: str, value: str, created_by: str) -> Secret:
    s = Secret(
        id="sec_" + token_hex(4),
        name=name,
        tenant_id=tenant_id,
        value=value,
        created_by=created_by,
        created_at=_now_iso(),
    )
    vault[s.id] = s
    by_tenant.setdefault(tenant_id, []).append(s.id)
    return s


create_secret("acme", "stripe_api_key", "sk_live_acme_seed", "u_ada")
create_secret("acme", "github_pat", "ghp_acme_seed", "u_ada")
create_secret("initech", "aws_access_key", "AKIA_initech_seed", "u_grace")
create_secret("initech", "slack_webhook", "https://hooks.slack.com/initech_seed", "u_grace")


def list_for_tenant(tenant_id: str) -> list[Secret]:
    ids = by_tenant.get(tenant_id, [])
    return sorted((vault[i] for i in ids), key=lambda s: s.id)


# -------------------------- seeded cast --------------------------

tenants: dict[str, Tenant] = {
    "acme": Tenant("acme", "Acme Corp"),
    "initech": Tenant("initech", "Initech"),
}

users: dict[str, User] = {
    "u_ada": User("u_ada", "Ada Lovelace", "ada@acme.test", "admin", "acme"),
    "u_linus": User("u_linus", "Linus Torvalds", "linus@acme.test", "member", "acme"),
    "u_grace": User("u_grace", "Grace Hopper", "grace@initech.test", "admin", "initech"),
    "u_alan": User("u_alan", "Alan Turing", "alan@initech.test", "member", "initech"),
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
    """Reads the X-Demo-Actor header set by the frontend's login dropdown."""
    u = users.get(request.headers.get("x-demo-actor", ""))
    if u is None:
        return Actor(type="anonymous")
    return Actor(type="user", id=u.id, display_name=u.name, email=u.email)


def actor(request: Request) -> Optional[User]:
    """The User behind X-Demo-Actor -- handlers need both the id (created_by)
    and the tenant (scoping + event.tenant_id)."""
    return users.get(request.headers.get("x-demo-actor", ""))


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    print(f"listening on http://localhost:{port} (project={project_id})")
    yield
    rec.close()


app = FastAPI(lifespan=lifespan)
app.add_middleware(EverscribeMiddleware, recorder=rec, resolve_actor=resolve_actor)


# ----- API routes -----


@app.get("/api/health")
async def health() -> JSONResponse:
    return JSONResponse({"status": "ok"})


@app.get("/api/tenants")
async def list_tenants() -> JSONResponse:
    out = [
        {"id": t.id, "name": t.name}
        for t in sorted(tenants.values(), key=lambda t: t.id)
    ]
    return JSONResponse(out)


@app.get("/api/users")
async def list_users() -> JSONResponse:
    out = [
        {
            "id": u.id,
            "name": u.name,
            "email": u.email,
            "role": u.role,
            "tenant_id": u.tenant_id,
        }
        for u in sorted(users.values(), key=lambda u: u.id)
    ]
    return JSONResponse(out)


@app.get("/api/secrets")
async def list_secrets(request: Request) -> Response:
    me = actor(request)
    if me is None:
        return PlainTextResponse("unknown actor", status_code=401)
    return JSONResponse([to_wire(s) for s in list_for_tenant(me.tenant_id)])


@app.post("/api/secrets")
async def create(request: Request) -> Response:
    me = actor(request)
    if me is None:
        return PlainTextResponse("unknown actor", status_code=401)
    e = current_event()
    e.tenant_id = me.tenant_id

    body = await _json(request)
    name = body.get("name")
    value = body.get("value")
    if not isinstance(name, str) or not name.strip() or not isinstance(value, str) or not value:
        return PlainTextResponse("name and value required", status_code=400)
    s = create_secret(me.tenant_id, name.strip(), value, me.id)

    e.action = "secret.create"
    e.target = Target(type="secret", id=s.id)
    e.with_field("name", s.name)
    return JSONResponse(to_wire(s), status_code=201)


@app.post("/api/secrets/{secret_id}/reveal")
async def reveal(secret_id: str, request: Request) -> Response:
    me = actor(request)
    if me is None:
        return PlainTextResponse("unknown actor", status_code=401)
    e = current_event()
    e.tenant_id = me.tenant_id
    e.target = Target(type="secret", id=secret_id)

    s = vault.get(secret_id)
    if s is None or s.tenant_id != me.tenant_id:
        return PlainTextResponse("not found", status_code=404)
    if s.revoked:
        return PlainTextResponse("revoked", status_code=410)

    e.action = "secret.reveal"
    e.with_field("name", s.name)
    return JSONResponse({"value": s.value})


@app.delete("/api/secrets/{secret_id}")
async def revoke(secret_id: str, request: Request) -> Response:
    me = actor(request)
    if me is None:
        return PlainTextResponse("unknown actor", status_code=401)
    e = current_event()
    e.tenant_id = me.tenant_id
    e.target = Target(type="secret", id=secret_id)

    s = vault.get(secret_id)
    if s is None or s.tenant_id != me.tenant_id:
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
    me = actor(request)
    if me is None:
        return PlainTextResponse("unknown actor", status_code=401)
    e = current_event()
    e.tenant_id = me.tenant_id
    e.target = Target(type="secret", id=secret_id)

    body = await _json(request)
    value = body.get("value")
    if not isinstance(value, str) or not value:
        return PlainTextResponse("value required", status_code=400)
    s = vault.get(secret_id)
    if s is None or s.tenant_id != me.tenant_id:
        return PlainTextResponse("not found", status_code=404)
    if s.revoked:
        return PlainTextResponse("revoked", status_code=410)

    before = snapshot(s)
    s.value = value
    s.rotated_at = _now_iso()
    after = snapshot(s)

    e.action = "secret.rotate"
    e.with_field("name", s.name)
    e.diff(before, after)
    return Response(status_code=204)


@app.post("/api/secrets/{secret_id}/share")
async def share(secret_id: str, request: Request) -> Response:
    me = actor(request)
    if me is None:
        return PlainTextResponse("unknown actor", status_code=401)
    e = current_event()
    e.tenant_id = me.tenant_id
    e.target = Target(type="secret", id=secret_id)

    body = await _json(request)
    user_id = body.get("user_id")
    if not isinstance(user_id, str) or not user_id:
        return PlainTextResponse("user_id required", status_code=400)
    # Sharing only makes sense within the same tenant.
    target = users.get(user_id)
    if target is None or target.tenant_id != me.tenant_id:
        return PlainTextResponse("unknown or out-of-tenant user_id", status_code=400)
    s = vault.get(secret_id)
    if s is None or s.tenant_id != me.tenant_id:
        return PlainTextResponse("not found", status_code=404)
    if user_id not in s.shared_with:
        s.shared_with.append(user_id)

    e.action = "secret.share"
    e.with_fields("name", s.name, "shared_with", user_id)
    return Response(status_code=204)


@app.post("/api/secrets/{secret_id}/expire")
async def expire(secret_id: str, request: Request) -> Response:
    me = actor(request)
    if me is None:
        return PlainTextResponse("unknown actor", status_code=401)
    e = current_event()
    e.tenant_id = me.tenant_id
    e.target = Target(type="secret", id=secret_id)

    body = await _json(request)
    in_minutes = body.get("in_minutes")
    if not isinstance(in_minutes, (int, float)) or in_minutes <= 0:
        return PlainTextResponse("in_minutes required (>0)", status_code=400)
    s = vault.get(secret_id)
    if s is None or s.tenant_id != me.tenant_id:
        return PlainTextResponse("not found", status_code=404)
    when = datetime.now(timezone.utc) + timedelta(minutes=in_minutes)
    s.expires_at = when.isoformat(timespec="seconds").replace("+00:00", "Z")

    e.action = "secret.expire"
    e.with_fields("name", s.name, "expires_at", s.expires_at)
    return Response(status_code=204)


@app.post("/api/embed-token/admin")
async def embed_token_admin() -> Response:
    """Admin embed: token has no tenant_id -- cross-tenant view of all events."""
    try:
        token = minter.mint_token(
            TokenOptions(
                expires_in=60 * 60,
                allowed_actions=["secret.*"],
                allow_dsl_input=True,
                allow_nlp=True,
            )
        )
        # The token is a bearer credential scoped to one viewer. Never let
        # a browser or a shared proxy hold on to it.
        return JSONResponse({"token": token}, headers={"Cache-Control": "no-store"})
    except Exception as err:  # noqa: BLE001 - demo: surface any mint failure
        print("mint admin token:", err)
        return PlainTextResponse("could not mint token", status_code=502)


@app.post("/api/embed-token/customer")
async def embed_token_customer(request: Request) -> Response:
    """Customer embed: token scoped to the actor's tenant."""
    me = actor(request)
    if me is None:
        return PlainTextResponse("unknown actor", status_code=401)
    try:
        token = minter.mint_token(
            TokenOptions(
                tenant_id=me.tenant_id,
                expires_in=60 * 60,
                allowed_actions=["secret.*"],
                # tenant_id is enforced server-side on every read, so the
                # NLP-generated DSL is naturally tenant-scoped too.
                allow_dsl_input=True,
                allow_nlp=True,
            )
        )
        # The token is a bearer credential scoped to one viewer. Never let
        # a browser or a shared proxy hold on to it.
        return JSONResponse({"token": token}, headers={"Cache-Control": "no-store"})
    except Exception as err:  # noqa: BLE001 - demo: surface any mint failure
        print(f"mint customer token (tenant={me.tenant_id}):", err)
        return PlainTextResponse("could not mint token", status_code=502)


# ----- static frontend + SPA fallback -----


@app.get("/{full_path:path}")
async def spa(full_path: str) -> Response:
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
