# React frontend + Python backend · single-tenant

Same secrets-vault demo as the React+Node and React+Go variants — same UI,
same actor flow, same audit verbs — but the backend is Python + FastAPI +
the Everscribe Python SDK. The frontend is byte-identical to the Node
variant's `frontend/`.

The full security framing lives in the [repo root README](../../README.md).
This file is just how to run.

## Prerequisites

- Python 3.10+
- Node 20+ (to build the frontend)
- An Everscribe project with a `proj_*` ID and an `evs_*` API key

## Setup

```sh
cp .env.example .env
# Fill in EVERSCRIBE_PROJECT_ID and EVERSCRIBE_API_KEY.
```

## Run (single port)

```sh
python3 -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt         # installs FastAPI + the local Python SDK
(cd frontend && npm install && npm run build)   # builds frontend/dist
python backend/app.py                    # serves API + static frontend/dist
```

Open <http://localhost:9000>. One process, one port.

`requirements.txt` installs the SDK editable from the sibling repo
(`-e ../../../sdk-python`), the same way the Node example uses
`file:../../../sdk-node`.

## Run (development, with HMR)

Two terminals. The first runs FastAPI under uvicorn's reloader; the second
runs the Vite dev server on `:5173`, which proxies `/api/*` to `:9000`.

```sh
# terminal 1 (backend, from the activated venv)
uvicorn backend.app:app --reload --port 9000

# terminal 2 (frontend)
cd frontend && npm install && npm run dev
```

Open <http://localhost:5173>.

## What's different from the React+Node variant?

The frontend is unchanged. On the backend:

| Concern            | Node variant                                                        | Python variant                                                            |
|--------------------|---------------------------------------------------------------------|---------------------------------------------------------------------------|
| HTTP layer         | Express                                                             | FastAPI (ASGI)                                                            |
| SDK package        | `@everscribe/sdk-node`                                              | `everscribe` (`-e ../../../sdk-python`)                                    |
| Audit middleware   | `expressMiddleware({ recorder, resolveActor })`                    | `app.add_middleware(EverscribeMiddleware, recorder=rec, resolve_actor=...)` |
| Per-request event  | `req.event!` (installed by the middleware)                         | `current_event()` (from `everscribe.asgi`)                                |
| Record idiom       | Set `req.event!.action`; middleware auto-records on response finish | Set `current_event().action`; middleware auto-records on response finish  |
| Token mint         | `await minter.mintToken({ ... })`                                  | `minter.mint_token(TokenOptions(...))`                                     |
| Static files       | `express.static('../frontend/dist')`                               | FastAPI catch-all serving `frontend/dist` + SPA fallback                   |
| Run                | `tsx backend/index.ts`                                             | `python backend/app.py` (uvicorn)                                         |

Both backends use the SDK's framework adapter and its auto-record-on-finish
behavior, so the handler code reads almost identically — set the action on
the request-scoped event and return your response.

### Field names

Unlike the Node SDK (camelCase in TS, snake_case on the wire), the Python
SDK uses **snake_case** everywhere (`event.action`, `event.tenant_id`,
`event.actor.display_name`), which already matches the wire format. The
`to_wire()` helper here only exists to drop the secret `value` before
returning secrets to the client — not for case conversion.

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
