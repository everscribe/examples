// Demo backend for the Everscribe secrets-vault example
// (single-tenant, React frontend, Node backend).
//
// In-memory vault with seven verbs — list, reveal, create, revoke,
// rotate, share, expire — each emitting an audit event via sdk-node's
// Recorder. The frontend mounts <AuditTrail /> using a token minted
// here.
import 'dotenv/config'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import express, { type Request, type Response } from 'express'

import { create } from '@everscribe/sdk-node'
import { withRedactedFields } from '@everscribe/sdk-node/event'
import { expressMiddleware, type ActorResolver } from '@everscribe/sdk-node/express'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// -------------------------- types --------------------------

interface User {
  id: string
  name: string
  email: string
  role: 'admin' | 'member'
}

// Internal shape — `value` is never marshaled to clients.
interface InternalSecret {
  id: string
  name: string
  value: string
  createdBy: string
  createdAt: string
  rotatedAt?: string
  sharedWith: string[]
  expiresAt?: string
  revoked: boolean
}

// Wire shape (snake_case) returned by the API. Mirrors the Go variant
// so the React frontend code is identical between the two.
interface Secret {
  id: string
  name: string
  created_by: string
  created_at: string
  rotated_at?: string
  shared_with: string[]
  expires_at?: string
  revoked: boolean
}

function toWire(s: InternalSecret): Secret {
  return {
    id: s.id,
    name: s.name,
    created_by: s.createdBy,
    created_at: s.createdAt,
    rotated_at: s.rotatedAt,
    shared_with: [...s.sharedWith],
    expires_at: s.expiresAt,
    revoked: s.revoked,
  }
}

// -------------------------- vault store --------------------------

const vault = new Map<string, InternalSecret>()
let seq = 0

function createSecret(name: string, value: string, createdBy: string): InternalSecret {
  seq++
  const s: InternalSecret = {
    id: `sec_${String(seq).padStart(3, '0')}`,
    name,
    value,
    createdBy,
    createdAt: new Date().toISOString(),
    sharedWith: [],
    revoked: false,
  }
  vault.set(s.id, s)
  return s
}

createSecret('stripe_api_key', 'sk_live_demo_seed_value', 'u_ada')
createSecret('github_pat', 'ghp_demo_seed_value', 'u_ada')
createSecret('datadog_api_key', 'dd_demo_seed_value', 'u_alan')

// Snapshot for diffs — value always [REDACTED] so plaintext never
// leaves the process via the audit log.
function snapshot(s: InternalSecret) {
  return {
    name: s.name,
    value: '[REDACTED]',
    shared_with: [...s.sharedWith],
    expires_at: s.expiresAt,
    revoked: s.revoked,
  }
}

// -------------------------- seeded cast --------------------------

const users: Record<string, User> = {
  u_ada:   { id: 'u_ada',   name: 'Ada Lovelace',  email: 'ada@acme.test',   role: 'admin'  },
  u_alan:  { id: 'u_alan',  name: 'Alan Turing',   email: 'alan@acme.test',  role: 'member' },
  u_grace: { id: 'u_grace', name: 'Grace Hopper',  email: 'grace@acme.test', role: 'member' },
}

// -------------------------- main --------------------------

const projectId = process.env.EVERSCRIBE_PROJECT_ID
const apiKey = process.env.EVERSCRIBE_API_KEY
const port = process.env.PORT ?? '9000'

if (!projectId || !apiKey) {
  console.error('EVERSCRIBE_PROJECT_ID and EVERSCRIBE_API_KEY must be set (see .env.example)')
  process.exit(1)
}

const es = create(projectId, apiKey)
const rec = es.newRecorder({ flushInterval: 2_000 })
const minter = es.newMinter()

// Resolver reads the X-Demo-Actor header set by the frontend's login
// dropdown. Real apps read session/JWT here; the header is a demo
// shortcut. Order in the chain (below) puts this between request
// parsing and the audit middleware so req.session-like state is
// populated before resolveActor runs.
const resolveActor: ActorResolver = (req) => {
  const id = req.headers['x-demo-actor']
  const u = typeof id === 'string' ? users[id] : undefined
  if (!u) return { type: 'anonymous' }
  return { type: 'user', id: u.id, displayName: u.name, email: u.email }
}

const app = express()
app.use(express.json())

// Audit middleware: installs req.event with Actor + Origin, auto-records
// on response finish/close when req.event.action is set.
app.use(expressMiddleware({ recorder: rec, resolveActor }))

// ----- API routes -----

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' })
})

app.get('/api/users', (_req, res) => {
  const out = Object.values(users).sort((a, b) => a.id.localeCompare(b.id))
  res.json(out)
})

app.get('/api/secrets', (_req, res) => {
  const out = [...vault.values()].sort((a, b) => a.id.localeCompare(b.id))
  res.json(out.map(toWire))
})

