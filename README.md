# Everscribe examples

End-to-end demos of [Everscribe](https://everscribe.io) - the embeddable
audit-log platform - across twelve frontend × backend stack combinations,
each in single-tenant and multi-tenant variants. **Twenty-four runnable
examples**, all built around the same domain so you can compare
integration shapes without learning a new app each time.

---

These examples use a **secrets vault** - the kind of app where the
audit log isn't an afterthought, it *is* the trust boundary. Every
example records a `secret.reveal` event when a value is exposed, and
mounts an embedded `<AuditTrail>` component that lets users see those
events live, scoped to their tenant.

This is the shape your app needs. These examples show you how to
integrate it in your stack.

---

## The matrix

Pick by frontend and backend; each combo has a single-tenant and a
multi-tenant variant.

### Go backend (`@everscribe/sdk-go`)

| Frontend       | Single-tenant                                                     | Multi-tenant                                                    |
|----------------|-------------------------------------------------------------------|-----------------------------------------------------------------|
| React          | [react-fe-with-go-be/single-tenant](react-fe-with-go-be/single-tenant) | [react-fe-with-go-be/multi-tenant](react-fe-with-go-be/multi-tenant) |
| Svelte         | [svelte-fe-with-go-be/single-tenant](svelte-fe-with-go-be/single-tenant) | [svelte-fe-with-go-be/multi-tenant](svelte-fe-with-go-be/multi-tenant) |
| Vanilla JS     | [vanilla-js-fe-with-go-be/single-tenant](vanilla-js-fe-with-go-be/single-tenant) | [vanilla-js-fe-with-go-be/multi-tenant](vanilla-js-fe-with-go-be/multi-tenant) |

Go variants embed the React/Svelte/Vanilla bundle into the binary via
`//go:embed all:web/dist`, then `make build && make run` produces and
runs a self-contained executable.

### Node backend (`@everscribe/sdk-node`)

| Frontend       | Single-tenant                                                         | Multi-tenant                                                        |
|----------------|-----------------------------------------------------------------------|---------------------------------------------------------------------|
| React          | [react-fe-with-node-be/single-tenant](react-fe-with-node-be/single-tenant) | [react-fe-with-node-be/multi-tenant](react-fe-with-node-be/multi-tenant) |
| Svelte         | [svelte-fe-with-node-be/single-tenant](svelte-fe-with-node-be/single-tenant) | [svelte-fe-with-node-be/multi-tenant](svelte-fe-with-node-be/multi-tenant) |
| Vanilla JS     | [vanilla-js-fe-with-node-be/single-tenant](vanilla-js-fe-with-node-be/single-tenant) | [vanilla-js-fe-with-node-be/multi-tenant](vanilla-js-fe-with-node-be/multi-tenant) |

Node variants run the Express server under `tsx`, with
`express.static('frontend/dist')` serving the built frontend on the
same port as the API. `npm run build && npm start`.

### Python backend (`everscribe`)

| Frontend       | Single-tenant                                                                    | Multi-tenant                                                                  |
|----------------|----------------------------------------------------------------------------------|-------------------------------------------------------------------------------|
| React          | [react-fe-with-python-be/single-tenant](react-fe-with-python-be/single-tenant)   | [react-fe-with-python-be/multi-tenant](react-fe-with-python-be/multi-tenant)   |
| Svelte         | [svelte-fe-with-python-be/single-tenant](svelte-fe-with-python-be/single-tenant) | [svelte-fe-with-python-be/multi-tenant](svelte-fe-with-python-be/multi-tenant) |
| Vanilla JS     | [vanilla-js-fe-with-python-be/single-tenant](vanilla-js-fe-with-python-be/single-tenant) | [vanilla-js-fe-with-python-be/multi-tenant](vanilla-js-fe-with-python-be/multi-tenant) |

Python variants run FastAPI under uvicorn, serving the built frontend
from `frontend/dist` on the same port as the API. Set up a venv, then
`python backend/app.py`. The audit wiring uses the SDK's ASGI middleware
(`EverscribeMiddleware`) and `current_event()`.

### Rust backend (`everscribe`)

| Frontend       | Single-tenant                                                                | Multi-tenant                                                              |
|----------------|------------------------------------------------------------------------------|---------------------------------------------------------------------------|
| React          | [react-fe-with-rust-be/single-tenant](react-fe-with-rust-be/single-tenant)   | [react-fe-with-rust-be/multi-tenant](react-fe-with-rust-be/multi-tenant)   |
| Svelte         | [svelte-fe-with-rust-be/single-tenant](svelte-fe-with-rust-be/single-tenant) | [svelte-fe-with-rust-be/multi-tenant](svelte-fe-with-rust-be/multi-tenant) |
| Vanilla JS     | [vanilla-js-fe-with-rust-be/single-tenant](vanilla-js-fe-with-rust-be/single-tenant) | [vanilla-js-fe-with-rust-be/multi-tenant](vanilla-js-fe-with-rust-be/multi-tenant) |

Rust variants run an axum server, serving the built frontend from
`frontend/dist` (via `tower-http`'s `ServeDir`) on the same port as the API.
`cargo run`. The audit wiring uses the SDK's tower middleware
(`EverscribeLayer`) and the `CurrentEvent` extractor.

---

## What every example does

Same secrets vault, same seven verbs, same fake-login dropdown. The
only thing that changes from one example to the next is the integration
glue between Everscribe and your stack.

### The vault verbs

| UI action | HTTP                                  | Event                                         |
|-----------|---------------------------------------|-----------------------------------------------|
| Reveal    | `POST /api/secrets/{id}/reveal`       | `secret.reveal`                               |
| Create    | `POST /api/secrets`                   | `secret.create`                               |
| Rotate    | `POST /api/secrets/{id}/rotate`       | `secret.rotate` (with redacted before/after)  |
| Share     | `POST /api/secrets/{id}/share`        | `secret.share`                                |
| Expire    | `POST /api/secrets/{id}/expire`       | `secret.expire`                               |
| Revoke    | `DELETE /api/secrets/{id}`            | `secret.revoke`                               |

The `rotate` handler is the canonical example of `WithRedactedFields`
in action - the audit diff sees `value: "[REDACTED]"` on both sides,
not the plaintext.

### The audit trail panel

Below the vault UI, every example mounts the embedded audit component:

- React variants: `<AuditTrail />` from `@everscribe/components-react`
- Svelte and Vanilla JS variants: `<audit-trail>` custom element from
  `@everscribe/components-element`

Both come from the same `components-core` engine, render the same
table, and authenticate with the same JWT shape. Switching frontend
frameworks doesn't mean re-learning the embed.

### Single-tenant vs multi-tenant

| | Single-tenant | Multi-tenant |
|-|--------------|--------------|
| Tabs                 | One app view                      | Customer view · Admin view  |
| Customer-view scope  | n/a                               | Token has `tenantId` set; embed shows only this tenant's events |
| Admin-view scope     | n/a                               | No `tenantId`; embed shows all tenants in the project |
| Tenants in seed data | n/a (one implicit tenant)         | 2 (Acme, Initech), 2 users each |
| Switching tenants    | n/a                               | Via the login dropdown - picking a user from a different tenant re-scopes the customer embed |

The multi-tenant variants are what you reach for if you're building a
SaaS where each customer has their own workspace and their own audit
trail.

---

## Architecture in 30 seconds

```
                   ┌────────────────────────────┐
                   │  Everscribe ingestion API  │
                   │   (api.everscribe.io)      │
                   └────────────┬───────────────┘
                                │
                  ┌─────────────┴─────────────┐
                  │                           │
    ┌─────────────▼─────────────┐ ┌───────────▼─────────────┐
    │ Recorder (go/node/py/rust)│ │ Embed reads via JWT      │
    │                           │ │                          │
    │ POST /v1/events  (batched)│ │ GET /v1/embed/events?... │
    └─────────────▲─────────────┘ └───────────▲─────────────┘
                  │                            │
    ┌─────────────┴─────────────┐ ┌───────────┴────────────────┐
    │  Your backend             │ │  Your customer's browser   │
    │                           │ │                            │
    │  - holds API key          │ │  - receives short-lived    │
    │  - records events on      │ │    JWT minted by your      │
    │    every mutation         │ │    backend                 │
    │  - mints scoped tokens    │ │  - mounts <AuditTrail/>    │
    │    on /api/embed-token    │ │  - never sees API key      │
    └───────────────────────────┘ └────────────────────────────┘
```

**Recorder** = your backend's path to record audit events. The SDK
buffers and batches them; you get a fast `record(event)` call that
doesn't block the request path.

**Minter** = your backend's path to mint short-lived JWTs (scoped by
tenant, columns, action filters) so your customer's browser can mount
`<AuditTrail>` without ever seeing your project API key.

These two surfaces - Recorder + Minter - are what every example wires
up. Everything else is just app code.

---

## Local development setup

These examples use **local `file:` and `replace` references** to the
Everscribe libraries on disk, not published packages, so you can iterate
on them alongside the demos. The repos are expected to live as siblings
of this one:

```
github.com/everscribe/
├── components/        ← packages/{react,element,core,styles}
├── examples/          ← you are here
├── sdk-go/
├── sdk-node/
├── sdk-python/
└── sdk-rust/
```

The `*-with-go-be/` examples have `replace github.com/everscribe/sdk-go
=> ../../../sdk-go` in their `go.mod`. The `*-with-node-be/` examples
use `"@everscribe/sdk-node": "file:../../../sdk-node"`. The
`*-with-python-be/` examples install the SDK editable via
`-e ../../../sdk-python` in `requirements.txt`. The `*-with-rust-be/`
examples use a path dependency `everscribe = { path = "../../../sdk-rust" }`
in `Cargo.toml`. Same shape for the components packages.

If you fork or move this repo, update the relative paths or swap to
published versions.

---

## Per-example prerequisites

| Example variant | Requires |
|-----------------|----------|
| `*-with-go-be/` | Go 1.25+, Node 18+, an Everscribe project |
| `*-with-node-be/` | Node 20+, an Everscribe project |
| `*-with-python-be/` | Python 3.10+, Node 20+, an Everscribe project |
| `*-with-rust-be/` | Rust 1.85+, Node 20+, an Everscribe project |

All examples need an Everscribe project ID (`proj_*`) and API key
(`evs_*`) - set them in `.env` per each example's instructions.

---

## Picking a starting example

Not sure where to begin?

- **You're a Go shop building B2B SaaS** →
  [react-fe-with-go-be/multi-tenant](react-fe-with-go-be/multi-tenant)
  is closest to a real product.
- **You're a Node shop building B2B SaaS** →
  [react-fe-with-node-be/multi-tenant](react-fe-with-node-be/multi-tenant).
- **You're a Python shop building B2B SaaS** →
  [react-fe-with-python-be/multi-tenant](react-fe-with-python-be/multi-tenant)
  (FastAPI + the SDK's ASGI middleware).
- **You're a Rust shop building B2B SaaS** →
  [react-fe-with-rust-be/multi-tenant](react-fe-with-rust-be/multi-tenant)
  (axum + the SDK's tower middleware).
- **You want the simplest possible end-to-end** →
  [vanilla-js-fe-with-go-be/single-tenant](vanilla-js-fe-with-go-be/single-tenant).
  Smallest bundle (~12 KB gzip), no framework, single-binary deploy.
- **You want to see the multi-tenant scoping click** → any of the
  multi variants. Switch users in the login dropdown and watch the
  Customer view re-scope to the new tenant.

---

## Caveats

- The frontend's login dropdown sets an `X-Demo-Actor` header that the
  backend reads to know who's calling. **Real apps replace this with
  real auth** (session cookie, JWT, OAuth) - the demo header is a
  shortcut so the audit middleware has a real Actor to attach to events
  without dragging in an auth library.
- The vault is in-memory; secrets reset on restart. **Real apps store
  secrets in a real secrets manager.** The vault here is just
  something to record events about.
- The multi-tenant customer-embed token endpoint requires
  `X-Demo-Actor` to identify the actor's tenant. The audit component's
  built-in `tokenEndpoint` fetcher only sends `credentials: 'include'`
  - no custom headers - so the customer embed uses the
  `onTokenExpired` callback (or equivalent in Svelte/Vanilla) to
  attach the header. See the per-example READMEs for details.

---

## Repo links

- Go SDK: [github.com/everscribe/sdk-go](https://github.com/everscribe/sdk-go)
- Node SDK: [github.com/everscribe/sdk-node](https://github.com/everscribe/sdk-node)
- Python SDK: [github.com/everscribe/sdk-python](https://github.com/everscribe/sdk-python)
- Rust SDK: [github.com/everscribe/sdk-rust](https://github.com/everscribe/sdk-rust)
- Embeddable components: [github.com/everscribe/components](https://github.com/everscribe/components)
