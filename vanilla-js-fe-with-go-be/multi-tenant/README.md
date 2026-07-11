# Vanilla JS frontend + Go backend · multi-tenant

Secrets-vault demo with two seeded tenants. The UI has two tabs:

- **Customer view** - what your customer's user sees inside their workspace.
  `<AuditTrail />` is scoped to the actor's tenant via `tenant_id` on the minted
  embed token.
- **Admin view** - your business's internal console. `<AuditTrail />` is minted
  with no `tenant_id`, so it sees events across every tenant in the project.

## Prerequisites

- Go 1.25+
- Node 18+ (for Vite - the bundler)
- An Everscribe project with a `proj_*` ID and an `evs_*` API key ([create an account](https://everscribe.io/signup))

## Setup

```sh
cp .env.example .env
# Fill in EVERSCRIBE_PROJECT_ID and EVERSCRIBE_API_KEY.
```

## Run (single binary)

```sh
make build
make run
```

Open <http://localhost:9000>.

## Run (development, with HMR)

```sh
make dev-server   # terminal 1
make dev-web      # terminal 2
```

Open <http://localhost:5173>.

## Demo cast

Two tenants, two users each - same as the React multi variant.

| User              | Role   | Tenant   |
|-------------------|--------|----------|
| Ada Lovelace      | admin  | Acme     |
| Linus Torvalds    | member | Acme     |
| Grace Hopper      | admin  | Initech  |
| Alan Turing       | member | Initech  |

The login dropdown changes both the actor on recorded events and the
tenant the Customer view scopes to. The Admin view is cross-tenant.

## What's different from the React multi variant?

The Go backend is identical. On the frontend:

| Concern                          | React multi             | Vanilla multi                 |
|----------------------------------|-------------------------|-------------------------------|
| Audit embed                      | `<AuditTrail />`        | `<audit-trail>` custom element |
| Tab switching                    | Conditional render      | Toggle parent `display`       |
| Customer embed actor change      | `key` prop remount      | `replaceWith(...)` on actor change |
| Customer embed token fetch       | `onTokenExpired` callback (sends X-Demo-Actor) | Same - JS-only `onTokenExpired` property on the element |

### Why `onTokenExpired` for the customer embed?

The component's built-in `tokenEndpoint` fetcher only sends
`credentials: 'include'` - no custom headers. Our
`/api/embed-token/customer` reads `X-Demo-Actor` to identify the
actor's tenant; without that header it 401s. `onTokenExpired` lets us
write the fetch ourselves and attach the header. The Admin endpoint
doesn't need an actor, so it stays on the simpler `token-endpoint`
attribute.

## Verbs and events

Same as the React multi variant. Every recorded event has
`e.TenantID = <actor's tenant>`.

| UI action | HTTP                                  | Event           |
|-----------|---------------------------------------|-----------------|
| Reveal    | `POST /api/secrets/{id}/reveal`       | `secret.reveal` |
| Create    | `POST /api/secrets`                   | `secret.create` |
| Rotate    | `POST /api/secrets/{id}/rotate`       | `secret.rotate` (with redacted before/after) |
| Share     | `POST /api/secrets/{id}/share`        | `secret.share`  |
| Expire    | `POST /api/secrets/{id}/expire`       | `secret.expire` |
| Revoke    | `DELETE /api/secrets/{id}`            | `secret.revoke` |
