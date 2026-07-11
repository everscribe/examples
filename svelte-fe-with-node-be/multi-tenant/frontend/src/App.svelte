<script lang="ts">
  import {
    api,
    getActorId,
    setActorId,
    type Secret,
    type Tenant,
    type User,
  } from './api.js'

  type Tab = 'customer' | 'admin'

  type Dialog =
    | { kind: 'reveal'; secret: Secret; value: string }
    | { kind: 'revoke'; secret: Secret }
    | { kind: 'rotate'; secret: Secret }
    | { kind: 'share'; secret: Secret }
    | { kind: 'expire'; secret: Secret }
    | { kind: 'create' }
    | null

  type RowAction = 'reveal' | 'rotate' | 'share' | 'expire' | 'revoke'

  // The web component exposes onTokenExpired as a JS-only property - no
  // attribute equivalent - so we set it via bind:this + $effect.
  interface AuditTrailEl extends HTMLElement {
    onTokenExpired?: () => Promise<string>
  }

  let tenants = $state<Tenant[]>([])
  let users = $state<User[]>([])
  let secrets = $state<Secret[]>([])
  let actorId = $state<string>(getActorId())
  let tab = $state<Tab>('customer')
  let error = $state<string | null>(null)
  let dialog = $state<Dialog>(null)
  let dialogInput = $state<string>('')

  let me = $derived(users.find((u) => u.id === actorId))
  let myTenant = $derived(tenants.find((t) => t.id === me?.tenant_id))

  // Reset dialog input when the dialog kind changes.
  $effect(() => {
    dialogInput = dialog?.kind === 'expire' ? '60' : ''
  })

  // Initial load.
  $effect(() => {
    void refreshAll()
  })

  // Refetch secrets when the actor (and therefore tenant) changes.
  $effect(() => {
    if (actorId) void refreshSecrets()
  })

  // Svelte action: create the <audit-trail> imperatively so we can set
  // `onTokenExpired` BEFORE the element is appended to the DOM. The
  // element's connectedCallback bootstraps synchronously on append and
  // requires one of token / token-endpoint / onTokenExpired; setting it
  // after mount via bind:this is too late.
  function customerAuditTrail(node: HTMLElement) {
    const el = document.createElement('audit-trail') as AuditTrailEl
    el.onTokenExpired = async () => {
      // Customer endpoint reads X-Demo-Actor to scope the token to the
      // actor's tenant. The built-in tokenEndpoint fetcher only sends
      // `credentials: 'include'`, so we attach the header here.
      const res = await fetch('/api/embed-token/customer', {
        headers: { 'X-Demo-Actor': getActorId() },
      })
      if (!res.ok) throw new Error(`mint failed: ${res.status}`)
      const body = (await res.json()) as { token: string }
      return body.token
    }
    el.setAttribute('poll-interval', '1000')
    el.setAttribute('theme', 'light')
    el.setAttribute('default-time-range', '7d')
    node.appendChild(el)
    return {
      destroy() { el.remove() },
    }
  }

  async function refreshAll() {
    try {
      const [t, u] = await Promise.all([api.tenants(), api.users()])
      tenants = t
      users = u
      if (!actorId && u.length > 0) pickActor(u[0].id)
    } catch (e) {
      error = String(e)
    }
  }

  async function refreshSecrets() {
    try {
      secrets = await api.secrets()
    } catch (e) {
      error = String(e)
    }
  }

  function pickActor(id: string) {
    setActorId(id)
    actorId = id
  }

  function autofocus(node: HTMLElement) {
    node.focus()
  }

  async function onCreate(e: SubmitEvent) {
    e.preventDefault()
    const form = new FormData(e.currentTarget as HTMLFormElement)
    const name = String(form.get('name') ?? '').trim()
    const value = String(form.get('value') ?? '')
    if (!name || !value) return
    try {
      await api.create({ name, value })
      dialog = null
      await refreshSecrets()
    } catch (err) {
      error = String(err)
    }
  }

  function onRowAction(s: Secret, action: RowAction) {
    if (action === 'reveal') {
      void onReveal(s)
    } else {
      dialog = { kind: action, secret: s }
    }
  }

  async function onReveal(s: Secret) {
    try {
      const { value } = await api.reveal(s.id)
      dialog = { kind: 'reveal', secret: s, value }
    } catch (err) {
      error = String(err)
    }
  }

  async function confirmRevoke() {
    if (dialog?.kind !== 'revoke') return
    try {
      await api.revoke(dialog.secret.id)
      dialog = null
      await refreshSecrets()
    } catch (err) { error = String(err) }
  }

  async function confirmRotate(e: SubmitEvent) {
    e.preventDefault()
    if (dialog?.kind !== 'rotate' || !dialogInput) return
    try {
      await api.rotate(dialog.secret.id, dialogInput)
      dialog = null
      await refreshSecrets()
    } catch (err) { error = String(err) }
  }

  async function confirmShare(userId: string) {
    if (dialog?.kind !== 'share') return
    try {
      await api.share(dialog.secret.id, userId)
      dialog = null
      await refreshSecrets()
    } catch (err) { error = String(err) }
  }

  async function confirmExpire(e: SubmitEvent) {
    e.preventDefault()
    if (dialog?.kind !== 'expire') return
    const minutes = Number(dialogInput)
    if (!Number.isFinite(minutes) || minutes <= 0) return
    try {
      await api.expire(dialog.secret.id, minutes)
      dialog = null
      await refreshSecrets()
    } catch (err) { error = String(err) }
  }

  function closeDialog() {
    dialog = null
  }

  function userName(id: string): string {
    return users.find((u) => u.id === id)?.name ?? id
  }

  function fmtTime(iso: string): string {
    return new Date(iso).toLocaleString(undefined, {
      hour: '2-digit',
      minute: '2-digit',
      month: 'short',
      day: 'numeric',
    })
  }

  // Same-tenant sharing only - actor's tenant, exclude self and
  // already-shared users.
  let shareCandidates = $derived.by(() => {
    if (dialog?.kind !== 'share' || !me) return []
    const shared = dialog.secret.shared_with
    const tenantId = me.tenant_id
    return users.filter(
      (u) => u.tenant_id === tenantId && u.id !== actorId && !shared.includes(u.id),
    )
  })
