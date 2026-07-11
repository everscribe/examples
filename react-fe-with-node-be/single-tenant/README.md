# React frontend + Node backend · single-tenant

Same secrets-vault demo as the React+Go variant - same UI, same actor
flow, same audit verbs - but the backend is Node + Express + sdk-node.
The frontend is byte-identical (`frontend/` is a fork of the Go variant's
`web/`).

The full security framing lives in the [repo root README](../../README.md).
This file is just how to run.

## Prerequisites

- Node 20+
- An Everscribe project with a `proj_*` ID and an `evs_*` API key

## Setup

```sh
cp .env.example .env
# Fill in EVERSCRIBE_PROJECT_ID and EVERSCRIBE_API_KEY.
```

## Run (single command)

```sh
npm install        # backend deps
npm run build      # builds frontend/dist (also runs npm install in frontend/)
npm start          # tsx backend/index.ts - serves API + static frontend/dist
```

Open <http://localhost:9000>. One process, one port.

## Run (development, with HMR)

`npm run dev` starts both the Node server (under `tsx watch`) and the
Vite dev server in one terminal via `concurrently`. Vite serves the
React app on `:5173` and proxies `/api/*` to the Node server on `:9000`.

```sh
npm install
cd frontend && npm install && cd ..
npm run dev
```

Open <http://localhost:5173>. Output is colour-prefixed (`backend` /
`frontend`) so you can see which side a log line is from.

## What's different from the React+Go variant?

The frontend is unchanged. On the backend:

| Concern               | Go variant                                       | Node variant                                              |
|-----------------------|--------------------------------------------------|-----------------------------------------------------------|
| HTTP layer            | `net/http` + `http.ServeMux`                     | Express                                                   |
| SDK package           | `github.com/everscribe/sdk-go`                   | `@everscribe/sdk-node`                                    |
| Audit middleware      | `event.NewMiddleware(actorResolver)`             | `expressMiddleware({ recorder, resolveActor })` from `@everscribe/sdk-node/express` |
| Per-request event     | `event.FromContext(r.Context())`                 | `req.event!` (installed by the middleware)                |
| Record idiom          | `defer rec.Record(ctx, e)`                       | Set `req.event!.action`; middleware auto-records on response finish |
| Token mint            | `m.MintToken(ctx, minter.TokenOptions{...})`     | `await minter.mintToken({ ... })`                         |
| Static files          | `//go:embed all:web/dist`                        | `express.static(path.join(__dirname, '..', 'frontend', 'dist'))` |
| Single binary?        | Yes - `make build` produces `bin/server`         | No - runs via `tsx backend/index.ts`; serves dist/ from disk  |

### About the "single binary" difference

The Go variant uses `//go:embed` to bake the React bundle into the
compiled binary, so `bin/server` has no on-disk dependencies. Node
doesn't have a clean equivalent without external tooling (pkg, nexe,
bun --compile), so this example takes the standard Node approach:
`express.static('../frontend/dist')` serves the built frontend from disk.
The dev experience is the same; deployment is two artifacts (server
code + dist/) instead of one.

### Field-name conversion

The TS API of `@everscribe/sdk-node` uses **camelCase**
(`req.event.tenantId`, `req.event.actor.displayName`, etc.) while the
wire format and the React frontend's `Secret` interface use
**snake_case** (`tenant_id`, `created_by`). The sdk-node Recorder
handles the wire-side conversion; this server uses a small `toWire()`
helper to translate the in-memory `InternalSecret` (camelCase) to the
public `Secret` shape (snake_case) the frontend expects.

## Demo cast

| ID        | Role   |
|-----------|--------|
| `u_ada`   | admin  |
| `u_alan`  | member |
| `u_grace` | member |

## Verbs and events

Same as the Go variant.

| UI action | HTTP                                  | Event           |
|-----------|---------------------------------------|-----------------|
| Reveal    | `POST /api/secrets/{id}/reveal`       | `secret.reveal` |
| Create    | `POST /api/secrets`                   | `secret.create` |
| Rotate    | `POST /api/secrets/{id}/rotate`       | `secret.rotate` (with redacted before/after) |
| Share     | `POST /api/secrets/{id}/share`        | `secret.share`  |
| Expire    | `POST /api/secrets/{id}/expire`       | `secret.expire` |
| Revoke    | `DELETE /api/secrets/{id}`            | `secret.revoke` |
