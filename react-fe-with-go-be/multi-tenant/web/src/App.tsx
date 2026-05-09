import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { AuditTrail } from '@everscribe/components-react'
import {
  api,
  getActorId,
  setActorId,
  type Secret,
  type Tenant,
  type User,
} from './api.js'

type Tab = 'admin' | 'customer'

type Dialog =
  | { kind: 'reveal'; secret: Secret; value: string }
  | { kind: 'revoke'; secret: Secret }
  | { kind: 'rotate'; secret: Secret }
  | { kind: 'share'; secret: Secret }
  | { kind: 'expire'; secret: Secret }
  | null

export function App() {
  const [tenants, setTenants] = useState<Tenant[]>([])
  const [users, setUsers] = useState<User[]>([])
  const [secrets, setSecrets] = useState<Secret[]>([])
  const [actorId, setActorIdState] = useState<string>(getActorId())
  const [tab, setTab] = useState<Tab>('customer')
  const [error, setError] = useState<string | null>(null)
  const [dialog, setDialog] = useState<Dialog>(null)
  const [dialogInput, setDialogInput] = useState<string>('')

  const me = useMemo(() => users.find((u) => u.id === actorId), [users, actorId])
  const myTenant = useMemo(
    () => tenants.find((t) => t.id === me?.tenant_id),
    [tenants, me],
  )

  useEffect(() => {
    setDialogInput(dialog?.kind === 'expire' ? '60' : '')
  }, [dialog?.kind])

  const refresh = async () => {
    try {
      const [t, u] = await Promise.all([api.tenants(), api.users()])
      setTenants(t)
      setUsers(u)
      // Secrets are tenant-scoped on the backend, so this load is
      // implicitly the actor's tenant only. Skip if no actor yet.
      if (getActorId()) {
        setSecrets(await api.secrets())
      } else {
        setSecrets([])
      }
    } catch (e) {
      setError(String(e))
    }
  }

  useEffect(() => {
    void refresh()
  }, [])

  // Auto-select the first user if none stored — saves the viewer a click.
  useEffect(() => {
    if (!actorId && users.length > 0) {
      pickActor(users[0].id)
    }
  }, [users, actorId])

  // Refresh secrets when the actor changes (and therefore the tenant).
  useEffect(() => {
    if (actorId) void refreshSecrets()
  }, [actorId])

  const refreshSecrets = async () => {
    try {
      setSecrets(await api.secrets())
    } catch (err) {
      setError(String(err))
    }
  }

  const pickActor = (id: string) => {
    setActorId(id)
    setActorIdState(id)
  }

  const onCreate = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    const name = String(form.get('name') ?? '')
    const value = String(form.get('value') ?? '')
    try {
      await api.create({ name, value })
      ;(e.target as HTMLFormElement).reset()
      await refreshSecrets()
    } catch (err) {
      setError(String(err))
    }
  }

  const onReveal = async (s: Secret) => {
    try {
      const { value } = await api.reveal(s.id)
      setDialog({ kind: 'reveal', secret: s, value })
    } catch (err) {
      setError(String(err))
    }
  }

  const confirmRevoke = async () => {
    if (dialog?.kind !== 'revoke') return
    try {
      await api.revoke(dialog.secret.id)
      setDialog(null)
      await refreshSecrets()
    } catch (err) {
      setError(String(err))
    }
  }

  const confirmRotate = async (e: FormEvent) => {
    e.preventDefault()
    if (dialog?.kind !== 'rotate' || !dialogInput) return
    try {
      await api.rotate(dialog.secret.id, dialogInput)
      setDialog(null)
      await refreshSecrets()
    } catch (err) {
      setError(String(err))
    }
  }

  const confirmShare = async (userId: string) => {
    if (dialog?.kind !== 'share') return
    try {
      await api.share(dialog.secret.id, userId)
      setDialog(null)
      await refreshSecrets()
    } catch (err) {
      setError(String(err))
    }
  }

  const confirmExpire = async (e: FormEvent) => {
    e.preventDefault()
    if (dialog?.kind !== 'expire') return
    const minutes = Number(dialogInput)
    if (!Number.isFinite(minutes) || minutes <= 0) return
    try {
      await api.expire(dialog.secret.id, minutes)
      setDialog(null)
      await refreshSecrets()
    } catch (err) {
      setError(String(err))
    }
  }

  const closeDialog = () => setDialog(null)

  // Share candidates: same-tenant users that aren't the actor and haven't
  // already been shared with.
  const shareCandidates =
    dialog?.kind === 'share' && me
      ? users.filter(
          (u) =>
            u.tenant_id === me.tenant_id &&
            u.id !== actorId &&
            !dialog.secret.shared_with.includes(u.id),
        )
      : []

  return (
    <div className="app">
      <header className="topbar">
        <div>
          <h1>Secrets vault</h1>
          <p className="subtitle">
            Demo · React frontend + Go backend · multi-tenant
          </p>
        </div>
        <label className="who">
          <span>Logged in as</span>
          <select value={actorId} onChange={(e) => pickActor(e.target.value)}>
            {users.map((u) => {
              const t = tenants.find((x) => x.id === u.tenant_id)
              return (
                <option key={u.id} value={u.id}>
                  {u.name} · {u.role} @ {t?.name ?? u.tenant_id}
                </option>
              )
            })}
          </select>
        </label>
      </header>

      {error && (
        <div className="error">
          {error} <button onClick={() => setError(null)}>dismiss</button>
        </div>
      )}

      <div className="tabs" role="tablist">
        <button
          role="tab"
          className={tab === 'customer' ? 'active' : ''}
          onClick={() => setTab('customer')}
        >
          Customer view
          {myTenant && <span className="tab-sub">{myTenant.name}</span>}
        </button>
        <button
          role="tab"
          className={tab === 'admin' ? 'active' : ''}
          onClick={() => setTab('admin')}
        >
          Admin view
          <span className="tab-sub">all tenants</span>
        </button>
      </div>

      {tab === 'customer' && (
        <>
          <section className="panel labeled">
            <div className="label-corner">
              your code · vault UI ({myTenant?.name ?? '—'})
            </div>

            <div className="panel-body">
              <h2>Create a secret</h2>
              <form onSubmit={onCreate} className="create-form">
                <input
                  name="name"
                  placeholder="name (e.g. stripe_api_key)"
                  required
                />
                <input name="value" placeholder="plaintext value" required />
                <button type="submit">Add</button>
              </form>

              <h2>Vault ({secrets.length})</h2>
              <table className="secrets">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Created by</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {secrets.map((s) => (
                    <tr key={s.id} className={s.revoked ? 'revoked' : ''}>
                      <td>
                        <code>{s.name}</code>
                        {s.shared_with.length > 0 && (
                          <span className="badge">
                            shared · {s.shared_with.length}
                          </span>
                        )}
                        {s.expires_at && (
                          <span className="badge">
                            expires {fmtTime(s.expires_at)}
                          </span>
                        )}
                      </td>
                      <td>{userName(users, s.created_by)}</td>
                      <td>{s.revoked ? <em>revoked</em> : <span>active</span>}</td>
                      <td className="actions">
                        {!s.revoked && (
                          <>
                            <button onClick={() => onReveal(s)}>Reveal</button>
                            <button
                              onClick={() => setDialog({ kind: 'rotate', secret: s })}
                            >
                              Rotate
                            </button>
                            <button
                              onClick={() => setDialog({ kind: 'share', secret: s })}
                            >
                              Share
                            </button>
                            <button
                              onClick={() => setDialog({ kind: 'expire', secret: s })}
                            >
                              Expire
                            </button>
                            <button
                              className="danger"
                              onClick={() => setDialog({ kind: 'revoke', secret: s })}
                            >
                              Revoke
                            </button>
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="panel labeled">
            <div className="label-corner">Embedded Everscribe Component</div>
            <div className="panel-body">
              <p className="scope-hint">
                Token scoped to <code>tenant_id={myTenant?.id ?? '—'}</code> —
                only this tenant's events are visible.
              </p>
              <AuditTrail
                key={`customer-${myTenant?.id ?? 'none'}`}
                onTokenExpired={async () => {
                  // Customer endpoint reads X-Demo-Actor to know the
                  // actor's tenant. The component's built-in tokenEndpoint
                  // fetcher only sends `credentials: 'include'`, so we
                  // need this callback to attach our header.
                  const res = await fetch('/api/embed-token/customer', {
                    headers: { 'X-Demo-Actor': getActorId() },
                  })
                  if (!res.ok) throw new Error(`mint failed: ${res.status}`)
                  const body = (await res.json()) as { token: string }
                  return body.token
                }}
                pollInterval={1000}
                theme="light"
                defaultTimeRange="7d"
              />
            </div>
          </section>
        </>
      )}

      {tab === 'admin' && (
        <section className="panel labeled">
          <div className="label-corner">Embedded Everscribe Component</div>
          <div className="panel-body">
            <p className="scope-hint">
              Token has no <code>tenant_id</code> — events from every tenant in
              the project are visible. This is your business's internal console.
            </p>
            <AuditTrail
              key="admin"
              tokenEndpoint="/api/embed-token/admin"
              pollInterval={1000}
              theme="light"
              defaultTimeRange="7d"
            />
          </div>
        </section>
      )}

      {dialog && (
        <div className="modal-backdrop" onClick={closeDialog}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            {dialog.kind === 'reveal' && (
              <>
                <h3>Revealed value</h3>
                <p className="hint">
                  Recorded as <code>secret.reveal</code>
                  {me ? ` by ${me.name}` : ''}.
                </p>
                <pre>{dialog.value}</pre>
                <div className="modal-buttons">
                  <button onClick={closeDialog}>Close</button>
                </div>
              </>
            )}

            {dialog.kind === 'revoke' && (
              <>
                <h3>Revoke {dialog.secret.name}?</h3>
                <p className="hint">
                  Records a <code>secret.revoke</code> event with a redacted
                  before/after diff.
                </p>
                <div className="modal-buttons">
                  <button className="secondary" onClick={closeDialog}>
                    Cancel
                  </button>
                  <button className="danger" onClick={confirmRevoke}>
                    Revoke
                  </button>
                </div>
              </>
            )}

            {dialog.kind === 'rotate' && (
              <form onSubmit={confirmRotate}>
                <h3>Rotate {dialog.secret.name}</h3>
                <p className="hint">
                  Records a <code>secret.rotate</code> event. The plaintext
                  is replaced with <code>[REDACTED]</code> in the audit diff.
                </p>
                <input
                  autoFocus
                  value={dialogInput}
                  onChange={(e) => setDialogInput(e.target.value)}
                  placeholder="new plaintext value"
                  required
                />
                <div className="modal-buttons">
                  <button type="button" className="secondary" onClick={closeDialog}>
                    Cancel
                  </button>
                  <button type="submit" disabled={!dialogInput}>
                    Rotate
                  </button>
                </div>
              </form>
            )}

            {dialog.kind === 'share' && (
              <>
                <h3>Share {dialog.secret.name}</h3>
                {shareCandidates.length === 0 ? (
                  <p className="hint">
                    No one else in {myTenant?.name ?? 'this tenant'} to share
                    with.
                  </p>
                ) : (
                  <>
                    <p className="hint">
                      Records a <code>secret.share</code> event. Sharing is
                      restricted to users in the same tenant.
                    </p>
                    <ul className="share-list">
                      {shareCandidates.map((u) => (
                        <li key={u.id}>
                          <button onClick={() => confirmShare(u.id)}>
                            {u.name} <span className="role">({u.role})</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
                <div className="modal-buttons">
                  <button className="secondary" onClick={closeDialog}>
                    {shareCandidates.length === 0 ? 'Close' : 'Cancel'}
                  </button>
                </div>
              </>
            )}

            {dialog.kind === 'expire' && (
              <form onSubmit={confirmExpire}>
                <h3>Expire {dialog.secret.name}</h3>
                <p className="hint">
                  Records a <code>secret.expire</code> event with the new
                  expiry timestamp in metadata.
                </p>
                <label className="field">
                  <span>Expire in (minutes)</span>
                  <input
                    type="number"
                    min={1}
                    autoFocus
                    value={dialogInput}
                    onChange={(e) => setDialogInput(e.target.value)}
                    required
                  />
                </label>
                <div className="modal-buttons">
                  <button type="button" className="secondary" onClick={closeDialog}>
                    Cancel
                  </button>
                  <button type="submit" disabled={!Number(dialogInput)}>
                    Set expiry
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function userName(users: User[], id: string): string {
  return users.find((u) => u.id === id)?.name ?? id
}

function fmtTime(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    month: 'short',
    day: 'numeric',
  })
}
