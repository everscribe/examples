# Vanilla JS frontend + Go backend · multi-tenant

Same multi-tenant secrets-vault demo as the React variant, but the
frontend is plain TypeScript + DOM manipulation. The audit-log embeds
are two `<audit-trail>` custom elements from
`@everscribe/components-element`, each minted with a different scope:

- **Customer view** - token scoped to the actor's tenant. Embed only
  shows that tenant's events.
- **Admin view** - token has no `tenant_id`. Embed shows events across
  every tenant in the project.

The full security framing lives in the [repo root README](../../README.md).
This file is just how to run.

## Prerequisites

- Go 1.25+
- Node 18+ (for Vite - the bundler)
- An Everscribe project with a `proj_*` ID and an `evs_*` API key

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
