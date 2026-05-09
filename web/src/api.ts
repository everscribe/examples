export interface User {
  id: string
  email: string
  name: string
  role: string
}

const base = '/api'

async function asJSON<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`${res.status} ${res.statusText}: ${text}`)
  }
  return res.status === 204 ? (undefined as T) : (res.json() as Promise<T>)
}

export const api = {
  list: () => fetch(`${base}/users`).then(asJSON<User[]>),

  invite: (input: { email: string; name: string; role: string }) =>
    fetch(`${base}/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    }).then(asJSON<User>),

  changeRole: (id: string, role: string) =>
    fetch(`${base}/users/${id}/role`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role }),
    }).then(asJSON<User>),

  remove: (id: string) =>
    fetch(`${base}/users/${id}`, { method: 'DELETE' }).then(asJSON<void>),
}
