# Svelte frontend + Rust backend · single-tenant

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
| Rotate    | `POST /api/secrets/{id}/rotate` | `secret.rotate` (with redacted before/after) |
| Share     | `POST /api/secrets/{id}/share`  | `secret.share`  |
| Expire    | `POST /api/secrets/{id}/expire` | `secret.expire` |
| Revoke    | `DELETE /api/secrets/{id}`      | `secret.revoke` |

## What's different from the other variants?

- Frontend = Svelte 5 (`App.svelte`) using runes + the `<audit-trail>` custom
  element from `@everscribe/components-element`. Same component as the Vanilla
  JS variants.
- Backend = Rust + axum + the Everscribe Rust SDK, using `EverscribeLayer` and
  the `CurrentEvent` extractor. Byte-identical to the React+Rust variant's
  `src/main.rs` (the backend only serves `/api` and the built `frontend/dist`).