</script>

<div class="app">
  <header class="topbar">
    <div>
      <h1>Secrets vault</h1>
      <p class="subtitle">Demo · Svelte frontend + Go backend · multi-tenant</p>
    </div>
    <label class="who">
      <span>Logged in as</span>
      <select value={actorId} onchange={(e) => pickActor((e.currentTarget as HTMLSelectElement).value)}>
        {#each users as u (u.id)}
          {@const t = tenants.find((x) => x.id === u.tenant_id)}
          <option value={u.id}>{u.name} · {u.role} @ {t?.name ?? u.tenant_id}</option>
        {/each}
      </select>
    </label>
  </header>

  {#if error}
    <div class="error">
      {error}
      <button onclick={() => (error = null)}>dismiss</button>
    </div>
  {/if}

  <div class="tabs" role="tablist">
    <button
      role="tab"
      class={tab === 'customer' ? 'active' : ''}
      onclick={() => (tab = 'customer')}
    >
      Customer view
      {#if myTenant}<span class="tab-sub">{myTenant.name}</span>{/if}
    </button>
    <button
      role="tab"
      class={tab === 'admin' ? 'active' : ''}
      onclick={() => (tab = 'admin')}
    >
      Admin view
      <span class="tab-sub">all tenants</span>
    </button>
  </div>

  {#if tab === 'customer'}
    <section class="panel labeled">
      <div class="label-corner">your code · vault UI ({myTenant?.name ?? '-'})</div>
      <div class="panel-body">
        <div class="vault-header">
          <h2>Vault ({secrets.length})</h2>
          <button class="new-secret-btn" onclick={() => (dialog = { kind: 'create' })}>
            <span class="plus" aria-hidden="true">+</span>
            New secret
          </button>
        </div>
        <table class="secrets">
          <thead>
            <tr>
              <th>Name</th>
              <th>Created by</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {#each secrets as s (s.id)}
              <tr class={s.revoked ? 'revoked' : ''}>
                <td>
                  <code>{s.name}</code>
                  {#if s.shared_with.length > 0}
                    <span class="badge">shared · {s.shared_with.length}</span>
                  {/if}
                  {#if s.expires_at}
                    <span class="badge">expires {fmtTime(s.expires_at)}</span>
                  {/if}
                </td>
                <td>{userName(s.created_by)}</td>
                <td>{#if s.revoked}<em>revoked</em>{:else}<span>active</span>{/if}</td>
                <td class="actions">
                  {#if !s.revoked}
                    <select
                      class="action-select"
                      value=""
                      onchange={(e) => {
                        const sel = e.currentTarget as HTMLSelectElement
                        const action = sel.value as RowAction | ''
                        sel.value = ''
                        if (action) onRowAction(s, action)
                      }}
                    >
                      <option value="" disabled selected>Actions…</option>
                      <option value="reveal">Reveal</option>
                      <option value="rotate">Rotate</option>
                      <option value="share">Share</option>
                      <option value="expire">Expire</option>
                      <option value="revoke">Revoke</option>
                    </select>
                  {/if}
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    </section>

    <section class="panel labeled">
      <div class="label-corner">Embedded Everscribe Component</div>
      <div class="panel-body">
        <p class="scope-hint">
          Token scoped to <code>tenant_id={myTenant?.id ?? '-'}</code> - only
          this tenant's events are visible.
        </p>
        {#key actorId}
          <div use:customerAuditTrail></div>
        {/key}
      </div>
    </section>
  {:else}
    <section class="panel labeled">
      <div class="label-corner">Embedded Everscribe Component</div>
      <div class="panel-body">
        <p class="scope-hint">
          Token has no <code>tenant_id</code> - events from every tenant in the
          project are visible. This is your business's internal console.
        </p>
        <audit-trail
          token-endpoint="/api/embed-token/admin"
          poll-interval="1000"
          theme="light"
          default-time-range="7d"
        ></audit-trail>
      </div>
    </section>
  {/if}
</div>

{#if dialog}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="modal-backdrop" onclick={closeDialog}>
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="modal" onclick={(e) => e.stopPropagation()}>
      {#if dialog.kind === 'create'}
        <form onsubmit={onCreate}>
          <h3>New secret</h3>
          <p class="hint">
            Records a <code>secret.create</code> event scoped to
            <code>{myTenant?.name ?? 'this tenant'}</code>.
          </p>
          <input
            use:autofocus
            name="name"
            placeholder="name (e.g. stripe_api_key)"
            required
          />
          <input name="value" placeholder="plaintext value" required />
          <div class="modal-buttons">
            <button type="button" class="secondary" onclick={closeDialog}>Cancel</button>
            <button type="submit">Add</button>
          </div>
        </form>
      {:else if dialog.kind === 'reveal'}
        <h3>Revealed value</h3>
        <p class="hint">
          Recorded as <code>secret.reveal</code>{me ? ` by ${me.name}` : ''}.
        </p>
        <pre>{dialog.value}</pre>
        <div class="modal-buttons">
          <button onclick={closeDialog}>Close</button>
        </div>
      {:else if dialog.kind === 'revoke'}
        <h3>Revoke {dialog.secret.name}?</h3>
        <p class="hint">
          Records a <code>secret.revoke</code> event with a redacted
          before/after diff.
        </p>
        <div class="modal-buttons">
          <button class="secondary" onclick={closeDialog}>Cancel</button>
          <button class="danger" onclick={confirmRevoke}>Revoke</button>
        </div>
      {:else if dialog.kind === 'rotate'}
        <form onsubmit={confirmRotate}>
          <h3>Rotate {dialog.secret.name}</h3>
          <p class="hint">
            Records a <code>secret.rotate</code> event. The plaintext is
            replaced with <code>[REDACTED]</code> in the audit diff.
          </p>
          <input
            use:autofocus
            bind:value={dialogInput}
            placeholder="new plaintext value"
            required
          />
          <div class="modal-buttons">
            <button type="button" class="secondary" onclick={closeDialog}>Cancel</button>
            <button type="submit" disabled={!dialogInput}>Rotate</button>
          </div>
        </form>
      {:else if dialog.kind === 'share'}
        <h3>Share {dialog.secret.name}</h3>
        {#if shareCandidates.length === 0}
          <p class="hint">
            No one else in {myTenant?.name ?? 'this tenant'} to share with.
          </p>
        {:else}
          <p class="hint">
            Records a <code>secret.share</code> event. Sharing is restricted
            to users in the same tenant.
          </p>
          <ul class="share-list">
            {#each shareCandidates as u (u.id)}
              <li>
                <button onclick={() => confirmShare(u.id)}>
                  {u.name} <span class="role">({u.role})</span>
                </button>
              </li>
            {/each}
          </ul>
        {/if}
        <div class="modal-buttons">
          <button class="secondary" onclick={closeDialog}>
            {shareCandidates.length === 0 ? 'Close' : 'Cancel'}
          </button>
        </div>
      {:else if dialog.kind === 'expire'}
        <form onsubmit={confirmExpire}>
          <h3>Expire {dialog.secret.name}</h3>
          <p class="hint">
            Records a <code>secret.expire</code> event with the new expiry
            timestamp in metadata.
          </p>
          <label class="field">
            <span>Expire in (minutes)</span>
            <input
              use:autofocus
              type="number"
              min="1"
              bind:value={dialogInput}
              required
            />
          </label>
          <div class="modal-buttons">
            <button type="button" class="secondary" onclick={closeDialog}>Cancel</button>
            <button type="submit" disabled={!Number(dialogInput)}>Set expiry</button>
          </div>
        </form>
      {/if}
    </div>
  </div>
{/if}
