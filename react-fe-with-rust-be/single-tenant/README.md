# React frontend + Rust backend · single-tenant

## Prerequisites

- Rust 1.85+
- Node 20+ (to build the frontend)
- An Everscribe project with a `proj_*` ID and an `evs_*` API key ([create an account](https://everscribe.io/signup))

## Setup

```sh
cp .env.example .env
# Fill in EVERSCRIBE_PROJECT_ID and EVERSCRIBE_API_KEY.
```

## Run (single port)

```sh
(cd frontend && npm install && npm run build)   # builds frontend/dist
cargo run                                        # serves API + static frontend/dist
```

Open <http://localhost:9000>. One process, one port. The SDK comes from
crates.io (`everscribe = { version = "0.1.1", features = ["axum"] }`).

## Run (development, with HMR)

Two terminals. The first runs the axum server; the second runs the Vite dev
server on `:5173`, which proxies `/api/*` to `:9000`.

```sh
# terminal 1 (backend)
cargo run

# terminal 2 (frontend)
cd frontend && npm install && npm run dev
```

Open <http://localhost:5173>.

## What's different from the React+Node variant?

The frontend is unchanged. On the backend:

| Concern            | Node variant                                        | Rust variant                                                        |
|--------------------|-----------------------------------------------------|--------------------------------------------------------------------|
| HTTP layer         | Express                                             | axum (tokio)                                                       |
| SDK package        | `@everscribe/sdk-node`                              | `everscribe` (crates.io, `features = ["axum"]`)  |
| Audit middleware   | `expressMiddleware({ recorder, resolveActor })`    | `.layer(EverscribeLayer::new(recorder, resolve_actor))`            |
| Per-request event  | `req.event!`                                        | the `CurrentEvent` extractor (`event.with(|e| ...)`)              |
| Record idiom       | Set `req.event!.action`; middleware auto-records    | Set `action` on `CurrentEvent`; the layer auto-records on finish   |
| Token mint         | `await minter.mintToken({ ... })`                  | `minter.mint_token(&TokenOptions { ... }).await`                   |
| Static files       | `express.static('frontend/dist')`                  | `tower_http::services::ServeDir` with SPA fallback                  |
| Run                | `tsx backend/index.ts`                             | `cargo run`                                                        |

Both backends use the SDK's framework middleware and its auto-record-on-finish
behavior, so the handler code reads the same shape: set the action on the
request-scoped event and return your response.

### Field names

The Rust SDK uses **snake_case** everywhere (`event.action`, `event.tenant_id`,
`event.actor.display_name`), matching the wire format. The outcome type is named
`Outcome` (to avoid clashing with `std::result::Result`) but still serializes to
the wire field `result`. Secrets are converted to their public shape by a small
`to_wire` helper that drops the `value` before returning them.

## Demo cast

| ID        | Role   |
|-----------|--------|
| `u_ada`   | admin  |
| `u_alan`  | member |
| `u_grace` | member |

## Verbs and events

| UI action | HTTP                            | Event           |
|-----------|---------------------------------|-----------------|
| Reveal    | `POST /api/secrets/{id}/reveal` | `secret.reveal` |
| Create    | `POST /api/secrets`             | `secret.create` |
| Rotate    | `POST /api/secrets/{id}/rotate` | `secret.rotate` (with redacted before/after) |
| Share     | `POST /api/secrets/{id}/share`  | `secret.share`  |
| Expire    | `POST /api/secrets/{id}/expire` | `secret.expire` |
| Revoke    | `DELETE /api/secrets/{id}`      | `secret.revoke` |
