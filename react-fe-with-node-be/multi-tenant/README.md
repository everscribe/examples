# React frontend + Node backend · multi-tenant

Secrets-vault demo with two seeded tenants. The UI has two tabs:

- **Customer view** - what your customer's user sees inside their workspace.
  `<AuditTrail />` is scoped to the actor's tenant via `tenant_id` on the minted
  embed token.
- **Admin view** - your business's internal console. `<AuditTrail />` is minted
  with no `tenant_id`, so it sees events across every tenant in the project.

## Prerequisites

- Node 20+
- An Everscribe project with a `proj_*` ID and an `evs_*` API key ([create an account](https://everscribe.io/signup))

## Setup

```sh
cp .env.example .env
# Fill in EVERSCRIBE_PROJECT_ID and EVERSCRIBE_API_KEY.
```

## Run (single command)

```sh
npm install        # backend deps
npm run build      # builds frontend/dist
npm start          # tsx backend/index.ts - serves API + static frontend/dist
```

Open <http://localhost:9000>.

## Run (development, with HMR)

`npm run dev` starts both the Node backend (under `tsx watch`) and the
Vite dev server in one terminal via `concurrently`.

```sh
npm install
cd frontend && npm install && cd ..
npm run dev
```

Open <http://localhost:5173>. Output is colour-prefixed (`backend` /
`frontend`).

## Demo cast

Two tenants, two users each - same as the other multi variants.

| User              | Role   | Tenant   |
|-------------------|--------|----------|
| Ada Lovelace      | admin  | Acme     |
| Linus Torvalds    | member | Acme     |
| Grace Hopper      | admin  | Initech  |
| Alan Turing       | member | Initech  |

The login dropdown changes both the actor on recorded events and the
tenant the Customer view scopes to.

## What's different from the React+Go multi variant?

The frontend is unchanged - same `App.tsx`, same `onTokenExpired`
callback for the customer embed (the component's built-in tokenEndpoint
fetcher only sends `credentials: 'include'`, not custom headers, so we
need a custom fetcher to attach `X-Demo-Actor`).

On the backend:

| Concern              | Go multi                                            | Node multi                                                |
|----------------------|-----------------------------------------------------|-----------------------------------------------------------|
| HTTP layer           | `net/http`                                          | Express                                                   |
| SDK                  | `github.com/everscribe/sdk-go`                      | `@everscribe/sdk-node`                                    |
| Audit middleware     | `event.Middleware(event.Options{...})`                | `expressMiddleware({ recorder, resolveActor })`           |
| Per-event tenantId   | `e.TenantID = me.TenantID`                          | `req.event!.tenantId = me.tenantId` (camelCase in TS)     |
| Token mint           | `m.MintToken(ctx, minter.TokenOptions{TenantID:...})` | `await minter.mintToken({ tenantId: ... })`             |
| Static files         | `//go:embed all:web/dist`                           | `express.static('frontend/dist')`                         |

The two-mint-endpoints pattern is identical:

- `/api/embed-token/admin` - no `tenantId` → cross-tenant view
- `/api/embed-token/customer` - `tenantId = me.tenantId` → tenant-scoped view (requires `X-Demo-Actor` header)

## Verbs and events

Same as the other multi variants. Every recorded event has
`event.tenantId = <actor's tenant>`.

| UI action | HTTP                                  | Event           |
|-----------|---------------------------------------|-----------------|
| Reveal    | `POST /api/secrets/{id}/reveal`       | `secret.reveal` |
| Create    | `POST /api/secrets`                   | `secret.create` |
| Rotate    | `POST /api/secrets/{id}/rotate`       | `secret.rotate` (with redacted before/after) |
| Share     | `POST /api/secrets/{id}/share`        | `secret.share`  |
| Expire    | `POST /api/secrets/{id}/expire`       | `secret.expire` |
| Revoke    | `DELETE /api/secrets/{id}`            | `secret.revoke` |
