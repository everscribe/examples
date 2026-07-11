# Svelte frontend + Node backend · single-tenant

## Prerequisites

- Node 20+
- An Everscribe project with a `proj_*` ID and an `evs_*` API key ([create an account](https://everscribe.io/signup))

## Setup

```sh
cp .env.example .env
# Fill in EVERSCRIBE_PROJECT_ID and EVERSCRIBE_API_KEY.
```

## Run (single command)

```sh
npm install
npm run build      # builds frontend/dist
npm start          # tsx backend/index.ts - serves API + static frontend/dist
```

Open <http://localhost:9000>.

## Run (development, with HMR)

```sh
npm install
cd frontend && npm install && cd ..
npm run dev
```

Open <http://localhost:5173>. Output is colour-prefixed (`backend` /
`frontend`).

## Demo cast

| ID        | Role   |
|-----------|--------|
| `u_ada`   | admin  |
| `u_alan`  | member |
| `u_grace` | member |

## Verbs and events

| UI action | HTTP                                  | Event           |
|-----------|---------------------------------------|-----------------|
| Reveal    | `POST /api/secrets/{id}/reveal`       | `secret.reveal` |
| Create    | `POST /api/secrets`                   | `secret.create` |
| Rotate    | `POST /api/secrets/{id}/rotate`       | `secret.rotate` (with redacted before/after) |
| Share     | `POST /api/secrets/{id}/share`        | `secret.share`  |
| Expire    | `POST /api/secrets/{id}/expire`       | `secret.expire` |
| Revoke    | `DELETE /api/secrets/{id}`            | `secret.revoke` |

## What's different from the other variants?

- Frontend = Svelte 5 (`App.svelte`) using runes + the `<audit-trail>`
  custom element from `@everscribe/components-element`. Same component
  as the Vanilla JS variants - Svelte just mounts it inside its own
  templating.
- Backend = Node + Express + `@everscribe/sdk-node`. Same code as the
  React+Node variant.