app.post('/api/secrets', (req, res) => {
  const { name, value } = req.body ?? {}
  if (typeof name !== 'string' || !name.trim() || typeof value !== 'string' || !value) {
    res.status(400).send('name and value required')
    return
  }
  const actorId = req.event!.actor.id ?? 'unknown'
  const s = createSecret(name.trim(), value, actorId)

  req.event!.action = 'secret.create'
  req.event!.target = { type: 'secret', id: s.id }
  req.event!.withFields('name', s.name)

  res.status(201).json(toWire(s))
})

app.post('/api/secrets/:id/reveal', (req, res) => {
  const s = vault.get(req.params.id)
  req.event!.target = { type: 'secret', id: req.params.id }
  if (!s) {
    res.status(404).send('not found')
    return
  }
  if (s.revoked) {
    res.status(410).send('revoked')
    return
  }

  req.event!.action = 'secret.reveal'
  req.event!.withFields('name', s.name)

  res.json({ value: s.value })
})

app.delete('/api/secrets/:id', (req, res) => {
  const s = vault.get(req.params.id)
  req.event!.target = { type: 'secret', id: req.params.id }
  if (!s) {
    res.status(404).send('not found')
    return
  }
  const before = snapshot(s)
  s.revoked = true
  const after = snapshot(s)

  req.event!.action = 'secret.revoke'
  req.event!.withFields('name', s.name)
  req.event!.diff(before, after)

  res.status(204).send()
})

app.post('/api/secrets/:id/rotate', (req, res) => {
  const { value } = req.body ?? {}
  req.event!.target = { type: 'secret', id: req.params.id }
  if (typeof value !== 'string' || !value) {
    res.status(400).send('value required')
    return
  }
  const s = vault.get(req.params.id)
  if (!s) {
    res.status(404).send('not found')
    return
  }
  if (s.revoked) {
    res.status(410).send('revoked')
    return
  }
  const before = snapshot(s)
  s.value = value
  s.rotatedAt = new Date().toISOString()
  const after = snapshot(s)

  req.event!.action = 'secret.rotate'
  req.event!.withFields('name', s.name)
  // Both snapshots already have value=[REDACTED]; withRedactedFields is
  // unused here because we redact at snapshot time. The same e.diff
  // shape would also accept withRedactedFields("/value") if you wanted
  // to redact at diff time instead.
  req.event!.diff(before, after)

  res.status(204).send()
})

app.post('/api/secrets/:id/share', (req, res) => {
  const { user_id: userId } = req.body ?? {}
  req.event!.target = { type: 'secret', id: req.params.id }
  if (typeof userId !== 'string' || !users[userId]) {
    res.status(400).send('user_id required')
    return
  }
  const s = vault.get(req.params.id)
  if (!s) {
    res.status(404).send('not found')
    return
  }
  if (!s.sharedWith.includes(userId)) {
    s.sharedWith.push(userId)
  }

  req.event!.action = 'secret.share'
  req.event!.withFields('name', s.name, 'shared_with', userId)

  res.status(204).send()
})

app.post('/api/secrets/:id/expire', (req, res) => {
  const { in_minutes: inMinutes } = req.body ?? {}
  req.event!.target = { type: 'secret', id: req.params.id }
  if (typeof inMinutes !== 'number' || !Number.isFinite(inMinutes) || inMinutes <= 0) {
    res.status(400).send('in_minutes required (>0)')
    return
  }
  const s = vault.get(req.params.id)
  if (!s) {
    res.status(404).send('not found')
    return
  }
  s.expiresAt = new Date(Date.now() + inMinutes * 60_000).toISOString()

  req.event!.action = 'secret.expire'
  req.event!.withFields('name', s.name, 'expires_at', s.expiresAt)

  res.status(204).send()
})

app.get('/api/embed-token', async (_req, res) => {
  try {
    const token = await minter.mintToken({
      expiresIn: 60 * 60 * 1000, // 1 hour
      allowedActions: ['secret.*'],
    })
    res.json({ token })
  } catch (err) {
    console.error('mint token:', err)
    res.status(502).send('could not mint token')
  }
})

// withRedactedFields is imported above so it shows up in the example
// surface even though we redact at snapshot time. Suppress unused-import
// warnings without dropping the import.
void withRedactedFields

// ----- static frontend -----

// The Node analog of //go:embed: serve the built React app from
// frontend/dist/ via express.static. Single command starts the server
// and it serves both API and frontend.
const distDir = path.join(__dirname, '..', 'frontend', 'dist')
app.use(express.static(distDir))

// SPA fallback: any non-/api request that doesn't match a static file
// returns index.html. Lets the React app handle client-side routing.
app.get(/^\/(?!api\/).*/, (_req, res) => {
  res.sendFile(path.join(distDir, 'index.html'))
})

// ----- listen + shutdown -----

const server = app.listen(port, () => {
  console.log(`listening on http://localhost:${port} (project=${projectId})`)
})

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)

async function shutdown() {
  server.close()
  try {
    await rec.close()
  } catch (err) {
    console.error('recorder shutdown:', err)
  }
  process.exit(0)
}
