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

The frontend is **embedded into the Go binary** via `//go:embed`, so
`make build` produces a single self-contained executable that serves
both the React app and the API on one port.

## Layout

```
examples/
├── go.mod         module github.com/everscribe/examples (replace → ../sdk-go)
├── main.go        //go:embed all:web/dist
├── Makefile
└── web/           Vite + React + TS
    ├── package.json   @everscribe/events-react → file:../../events-react
    ├── vite.config.ts
    ├── src/
    └── dist/      ← Vite output, embedded into the binary
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
cp .env.example .env
# Fill in EVERSCRIBE_PROJECT_ID and EVERSCRIBE_API_KEY.
```

## Run (single binary)

```sh
make build       # npm run build → web/dist, then go build → bin/server
make run         # or: ./bin/server
```

Open <http://localhost:9000>.

## Run (development, with HMR)

If you want React hot-reload while iterating, run the two halves
separately. Vite serves on `:5173` and proxies `/api/*` to the Go server
on `:9000`.

```sh
make dev-server   # terminal 1
make dev-web      # terminal 2
```

Open <http://localhost:5173>.

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

- Static embed: [main.go](main.go) → `//go:embed all:web/dist` +
  `newStaticHandler`
- Token mint: [main.go](main.go) → `embedToken` handler
- Audit middleware (populates Actor/Origin per request):
  [main.go](main.go) → `event.NewMiddleware(...)`
- Recording on mutation:
  [main.go](main.go) → `inviteUser`, `changeRole`, `removeUser` use the
  `defer rec.Record(...)` idiom
- Component mount: [web/src/App.tsx](web/src/App.tsx) →
  `<EverscribeEvents tokenEndpoint="/api/embed-token" />`
