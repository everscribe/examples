// Demo backend for the Everscribe secrets-vault example
// (multi-tenant, React frontend, Node backend).
//
// Two tenants seed the vault. The login dropdown picks an actor whose
// tenant binding determines (a) which secrets they can see/operate on,
// and (b) which TenantID lands on the recorded audit events. Two embed-
// token endpoints scope <AuditTrail /> two ways:
//
//   - /api/embed-token/admin    - no tenantId, cross-tenant view
//   - /api/embed-token/customer - tenantId = actor's tenant, scoped view
import 'dotenv/config'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomBytes } from 'node:crypto'
import express, { type Request } from 'express'

import { create } from '@everscribe/sdk-node'
import { expressMiddleware, type ActorResolver } from '@everscribe/sdk-node/express'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// -------------------------- types --------------------------

interface Tenant {
  id: string
  name: string
}

interface User {
  id: string
  name: string
  email: string
  role: 'admin' | 'member'
  tenantId: string
}

interface InternalSecret {
  id: string
  name: string
  tenantId: string
  value: string
  createdBy: string
  createdAt: string
  rotatedAt?: string
  sharedWith: string[]
  expiresAt?: string
  revoked: boolean
}

// Wire shape sent to the React frontend (snake_case, no value field
// exposed). Mirrors the Go variant byte-for-byte so the React code is
// identical between them.
interface Secret {
  id: string
  name: string
  tenant_id: string
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
    tenant_id: s.tenantId,
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
const byTenant = new Map<string, string[]>()

function randomId() {
  return 'sec_' + randomBytes(4).toString('hex')
}

function createSecret(tenantId: string, name: string, value: string, createdBy: string): InternalSecret {
  const s: InternalSecret = {
    id: randomId(),
    name,
    tenantId,
    value,
    createdBy,
    createdAt: new Date().toISOString(),
    sharedWith: [],
    revoked: false,
  }
  vault.set(s.id, s)
  const ids = byTenant.get(tenantId) ?? []
  ids.push(s.id)
  byTenant.set(tenantId, ids)
  return s
}

createSecret('acme', 'stripe_api_key', 'sk_live_acme_seed', 'u_ada')
createSecret('acme', 'github_pat', 'ghp_acme_seed', 'u_ada')
createSecret('initech', 'aws_access_key', 'AKIA_initech_seed', 'u_grace')
createSecret('initech', 'slack_webhook', 'https://hooks.slack.com/initech_seed', 'u_grace')

function listForTenant(tenantId: string): InternalSecret[] {
  const ids = byTenant.get(tenantId) ?? []
  return ids.map((id) => vault.get(id)!).sort((a, b) => a.id.localeCompare(b.id))
}

// Snapshot for diffs - value always [REDACTED] so plaintext never
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

const tenants: Record<string, Tenant> = {
  acme:    { id: 'acme',    name: 'Acme Corp' },
  initech: { id: 'initech', name: 'Initech'   },
}

const users: Record<string, User> = {
  u_ada:   { id: 'u_ada',   name: 'Ada Lovelace',  email: 'ada@acme.test',     role: 'admin',  tenantId: 'acme'    },
  u_linus: { id: 'u_linus', name: 'Linus Torvalds', email: 'linus@acme.test',  role: 'member', tenantId: 'acme'    },
  u_grace: { id: 'u_grace', name: 'Grace Hopper',  email: 'grace@initech.test', role: 'admin',  tenantId: 'initech' },
  u_alan:  { id: 'u_alan',  name: 'Alan Turing',   email: 'alan@initech.test',  role: 'member', tenantId: 'initech' },
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

// X-Demo-Actor header → Actor for the audit middleware.
const resolveActor: ActorResolver = (req) => {
  const id = req.headers['x-demo-actor']
  const u = typeof id === 'string' ? users[id] : undefined
  if (!u) return { type: 'anonymous' }
  return { type: 'user', id: u.id, displayName: u.name, email: u.email }
}

// Helper for handlers: get the User object behind X-Demo-Actor (we need
// both the id, for created_by, and the tenant, for scoping + e.tenantId).
function actor(req: Request): User | null {
  const id = req.headers['x-demo-actor']
  return typeof id === 'string' ? (users[id] ?? null) : null
}

const app = express()
app.use(express.json())
app.use(expressMiddleware({ recorder: rec, resolveActor }))

// ----- API routes -----

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' })
})

app.get('/api/tenants', (_req, res) => {
  const out = Object.values(tenants).sort((a, b) => a.id.localeCompare(b.id))
  res.json(out)
})

app.get('/api/users', (_req, res) => {
  // Frontend expects snake_case `tenant_id`.
  const out = Object.values(users)
    .map(({ tenantId, ...rest }) => ({ ...rest, tenant_id: tenantId }))
    .sort((a, b) => a.id.localeCompare(b.id))
  res.json(out)
})

app.get('/api/secrets', (req, res) => {
  const me = actor(req)
  if (!me) {
    res.status(401).send('unknown actor')
    return
  }
  res.json(listForTenant(me.tenantId).map(toWire))
})

