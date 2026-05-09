# Svelte frontend + Node backend · multi-tenant

Same multi-tenant secrets-vault demo as the other multi variants. Two
seeded tenants, Customer view scoped via `tenantId`, Admin view
cross-tenant. Frontend = Svelte 5 + `<audit-trail>` custom element;
backend = Node + Express + `@everscribe/sdk-node`.

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

- The customer-tab embed uses a Svelte action (`use:customerAuditTrail`)
  to create the `<audit-trail>` element imperatively and set
  `onTokenExpired` *before* mount — the element runs its bootstrap
  check in `connectedCallback` and would otherwise error out before
  Svelte's `bind:this` + `$effect` could attach the property.
- The customer mint endpoint requires the `X-Demo-Actor` header; the
  callback in the action attaches it.

## Verbs and events

Same as all other variants. Every recorded event has
`event.tenantId = <actor's tenant>`.

| UI action | HTTP                                  | Event           |
|-----------|---------------------------------------|-----------------|
| Reveal    | `POST /api/secrets/{id}/reveal`       | `secret.reveal` |
| Create    | `POST /api/secrets`                   | `secret.create` |
| Rotate    | `POST /api/secrets/{id}/rotate`       | `secret.rotate` |
| Share    | `POST /api/secrets/{id}/share`        | `secret.share`  |
| Expire    | `POST /api/secrets/{id}/expire`       | `secret.expire` |
| Revoke    | `DELETE /api/secrets/{id}`            | `secret.revoke` |
