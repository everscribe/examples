# Everscribe examples

End-to-end demos of [Everscribe](https://everscribe.io) across twelve frontend × backend stack combinations,
each in single-tenant and multi-tenant variants. **Twenty-four runnable
examples**, all built around the same domain so you can compare
integration shapes without learning a new app each time.

## What every example does

| Action | Endpoint                                  | Event                                         |
|-----------|---------------------------------------|-----------------------------------------------|
| Reveal    | `POST /api/secrets/{id}/reveal`       | `secret.reveal`                               |
| Create    | `POST /api/secrets`                   | `secret.create`                               |
| Rotate    | `POST /api/secrets/{id}/rotate`       | `secret.rotate`  |
| Share     | `POST /api/secrets/{id}/share`        | `secret.share`                                |
| Expire    | `POST /api/secrets/{id}/expire`       | `secret.expire`                               |
| Revoke    | `DELETE /api/secrets/{id}`            | `secret.revoke`                               |

Below the vault UI, you'll find the [embedded audit trail component](https://github.com/everscribe/components) which you can use to inspect and search for events .

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

## The matrix

Pick by frontend and backend; each combo has a single-tenant and a
multi-tenant variant.

### Go backend (`@everscribe/sdk-go`)

| Frontend       | Single-tenant                                                     | Multi-tenant                                                    |
|----------------|-------------------------------------------------------------------|-----------------------------------------------------------------|
| React          | [react-fe-with-go-be/single-tenant](react-fe-with-go-be/single-tenant) | [react-fe-with-go-be/multi-tenant](react-fe-with-go-be/multi-tenant) |
| Svelte         | [svelte-fe-with-go-be/single-tenant](svelte-fe-with-go-be/single-tenant) | [svelte-fe-with-go-be/multi-tenant](svelte-fe-with-go-be/multi-tenant) |
| Vanilla JS     | [vanilla-js-fe-with-go-be/single-tenant](vanilla-js-fe-with-go-be/single-tenant) | [vanilla-js-fe-with-go-be/multi-tenant](vanilla-js-fe-with-go-be/multi-tenant) |

### Node backend (`@everscribe/sdk-node`)

| Frontend       | Single-tenant                                                         | Multi-tenant                                                        |
|----------------|-----------------------------------------------------------------------|---------------------------------------------------------------------|
| React          | [react-fe-with-node-be/single-tenant](react-fe-with-node-be/single-tenant) | [react-fe-with-node-be/multi-tenant](react-fe-with-node-be/multi-tenant) |
| Svelte         | [svelte-fe-with-node-be/single-tenant](svelte-fe-with-node-be/single-tenant) | [svelte-fe-with-node-be/multi-tenant](svelte-fe-with-node-be/multi-tenant) |
| Vanilla JS     | [vanilla-js-fe-with-node-be/single-tenant](vanilla-js-fe-with-node-be/single-tenant) | [vanilla-js-fe-with-node-be/multi-tenant](vanilla-js-fe-with-node-be/multi-tenant) |

### Python backend (`everscribe`)

| Frontend       | Single-tenant                                                                    | Multi-tenant                                                                  |
|----------------|----------------------------------------------------------------------------------|-------------------------------------------------------------------------------|
| React          | [react-fe-with-python-be/single-tenant](react-fe-with-python-be/single-tenant)   | [react-fe-with-python-be/multi-tenant](react-fe-with-python-be/multi-tenant)   |
| Svelte         | [svelte-fe-with-python-be/single-tenant](svelte-fe-with-python-be/single-tenant) | [svelte-fe-with-python-be/multi-tenant](svelte-fe-with-python-be/multi-tenant) |
| Vanilla JS     | [vanilla-js-fe-with-python-be/single-tenant](vanilla-js-fe-with-python-be/single-tenant) | [vanilla-js-fe-with-python-be/multi-tenant](vanilla-js-fe-with-python-be/multi-tenant) |

### Rust backend (`everscribe`)

| Frontend       | Single-tenant                                                                | Multi-tenant                                                              |
|----------------|------------------------------------------------------------------------------|---------------------------------------------------------------------------|
| React          | [react-fe-with-rust-be/single-tenant](react-fe-with-rust-be/single-tenant)   | [react-fe-with-rust-be/multi-tenant](react-fe-with-rust-be/multi-tenant)   |
| Svelte         | [svelte-fe-with-rust-be/single-tenant](svelte-fe-with-rust-be/single-tenant) | [svelte-fe-with-rust-be/multi-tenant](svelte-fe-with-rust-be/multi-tenant) |
| Vanilla JS     | [vanilla-js-fe-with-rust-be/single-tenant](vanilla-js-fe-with-rust-be/single-tenant) | [vanilla-js-fe-with-rust-be/multi-tenant](vanilla-js-fe-with-rust-be/multi-tenant) |


## Repo links

- Go SDK: [github.com/everscribe/sdk-go](https://github.com/everscribe/sdk-go)
- Node SDK: [github.com/everscribe/sdk-node](https://github.com/everscribe/sdk-node)
- Python SDK: [github.com/everscribe/sdk-python](https://github.com/everscribe/sdk-python)
- Rust SDK: [github.com/everscribe/sdk-rust](https://github.com/everscribe/sdk-rust)
- Embeddable components: [github.com/everscribe/components](https://github.com/everscribe/components)