app.post('/api/secrets', (req, res) => {
  const me = actor(req)
  if (!me) {
    res.status(401).send('unknown actor')
    return
  }
  req.event!.tenantId = me.tenantId

  const { name, value } = req.body ?? {}
  if (typeof name !== 'string' || !name.trim() || typeof value !== 'string' || !value) {
    res.status(400).send('name and value required')
    return
  }
  const s = createSecret(me.tenantId, name.trim(), value, me.id)

  req.event!.action = 'secret.create'
  req.event!.target = { type: 'secret', id: s.id }
  req.event!.withFields('name', s.name)

  res.status(201).json(toWire(s))
})

app.post('/api/secrets/:id/reveal', (req, res) => {
  const me = actor(req)
  if (!me) {
    res.status(401).send('unknown actor')
    return
  }
  req.event!.tenantId = me.tenantId
  req.event!.target = { type: 'secret', id: req.params.id }

  const s = vault.get(req.params.id)
  if (!s || s.tenantId !== me.tenantId) {
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
  const me = actor(req)
  if (!me) {
    res.status(401).send('unknown actor')
    return
  }
  req.event!.tenantId = me.tenantId
  req.event!.target = { type: 'secret', id: req.params.id }

  const s = vault.get(req.params.id)
  if (!s || s.tenantId !== me.tenantId) {
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
  const me = actor(req)
  if (!me) {
    res.status(401).send('unknown actor')
    return
  }
  req.event!.tenantId = me.tenantId
  req.event!.target = { type: 'secret', id: req.params.id }

  const { value } = req.body ?? {}
  if (typeof value !== 'string' || !value) {
    res.status(400).send('value required')
    return
  }
  const s = vault.get(req.params.id)
  if (!s || s.tenantId !== me.tenantId) {
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
  // Both snapshots already have value=[REDACTED] from snapshot(), so
  // the diff captures the rotation timestamp + any other field changes
  // without recording the plaintext.
  req.event!.diff(before, after)

  res.status(204).send()
})

app.post('/api/secrets/:id/share', (req, res) => {
  const me = actor(req)
  if (!me) {
    res.status(401).send('unknown actor')
    return
  }
  req.event!.tenantId = me.tenantId
  req.event!.target = { type: 'secret', id: req.params.id }

  const { user_id: userId } = req.body ?? {}
  if (typeof userId !== 'string' || !userId) {
    res.status(400).send('user_id required')
    return
  }
  // Sharing only makes sense within the same tenant.
  const target = users[userId]
  if (!target || target.tenantId !== me.tenantId) {
    res.status(400).send('unknown or out-of-tenant user_id')
    return
  }

  const s = vault.get(req.params.id)
  if (!s || s.tenantId !== me.tenantId) {
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
  const me = actor(req)
  if (!me) {
    res.status(401).send('unknown actor')
    return
  }
  req.event!.tenantId = me.tenantId
  req.event!.target = { type: 'secret', id: req.params.id }

  const { in_minutes: inMinutes } = req.body ?? {}
  if (typeof inMinutes !== 'number' || !Number.isFinite(inMinutes) || inMinutes <= 0) {
    res.status(400).send('in_minutes required (>0)')
    return
  }
  const s = vault.get(req.params.id)
  if (!s || s.tenantId !== me.tenantId) {
    res.status(404).send('not found')
    return
  }
  s.expiresAt = new Date(Date.now() + inMinutes * 60_000).toISOString()

  req.event!.action = 'secret.expire'
  req.event!.withFields('name', s.name, 'expires_at', s.expiresAt)

  res.status(204).send()
})

// Admin embed: token has no tenantId - cross-tenant view of all events.
app.get('/api/embed-token/admin', async (_req, res) => {
  try {
    const token = await minter.mintToken({
      expiresIn: 60 * 60 * 1000,
      allowedActions: ['secret.*'],
      // Admin token gets full AI + Query access.
      allowDSLInput: true,
      allowNLP: true,
    })
    res.json({ token })
  } catch (err) {
    console.error('mint admin token:', err)
    res.status(502).send('could not mint token')
  }
})

// Customer embed: token scoped to the actor's tenant.
app.get('/api/embed-token/customer', async (req, res) => {
  const me = actor(req)
  if (!me) {
    res.status(401).send('unknown actor')
    return
  }
  try {
    const token = await minter.mintToken({
      tenantId: me.tenantId,
      expiresIn: 60 * 60 * 1000,
      allowedActions: ['secret.*'],
      // Customer (tenant-scoped) tokens also get AI + Query -
      // the partner has opted their end users into both. Server-
      // side, tenantId is still enforced on every read, so the
      // NLP-generated DSL is naturally tenant-scoped.
      allowDSLInput: true,
      allowNLP: true,
    })
    res.json({ token })
  } catch (err) {
    console.error(`mint customer token (tenant=${me.tenantId}):`, err)
    res.status(502).send('could not mint token')
  }
})

// ----- static frontend -----

const distDir = path.join(__dirname, '..', 'frontend', 'dist')
app.use(express.static(distDir))

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
