# Svelte frontend + Go backend · multi-tenant

Secrets-vault demo with two seeded tenants. The UI has two tabs:

- **Customer view** - what your customer's user sees inside their workspace.
  `<AuditTrail />` is scoped to the actor's tenant via `tenant_id` on the minted
  embed token.
- **Admin view** - your business's internal console. `<AuditTrail />` is minted
  with no `tenant_id`, so it sees events across every tenant in the project.

## Prerequisites

- Go 1.25+
- Node 18+
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

Two tenants, two users each - same as the other multi-tenant variants.

| User              | Role   | Tenant   |
|-------------------|--------|----------|
| Ada Lovelace      | admin  | Acme     |
| Linus Torvalds    | member | Acme     |
| Grace Hopper      | admin  | Initech  |
| Alan Turing       | member | Initech  |

Picking a user from the login dropdown changes both the actor on
recorded events and the tenant the Customer view scopes to.

## What's different from the React / Vanilla multi variants?

The Go backend is identical to all the other `*-with-go-be/multi-tenant`
examples. On the frontend:

| Concern                      | React multi             | Vanilla multi                      | Svelte multi                        |
|------------------------------|-------------------------|------------------------------------|-------------------------------------|
| Audit embed                  | `<AuditTrail />`        | `<audit-trail>` custom element     | `<audit-trail>` custom element      |
| Tab switching                | Conditional render      | Toggle parent `display`            | `{#if tab === 'customer'}{:else}`   |
| Customer embed actor remount | `key` prop on component | `replaceWith(...)` on actor change | `{#key actorId}` block              |
| Customer onTokenExpired      | Prop on `<AuditTrail />`| `audit.onTokenExpired = ...`       | `bind:this` + `$effect` sets the JS prop |

### Why `onTokenExpired` for the customer embed?

Same reason as the React and Vanilla multi variants: the component's
built-in `tokenEndpoint` fetcher only sends `credentials: 'include'`,
not custom headers. Our `/api/embed-token/customer` reads `X-Demo-Actor`
to identify the actor's tenant; without it the endpoint 401s. The
callback gives us a place to attach the header.

In Svelte the wiring is `bind:this={customerEmbed}` on the
`<audit-trail>` element, then a `$effect` that sets
`customerEmbed.onTokenExpired = async () => { ... }`. The `{#key actorId}`
block above the embed forces a remount when the actor (and tenant)
changes, so each new instance fetches a fresh token.

The Admin endpoint doesn't need a header, so it stays on the simpler
`token-endpoint` attribute.

## Verbs and events

Same as all other variants. Every recorded event has
`e.TenantID = <actor's tenant>`.

| UI action | HTTP                                  | Event           |
|-----------|---------------------------------------|-----------------|
| Reveal    | `POST /api/secrets/{id}/reveal`       | `secret.reveal` |
| Create    | `POST /api/secrets`                   | `secret.create` |
| Rotate    | `POST /api/secrets/{id}/rotate`       | `secret.rotate` (with redacted before/after) |
| Share     | `POST /api/secrets/{id}/share`        | `secret.share`  |
| Expire    | `POST /api/secrets/{id}/expire`       | `secret.expire` |
| Revoke    | `DELETE /api/secrets/{id}`            | `secret.revoke` |
