# Vanilla JS frontend + Rust backend · single-tenant

Same secrets-vault demo as the other single-tenant variants. Frontend = plain
TS + DOM manipulation + the `<audit-trail>` custom element; backend = Rust +
axum + the Everscribe Rust SDK. Smallest bundle of the three frontends
(~12 KB gzip).

The full security framing lives in the [repo root README](../../README.md).
This file is just how to run.

## Prerequisites

- Rust 1.85+
- Node 20+ (to build the frontend)
- An Everscribe project with a `proj_*` ID and an `evs_*` API key

## Setup

```sh
cp .env.example .env
```

## Run (single port)

```sh
(cd frontend && npm install && npm run build)
cargo run
```

Open <http://localhost:9000>.

## Run (development, with HMR)

```sh
# terminal 1 (backend)
cargo run

# terminal 2 (frontend)
cd frontend && npm install && npm run dev
```

Open <http://localhost:5173>.

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
| Rotate    | `POST /api/secrets/{id}/rotate` | `secret.rotate` |
| Share     | `POST /api/secrets/{id}/share`  | `secret.share`  |
| Expire    | `POST /api/secrets/{id}/expire` | `secret.expire` |
| Revoke    | `DELETE /api/secrets/{id}`      | `secret.revoke` |

## What's different from the other variants?

- Frontend = plain TypeScript + DOM manipulation, mounting the `<audit-trail>`
  custom element from `@everscribe/components-element` via
  `createElement`/`setAttribute`. No framework.
- Backend = Rust + axum + the Everscribe Rust SDK, using `EverscribeLayer` and
  the `CurrentEvent` extractor. Byte-identical to the React+Rust variant's
  `src/main.rs`.
