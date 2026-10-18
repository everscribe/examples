# React frontend + Python backend · multi-tenant

Secrets-vault demo with two seeded tenants. The UI has two tabs:

- **Customer view** - what your customer's user sees inside their workspace.
  `<AuditTrail />` is scoped to the actor's tenant via `tenant_id` on the minted
  embed token.
- **Admin view** - your business's internal console. `<AuditTrail />` is minted
  with no `tenant_id`, so it sees events across every tenant in the project.

## Prerequisites

- Python 3.10+
- Node 20+ (to build the frontend)
- An Everscribe project with a `proj_*` ID and an `evs_*` API key ([create an account](https://everscribe.io/signup))

## Setup

```sh
cp .env.example .env
# Fill in EVERSCRIBE_PROJECT_ID and EVERSCRIBE_API_KEY.
```

## Run (single port)

```sh
python3 -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt
(cd frontend && npm install && npm run build)
python backend/app.py                    # serves API + static frontend/dist
```

Open <http://localhost:9000>.

## Run (development, with HMR)

Two terminals - uvicorn's reloader and the Vite dev server (which proxies
`/api/*` to `:9000`):

```sh
# terminal 1 (backend, from the activated venv)
uvicorn backend.app:app --reload --port 9000

# terminal 2 (frontend)
cd frontend && npm install && npm run dev
```

Open <http://localhost:5173>.

## Demo cast

Two tenants, two users each - same as the other multi variants.

| User           | Role   | Tenant   |
|----------------|--------|----------|
| Ada Lovelace   | admin  | Acme     |
| Linus Torvalds | member | Acme     |
| Grace Hopper   | admin  | Initech  |
| Alan Turing    | member | Initech  |

The login dropdown changes both the actor on recorded events and the tenant
the Customer view scopes to.

## What's different from the React+Node multi variant?

The frontend is unchanged - same `App.tsx`, same `onTokenExpired` callback
for the customer embed (the component's built-in `tokenEndpoint` fetcher only
sends `credentials: 'include'`, not custom headers, so a custom fetcher is
needed to attach `X-Demo-Actor`).

On the backend:

| Concern            | Node multi                                          | Python multi                                                              |
|--------------------|-----------------------------------------------------|---------------------------------------------------------------------------|
| HTTP layer         | Express                                             | FastAPI (ASGI)                                                            |
| SDK                | `@everscribe/sdk-node`                             | `everscribe[fastapi]` (PyPI)                                    |
| Audit middleware   | `expressMiddleware({ recorder, resolveActor })`    | `app.add_middleware(EverscribeMiddleware, recorder=rec, resolve_actor=...)` |
| Per-event tenant   | `req.event!.tenantId = me.tenantId`                | `current_event().tenant_id = me.tenant_id`                                |
| Token mint         | `await minter.mintToken({ tenantId: ... })`        | `minter.mint_token(TokenOptions(tenant_id=...))`                           |
| Static files       | `express.static('frontend/dist')`                  | FastAPI catch-all serving `frontend/dist` + SPA fallback                   |

The two-mint-endpoints pattern is identical:

- `/api/embed-token/admin` - no `tenant_id` → cross-tenant view
- `/api/embed-token/customer` - `tenant_id = me.tenant_id` → tenant-scoped view (requires `X-Demo-Actor` header)

Each mutating handler resolves the actor from `X-Demo-Actor`, sets
`current_event().tenant_id = me.tenant_id`, and scopes the vault lookup to
that tenant (cross-tenant access returns 404).

## Verbs and events

Same as the other multi variants. Every recorded event has
`event.tenant_id = <actor's tenant>`.

| UI action | HTTP                            | Event           |
|-----------|---------------------------------|-----------------|
| Reveal    | `POST /api/secrets/{id}/reveal` | `secret.reveal` |
| Create    | `POST /api/secrets`             | `secret.create` |
| Rotate    | `POST /api/secrets/{id}/rotate` | `secret.rotate` (with redacted before/after) |
| Share     | `POST /api/secrets/{id}/share`  | `secret.share`  |
| Expire    | `POST /api/secrets/{id}/expire` | `secret.expire` |
| Revoke    | `DELETE /api/secrets/{id}`      | `secret.revoke` |
