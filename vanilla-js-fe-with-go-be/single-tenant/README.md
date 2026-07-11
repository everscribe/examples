# Vanilla JS frontend + Go backend · single-tenant

Same secrets-vault demo as the React variant, but the frontend is plain
TypeScript + DOM manipulation. The audit-log embed is the
`<audit-trail>` custom element from
`@everscribe/components-element` - auto-registered on import,
framework-agnostic, drops in anywhere a custom element works.

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
make build       # npm run build → web/dist, then go build → bin/server
make run         # or: ./bin/server
```

Open <http://localhost:9000>.

## Run (development, with HMR)

```sh
make dev-server   # terminal 1
make dev-web      # terminal 2
```

Open <http://localhost:5173>.

## What's different from the React variant?

The Go backend is identical - same handlers, same recorder/minter wiring,
same fake-login via `X-Demo-Actor`. The frontend is the only thing that
changes:

| Concern                | React variant                           | Vanilla JS variant                                     |
|------------------------|-----------------------------------------|--------------------------------------------------------|
| Audit embed            | `<AuditTrail />` from `components-react`| `<audit-trail>` custom element from `components-element` |
| Mount                  | `createRoot(...).render(<App />)`       | `document.createElement` + manual append               |
| State                  | `useState` / `useMemo`                  | A plain `state` object + targeted re-renders           |
| Markup                 | JSX                                     | Tiny `el(tag, attrs, ...children)` helper              |
| Bundle size (gzipped)  | ~52 KB                                  | ~12 KB                                                 |

The audit component is **framework-agnostic** - Svelte, Solid, plain
HTML, anywhere a custom element works. See `<audit-trail>` mounted in
[web/src/app.ts](web/src/app.ts).

## Verbs and events

Same as the React variant.

| UI action | HTTP                                  | Event           |
|-----------|---------------------------------------|-----------------|
| Reveal    | `POST /api/secrets/{id}/reveal`       | `secret.reveal` |
| Create    | `POST /api/secrets`                   | `secret.create` |
| Rotate    | `POST /api/secrets/{id}/rotate`       | `secret.rotate` (with redacted before/after) |
| Share     | `POST /api/secrets/{id}/share`        | `secret.share`  |
| Expire    | `POST /api/secrets/{id}/expire`       | `secret.expire` |
| Revoke    | `DELETE /api/secrets/{id}`            | `secret.revoke` |
