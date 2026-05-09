import { useEffect, useState, type FormEvent } from 'react'
import { EverscribeEvents } from '@everscribe/events-react'
import { api, type User } from './api.js'

const ROLES = ['admin', 'member', 'viewer']

export function App() {
  const [users, setUsers] = useState<User[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const refresh = async () => {
    try {
      setUsers(await api.list())
    } catch (e) {
      setError(String(e))
    }
  }

  useEffect(() => {
    void refresh()
  }, [])

  const onInvite = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    const email = String(form.get('email') ?? '')
    const name = String(form.get('name') ?? '')
    const role = String(form.get('role') ?? 'member')
    setBusy(true)
    setError(null)
    try {
      await api.invite({ email, name, role })
      ;(e.target as HTMLFormElement).reset()
      await refresh()
    } catch (err) {
      setError(String(err))
    } finally {
      setBusy(false)
    }
  }

  const onRoleChange = async (id: string, role: string) => {
    try {
      await api.changeRole(id, role)
      await refresh()
    } catch (err) {
      setError(String(err))
    }
  }

  const onRemove = async (id: string) => {
    try {
      await api.remove(id)
      await refresh()
    } catch (err) {
      setError(String(err))
    }
  }

  return (
    <div className="app">
      <header>
        <h1>Team Management</h1>
        <p className="subtitle">
          Mutations are recorded as audit events and shown live below.
        </p>
      </header>

      <section className="panel">
        <h2>Invite a teammate</h2>
        <form onSubmit={onInvite} className="invite-form">
          <input name="name" placeholder="Full name" required />
          <input name="email" type="email" placeholder="email@example.com" required />
          <select name="role" defaultValue="member">
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
          <button type="submit" disabled={busy}>
            {busy ? 'Sending…' : 'Invite'}
          </button>
        </form>
      </section>

      <section className="panel">
        <h2>Team ({users.length})</h2>
        {error && <div className="error">{error}</div>}
        <table className="users">
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Role</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td>{u.name}</td>
                <td>{u.email}</td>
                <td>
                  <select
                    value={u.role}
                    onChange={(e) => onRoleChange(u.id, e.target.value)}
                  >
                    {ROLES.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <button className="danger" onClick={() => onRemove(u.id)}>
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="panel">
        <h2>Audit trail</h2>
        <EverscribeEvents
          tokenEndpoint="/api/embed-token"
          pollInterval={3000}
          theme="light"
        />
      </section>
    </div>
  )
}
