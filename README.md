# Everscribe example: team management

A minimal end-to-end demo that exercises both Everscribe libraries:

- **[sdk-go](../sdk-go)** — Go backend that records audit events
  (Recorder) and mints scoped embed tokens (Minter)
- **[events-react](../events-react)** — `<EverscribeEvents />`
  React component that renders the audit trail in the browser

The app is a tiny in-memory team manager. Inviting, role-changing, and
removing users each emit `user.invite`, `user.role.change`, and
`user.remove` audit events. The same page mounts `<EverscribeEvents />`
to display those events live.

## Layout

```
examples/
├── server/          Go HTTP server (port 8080)
│   ├── go.mod       replace → ../../sdk-go
│   └── main.go
└── web/             Vite + React + TS (port 5173)
    ├── package.json @everscribe/events-react → file:../../events-react
    └── src/
```

Both libraries are referenced locally — `replace` directive in `go.mod`,
`file:` reference in `package.json` — so you can iterate on them
alongside the demo.

## Prerequisites

- Go 1.25+
- Node 18+
- An Everscribe project with a `proj_*` ID and an `evs_*` API key

## Setup

```sh
# 1. Credentials
cp .env.example .env
# Edit .env and fill in EVERSCRIBE_PROJECT_ID and EVERSCRIBE_API_KEY.

# 2. Install web deps
cd web && npm install && cd ..
```

## Run

In two terminals:

```sh
# Terminal 1: Go backend
set -a; source .env; set +a
cd server && go run .

# Terminal 2: React frontend
cd web && npm run dev
```

Open http://localhost:5173. The Vite dev server proxies `/api/*` to the
Go server on `:8080`.

## What to try

1. Invite a teammate from the form — watch a `user.invite` event appear
   in the audit panel within a few seconds.
2. Change a teammate's role with the dropdown — emits `user.role.change`
   with a before/after diff (the Go handler calls `e.Diff(before, after)`).
3. Remove a teammate — emits `user.remove`.

The `<EverscribeEvents />` component polls the Everscribe API every 3
seconds using a JWT minted by the Go server's `/api/embed-token`
endpoint. The token is scoped to `tenant_id=tenant_demo` and
`actions=["user.*"]` so it can only read this app's events.

## Where things live

- Token mint: [server/main.go](server/main.go) → `embedToken` handler
- Audit middleware (populates Actor/Origin per request):
  [server/main.go](server/main.go) → `event.NewMiddleware(...)`
- Recording on mutation:
  [server/main.go](server/main.go) → `inviteUser`, `changeRole`,
  `removeUser` use the `defer rec.Record(...)` idiom
- Component mount: [web/src/App.tsx](web/src/App.tsx) →
  `<EverscribeEvents tokenEndpoint="/api/embed-token" />`
