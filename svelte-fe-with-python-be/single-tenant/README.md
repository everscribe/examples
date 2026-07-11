# Svelte frontend + Python backend · single-tenant
## Prerequisites

- Python 3.10+
- Node 20+ (to build the frontend)
- An Everscribe project with a `proj_*` ID and an `evs_*` API key ([create an account](https://everscribe.io/signup))

## Setup

```sh
cp .env.example .env
# Fill in EVERSCRIBE_PROJECT_ID and EVERSCRIBE_API_KEY.
```

## Run (single port)

```sh
python3 -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt
(cd frontend && npm install && npm run build)
python backend/app.py                    # serves API + static frontend/dist
```

Open <http://localhost:9000>.

## Run (development, with HMR)

```sh
# terminal 1 (backend, from the activated venv)
uvicorn backend.app:app --reload --port 9000

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
  JS variants - Svelte just mounts it inside its own templating.
- Backend = Python + FastAPI + the Everscribe Python SDK, using
  `EverscribeMiddleware` and `current_event()`. Byte-identical to the
  React+Python variant's `backend/app.py` (the backend only serves `/api`
  and the built `frontend/dist`).
