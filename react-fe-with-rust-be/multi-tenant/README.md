# React frontend + Rust backend · multi-tenant

Same multi-tenant secrets-vault demo as the React+Node/Go/Python multi variants
- two seeded tenants, Customer view scoped via `tenant_id`, Admin view
cross-tenant - but the backend is Rust + axum + the Everscribe Rust SDK. The
frontend is byte-identical to the Node variant's `frontend/`.

The full security framing lives in the [repo root README](../../README.md).
This file is just how to run.

## Prerequisites

- Rust 1.85+
- Node 20+ (to build the frontend)
- An Everscribe project with a `proj_*` ID and an `evs_*` API key

## Setup

```sh
cp .env.example .env
# Fill in EVERSCRIBE_PROJECT_ID and EVERSCRIBE_API_KEY.
```

## Run (single port)

```sh
(cd frontend && npm install && npm run build)
cargo run
```

Open <http://localhost:9000>.

## Run (development, with HMR)

```sh
# terminal 1 (backend)
cargo run

# terminal 2 (frontend)
cd frontend && npm install && npm run dev
```

Open <http://localhost:5173>.

## Demo cast

Two tenants, two users each.

| User           | Role   | Tenant   |
|----------------|--------|----------|
| Ada Lovelace   | admin  | Acme     |
| Linus Torvalds | member | Acme     |
| Grace Hopper   | admin  | Initech  |
| Alan Turing    | member | Initech  |

The login dropdown changes both the actor on recorded events and the tenant the
Customer view scopes to.

## What's different from the React+Node multi variant?

The frontend is unchanged - same `App.tsx`, same `onTokenExpired` callback for
the customer embed (the component's built-in `tokenEndpoint` fetcher only sends
`credentials: 'include'`, not custom headers, so a custom fetcher is needed to
attach `X-Demo-Actor`).

On the backend:

| Concern            | Node multi                                          | Rust multi                                                        |
|--------------------|-----------------------------------------------------|------------------------------------------------------------------|
| HTTP layer         | Express                                             | axum (tokio)                                                     |
| SDK                | `@everscribe/sdk-node`                              | `everscribe` (`path = "../../../sdk-rust"`, `features = ["axum"]`)|
| Audit middleware   | `expressMiddleware({ recorder, resolveActor })`    | `.layer(EverscribeLayer::new(recorder, resolve_actor))`         |
| Per-event tenant   | `req.event!.tenantId = me.tenantId`                | `ev.with(|e| e.tenant_id = me.tenant_id.clone())`               |
| Token mint         | `await minter.mintToken({ tenantId: ... })`        | `minter.mint_token(&TokenOptions { tenant_id, .. }).await`       |
| Static files       | `express.static('frontend/dist')`                  | `tower_http::services::ServeDir` with SPA fallback               |

The two-mint-endpoints pattern is identical:

- `/api/embed-token/admin` - no `tenant_id` → cross-tenant view
- `/api/embed-token/customer` - `tenant_id = me.tenant_id` → tenant-scoped view (requires `X-Demo-Actor` header)

Each mutating handler resolves the acting user from the resolved actor, sets
`current_event().tenant_id`, and scopes the vault lookup to that tenant
(cross-tenant access returns 404).

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
