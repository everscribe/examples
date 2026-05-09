# Vanilla JS frontend + Node backend · multi-tenant

Same multi-tenant secrets-vault demo as the other multi variants.
Frontend = plain TS + DOM manipulation + `<audit-trail>` custom
element; backend = Node + Express + `@everscribe/sdk-node`. Two
seeded tenants, Customer view scoped via `tenantId`, Admin view
cross-tenant.

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

| User              | Role   | Tenant   |
|-------------------|--------|----------|
| Ada Lovelace      | admin  | Acme     |
| Linus Torvalds    | member | Acme     |
| Grace Hopper      | admin  | Initech  |
| Alan Turing       | member | Initech  |

## Notes

- The customer-tab embed sets `onTokenExpired` directly on the
  `<audit-trail>` element instance before appending it to the DOM —
  required because `/api/embed-token/customer` reads `X-Demo-Actor`,
  which the component's built-in fetcher doesn't send.
- When the actor changes, the customer embed is replaced with a fresh
  element (`replaceWith`) so the new tenant's token is fetched.

## Verbs and events

Same as all other variants. Every recorded event has
`event.tenantId = <actor's tenant>`.

| UI action | HTTP                                  | Event           |
|-----------|---------------------------------------|-----------------|
| Reveal    | `POST /api/secrets/{id}/reveal`       | `secret.reveal` |
| Create    | `POST /api/secrets`                   | `secret.create` |
| Rotate    | `POST /api/secrets/{id}/rotate`       | `secret.rotate` |
| Share     | `POST /api/secrets/{id}/share`        | `secret.share`  |
| Expire    | `POST /api/secrets/{id}/expire`       | `secret.expire` |
| Revoke    | `DELETE /api/secrets/{id}`            | `secret.revoke` |
