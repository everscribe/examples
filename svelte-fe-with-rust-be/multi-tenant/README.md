# Svelte frontend + Rust backend · multi-tenant

Same multi-tenant secrets-vault demo as the other multi variants. Two seeded
tenants, Customer view scoped via `tenant_id`, Admin view cross-tenant. Frontend
= Svelte 5 + `<audit-trail>` custom element; backend = Rust + axum + the
Everscribe Rust SDK.

The full security framing lives in the [repo root README](../../README.md).
This file is just how to run.

## Prerequisites

- Rust 1.85+
- Node 20+ (to build the frontend)
- An Everscribe project with a `proj_*` ID and an `evs_*` API key

## Setup

```sh
cp .env.example .env
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

| User           | Role   | Tenant   |
|----------------|--------|----------|
| Ada Lovelace   | admin  | Acme     |
| Linus Torvalds | member | Acme     |
| Grace Hopper   | admin  | Initech  |
| Alan Turing    | member | Initech  |

## Notes

- The customer-tab embed uses a Svelte action (`use:customerAuditTrail`) to
  create the `<audit-trail>` element imperatively and set `onTokenExpired`
  before mount; the customer mint endpoint (`/api/embed-token/customer`)
  requires the `X-Demo-Actor` header, which the callback attaches.

## Backend

Byte-identical to the React+Rust multi-tenant variant's `src/main.rs`. Each
mutating handler resolves the acting user, sets `current_event().tenant_id`, and
scopes the vault lookup to that tenant. Two mint endpoints:
`/api/embed-token/admin` (no `tenant_id`) and `/api/embed-token/customer`
(`tenant_id = me.tenant_id`).

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
