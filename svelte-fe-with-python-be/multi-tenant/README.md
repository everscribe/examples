# Svelte frontend + Python backend · multi-tenant

Same multi-tenant secrets-vault demo as the other multi variants. Two seeded
tenants, Customer view scoped via `tenant_id`, Admin view cross-tenant.
Frontend = Svelte 5 + `<audit-trail>` custom element; backend = Python +
FastAPI + the Everscribe Python SDK.

The full security framing lives in the [repo root README](../../README.md).
This file is just how to run.

## Prerequisites

- Python 3.10+
- Node 20+ (to build the frontend)
- An Everscribe project with a `proj_*` ID and an `evs_*` API key

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
python backend/app.py
```

Open <http://localhost:9000>.

## Run (development, with HMR)

```sh
# terminal 1 (backend, from the activated venv)
uvicorn backend.app:app --reload --port 9000

# terminal 2 (frontend)
cd frontend && npm install && npm run dev
```

Open <http://localhost:5173>.

## Demo cast

| User           | Role   | Tenant   |
|----------------|--------|----------|
| Ada Lovelace   | admin  | Acme     |
| Linus Torvalds | member | Acme     |
| Grace Hopper   | admin  | Initech  |
| Alan Turing    | member | Initech  |

## Notes

- The customer-tab embed uses a Svelte action (`use:customerAuditTrail`) to
  create the `<audit-trail>` element imperatively and set `onTokenExpired`
  *before* mount — the element runs its bootstrap check in
  `connectedCallback` and would otherwise error out before Svelte's
  `bind:this` + `$effect` could attach the property.
- The customer mint endpoint (`/api/embed-token/customer`) requires the
  `X-Demo-Actor` header; the callback in the action attaches it.

## Backend

Byte-identical to the React+Python multi-tenant variant's `backend/app.py`.
Each mutating handler resolves the actor from `X-Demo-Actor`, sets
`current_event().tenant_id = me.tenant_id`, and scopes the vault lookup to
that tenant. Two mint endpoints: `/api/embed-token/admin` (no `tenant_id`,
cross-tenant) and `/api/embed-token/customer` (`tenant_id = me.tenant_id`).

## Verbs and events

Every recorded event has `event.tenant_id = <actor's tenant>`.

| UI action | HTTP                            | Event           |
|-----------|---------------------------------|-----------------|
| Reveal    | `POST /api/secrets/{id}/reveal` | `secret.reveal` |
| Create    | `POST /api/secrets`             | `secret.create` |
| Rotate    | `POST /api/secrets/{id}/rotate` | `secret.rotate` |
| Share     | `POST /api/secrets/{id}/share`  | `secret.share`  |
| Expire    | `POST /api/secrets/{id}/expire` | `secret.expire` |
| Revoke    | `DELETE /api/secrets/{id}`      | `secret.revoke` |
