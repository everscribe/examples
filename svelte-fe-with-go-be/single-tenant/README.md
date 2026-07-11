# Svelte frontend + Go backend · single-tenant

Same secrets-vault demo as the React and Vanilla JS variants. The audit
embed is the `<audit-trail>` custom element from
`@everscribe/components-element` - Svelte renders it like any other tag,
no wrapper needed. The vault UI is a single-component Svelte 5 app
using runes (`$state`, `$derived`, `$effect`).

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

## What's different from the React / Vanilla variants?

The Go backend is identical. On the frontend:

| Concern              | React                       | Vanilla JS                       | Svelte                           |
|----------------------|-----------------------------|----------------------------------|----------------------------------|
| Audit embed          | `<AuditTrail />` (`components-react`) | `<audit-trail>` (`components-element`) | `<audit-trail>` (`components-element`) |
| State                | `useState`/`useMemo`        | Plain object + manual re-render  | Runes: `$state`, `$derived`, `$effect` |
| Markup               | JSX                         | `el(tag, attrs, ...)` helper     | `.svelte` template syntax        |
| Bundle (gzip)        | ~56 KB                      | ~12 KB                           | ~28 KB                           |

Same `<audit-trail>` web component as the Vanilla example - Svelte just
mounts it inside its own templating. See `App.svelte` for how the
`token-endpoint`, `poll-interval`, etc. attributes flow through.

## Demo cast

| ID        | Role   |
|-----------|--------|
| `u_ada`   | admin  |
| `u_alan`  | member |
| `u_grace` | member |

## Verbs and events

Same as the other single-tenant variants.

| UI action | HTTP                                  | Event           |
|-----------|---------------------------------------|-----------------|
| Reveal    | `POST /api/secrets/{id}/reveal`       | `secret.reveal` |
| Create    | `POST /api/secrets`                   | `secret.create` |
| Rotate    | `POST /api/secrets/{id}/rotate`       | `secret.rotate` (with redacted before/after) |
| Share     | `POST /api/secrets/{id}/share`        | `secret.share`  |
| Expire    | `POST /api/secrets/{id}/expire`       | `secret.expire` |
| Revoke    | `DELETE /api/secrets/{id}`            | `secret.revoke` |
