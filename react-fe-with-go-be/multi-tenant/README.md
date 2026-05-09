# React frontend + Go backend · multi-tenant

Secrets-vault demo with two seeded tenants. The UI has two tabs:

- **Customer view** — what your customer's user sees inside their workspace.
  `<AuditTrail />` is scoped to the actor's tenant via `tenant_id` on the minted
  embed token.
- **Admin view** — your business's internal console. `<AuditTrail />` is minted
  with no `tenant_id`, so it sees events across every tenant in the project.

The full security framing lives in the [repo root README](../../README.md).
This file is just how to run.

## Prerequisites

- Go 1.25+
- Node 18+
- An Everscribe project with a `proj_*` ID and an `evs_*` API key

## Setup

```sh
cp .env.example .env
# Fill in EVERSCRIBE_PROJECT_ID and EVERSCRIBE_API_KEY.
```

## Run (single binary)

```sh
make build       # npm run build → web/dist, then go build → bin/server
make run         # or: ./bin/server
```

Open <http://localhost:9000>.

## Run (development, with HMR)

Two terminals. Vite serves the React app on `:5173` and proxies `/api/*`
to the Go server on `:9000`.

```sh
make dev-server   # terminal 1
make dev-web      # terminal 2
```

Open <http://localhost:5173>.

## Demo cast

Two tenants, two users each:

| User              | Role   | Tenant   |
|-------------------|--------|----------|
| Ada Lovelace      | admin  | Acme     |
| Linus Torvalds    | member | Acme     |
| Grace Hopper      | admin  | Initech  |
| Alan Turing       | member | Initech  |

Picking a user from the login dropdown changes both the actor on recorded
events and the tenant the Customer view scopes to. The Admin view ignores
tenant — pick any user and switch tabs to see all-tenant events.

The vault is partitioned per-tenant: Ada and Linus see Acme's secrets, Grace
and Alan see Initech's. Cross-tenant access (e.g. Grace trying to reveal an
Acme secret by id) returns 404.

## Verbs and events

Same as single-tenant. Every recorded event also has `e.TenantID = <actor's
tenant>` so the Customer-view embed can filter to it server-side.

| UI action | HTTP                                  | Event           |
|-----------|---------------------------------------|-----------------|
| Reveal    | `POST /api/secrets/{id}/reveal`       | `secret.reveal` |
| Create    | `POST /api/secrets`                   | `secret.create` |
| Rotate    | `POST /api/secrets/{id}/rotate`       | `secret.rotate` (with redacted before/after) |
| Share     | `POST /api/secrets/{id}/share`        | `secret.share`  |
| Expire    | `POST /api/secrets/{id}/expire`       | `secret.expire` |
| Revoke    | `DELETE /api/secrets/{id}`            | `secret.revoke` |

## What to look at

- `embedTokenAdmin` vs `embedTokenCustomer` in [main.go](main.go) — same
  call, different `minter.TokenOptions{TenantID: ...}` for the customer
  variant. This is the entire scoping mechanism.
- The `key` prop on each `<AuditTrail />` mount in
  [web/src/App.tsx](web/src/App.tsx) forces a remount on tenant change,
  so the embed re-fetches a fresh token when the actor switches.
- Sharing is restricted to same-tenant candidates in
  [web/src/App.tsx](web/src/App.tsx); the backend in [main.go](main.go)
  enforces the same constraint server-side.
