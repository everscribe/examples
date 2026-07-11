# React frontend + Go backend · single-tenant

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

Three seeded users (login dropdown, top-right):

| ID        | Role   |
|-----------|--------|
| `u_ada`   | admin  |
| `u_alan`  | member |
| `u_grace` | member |

Three seeded secrets. Switch users to see the actor on each event change
in the audit trail.

## Verbs and events

| UI action | HTTP                                  | Event           |
|-----------|---------------------------------------|-----------------|
| Reveal    | `POST /api/secrets/{id}/reveal`       | `secret.reveal` |
| Create    | `POST /api/secrets`                   | `secret.create` |
| Rotate    | `POST /api/secrets/{id}/rotate`       | `secret.rotate` (with redacted before/after) |
| Share     | `POST /api/secrets/{id}/share`        | `secret.share`  |
| Expire    | `POST /api/secrets/{id}/expire`       | `secret.expire` |
| Revoke    | `DELETE /api/secrets/{id}`            | `secret.revoke` |

## Where things live

- `//go:embed all:web/dist` and `newStaticHandler` in
  [main.go](main.go) bake the React app into the binary.
- Every mutating handler uses the `defer rec.Record(...)` idiom with
  `event.FromContext(ctx)`.
- `withActorHeader` reads `X-Demo-Actor` (set by the login dropdown via
  `localStorage`) and plants the id on context; `actorResolver` then
  uses it inside `event.NewMiddleware`.
- `<AuditTrail tokenEndpoint="/api/embed-token" defaultTimeRange="7d" />`
  is mounted in [web/src/App.tsx](web/src/App.tsx), wrapped in a dashed
  border + corner badge so it's visually obvious which pixels are the
  embedded component.
