<script lang="ts">
  import { api, getActorId, setActorId, type Secret, type User } from './api.js'

  type Dialog =
    | { kind: 'reveal'; secret: Secret; value: string }
    | { kind: 'revoke'; secret: Secret }
    | { kind: 'rotate'; secret: Secret }
    | { kind: 'share'; secret: Secret }
    | { kind: 'expire'; secret: Secret }
    | null

  let users = $state<User[]>([])
  let secrets = $state<Secret[]>([])
  let actorId = $state<string>(getActorId())
  let error = $state<string | null>(null)
  let dialog = $state<Dialog>(null)
  let dialogInput = $state<string>('')

  let me = $derived(users.find((u) => u.id === actorId))

  // Reset dialog input when the dialog kind changes — expire defaults
  // to 60, others start blank.
  $effect(() => {
    dialogInput = dialog?.kind === 'expire' ? '60' : ''
  })

  // Initial load + auto-pick first user if nothing in localStorage.
  $effect(() => {
    void refreshAll()
  })

  async function refreshAll() {
    try {
      const [u, s] = await Promise.all([api.users(), api.secrets()])
      users = u
      secrets = s
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

  // Svelte action to autofocus an input on mount — works for elements
  // inserted dynamically (e.g., when the dialog opens).
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
      ;(e.currentTarget as HTMLFormElement).reset()
      await refreshSecrets()
    } catch (err) {
      error = String(err)
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
    } catch (err) {
      error = String(err)
    }
  }

  async function confirmRotate(e: SubmitEvent) {
    e.preventDefault()
    if (dialog?.kind !== 'rotate' || !dialogInput) return
    try {
      await api.rotate(dialog.secret.id, dialogInput)
      dialog = null
      await refreshSecrets()
    } catch (err) {
      error = String(err)
    }
  }

  async function confirmShare(userId: string) {
    if (dialog?.kind !== 'share') return
    try {
      await api.share(dialog.secret.id, userId)
      dialog = null
      await refreshSecrets()
    } catch (err) {
      error = String(err)
    }
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
    } catch (err) {
      error = String(err)
    }
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

  // Share candidates: everyone but the actor and already-shared users.
  let shareCandidates = $derived(
    dialog?.kind === 'share'
      ? users.filter(
          (u) => u.id !== actorId && !dialog!.secret.shared_with.includes(u.id),
        )
      : [],
  )
</script>

<div class="app">
  <header class="topbar">
    <div>
      <h1>Secrets vault</h1>
      <p class="subtitle">Demo · Svelte frontend + Go backend · single-tenant</p>
    </div>
    <label class="who">
      <span>Logged in as</span>
      <select value={actorId} onchange={(e) => pickActor((e.currentTarget as HTMLSelectElement).value)}>
        {#each users as u (u.id)}
          <option value={u.id}>{u.name} ({u.role})</option>
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

  <section class="panel labeled">
    <div class="label-corner">your code · vault UI</div>
    <div class="panel-body">
      <h2>Create a secret</h2>
      <form class="create-form" onsubmit={onCreate}>
        <input name="name" placeholder="name (e.g. stripe_api_key)" required />
        <input name="value" placeholder="plaintext value" required />
        <button type="submit">Add</button>
      </form>

      <h2>Vault ({secrets.length})</h2>
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
                  <button onclick={() => onReveal(s)}>Reveal</button>
                  <button onclick={() => (dialog = { kind: 'rotate', secret: s })}>Rotate</button>
                  <button onclick={() => (dialog = { kind: 'share', secret: s })}>Share</button>
                  <button onclick={() => (dialog = { kind: 'expire', secret: s })}>Expire</button>
                  <button class="danger" onclick={() => (dialog = { kind: 'revoke', secret: s })}>
                    Revoke
                  </button>
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
      <audit-trail
        token-endpoint="/api/embed-token"
        poll-interval="1000"
        theme="light"
        default-time-range="7d"
      ></audit-trail>
    </div>
  </section>
</div>

{#if dialog}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="modal-backdrop" onclick={closeDialog}>
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="modal" onclick={(e) => e.stopPropagation()}>
      {#if dialog.kind === 'reveal'}
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
          Records a <code>secret.revoke</code> event with a redacted before/after
          diff.
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
          <p class="hint">No one else to share with.</p>
        {:else}
          <p class="hint">Records a <code>secret.share</code> event.</p>
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
