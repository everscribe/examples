// All API calls send X-Demo-Actor so the Go backend's audit middleware
// knows who the "logged-in" user is. The actor id comes from the login
// dropdown and is persisted in localStorage (see useActor in App.tsx).

export interface User {
  id: string
  name: string
  email: string
  role: 'admin' | 'member'
}

export interface Secret {
  id: string
  name: string
  created_by: string
  created_at: string
  rotated_at?: string
  shared_with: string[]
  expires_at?: string
  revoked: boolean
}

const ACTOR_KEY = 'demo.actorId'

export function getActorId(): string {
  return localStorage.getItem(ACTOR_KEY) ?? ''
}

export function setActorId(id: string) {
  localStorage.setItem(ACTOR_KEY, id)
}

async function call<T>(input: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers)
  headers.set('Content-Type', 'application/json')
  const actor = getActorId()
  if (actor) headers.set('X-Demo-Actor', actor)
  const res = await fetch(input, { ...init, headers })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`${res.status} ${res.statusText}: ${text}`)
  }
  return res.status === 204 ? (undefined as T) : (res.json() as Promise<T>)
}

export const api = {
  users: () => call<User[]>('/api/users'),
  secrets: () => call<Secret[]>('/api/secrets'),
  create: (input: { name: string; value: string }) =>
    call<Secret>('/api/secrets', { method: 'POST', body: JSON.stringify(input) }),
  reveal: (id: string) =>
    call<{ value: string }>(`/api/secrets/${id}/reveal`, { method: 'POST' }),
  revoke: (id: string) =>
    call<void>(`/api/secrets/${id}`, { method: 'DELETE' }),
  rotate: (id: string, value: string) =>
    call<void>(`/api/secrets/${id}/rotate`, {
      method: 'POST',
      body: JSON.stringify({ value }),
    }),
  share: (id: string, userId: string) =>
    call<void>(`/api/secrets/${id}/share`, {
      method: 'POST',
      body: JSON.stringify({ user_id: userId }),
    }),
  expire: (id: string, inMinutes: number) =>
    call<void>(`/api/secrets/${id}/expire`, {
      method: 'POST',
      body: JSON.stringify({ in_minutes: inMinutes }),
    }),
}
