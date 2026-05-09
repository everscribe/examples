# Vanilla JS frontend + Node backend · single-tenant

Same secrets-vault demo as the other single-tenant variants. Frontend =
plain TS + DOM manipulation + the `<audit-trail>` custom element;
backend = Node + Express + `@everscribe/sdk-node`. Smallest bundle of
the three frontends (~12 KB gzip).

The full security framing lives in the [repo root README](../../README.md).
This file is just how to run.

## Prerequisites

- Node 20+
- An Everscribe project with a `proj_*` ID and an `evs_*` API key

## Setup

```sh
cp .env.example .env
```

## Run (single command)

```sh
npm install
npm run build
npm start
```

Open <http://localhost:9000>.

## Run (development, with HMR)

```sh
npm install
cd frontend && npm install && cd ..
npm run dev
```

Open <http://localhost:5173>.

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
| Rotate    | `POST /api/secrets/{id}/rotate`       | `secret.rotate` |
| Share     | `POST /api/secrets/{id}/share`        | `secret.share`  |
| Expire    | `POST /api/secrets/{id}/expire`       | `secret.expire` |
| Revoke    | `DELETE /api/secrets/{id}`            | `secret.revoke` |
