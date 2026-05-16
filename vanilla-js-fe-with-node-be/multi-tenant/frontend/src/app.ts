// Vanilla TS multi-tenant vault UI. Two tabs (Customer · Admin), each
// mounting an <audit-trail> from @everscribe/components-element with a
// differently-scoped embed token.
//
// Note: the customer-tab embed uses the JS-only `onTokenExpired`
// property instead of the `token-endpoint` attribute. The web component's
// built-in token fetch sends only `credentials: 'include'` — no custom
// headers — but our /api/embed-token/customer needs `X-Demo-Actor` to
// know which tenant to scope to. The callback gives us a place to
// attach the header.
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

interface State {
  tenants: Tenant[]
  users: User[]
  secrets: Secret[]
  actorId: string
  tab: Tab
  error: string | null
  dialog: Dialog
}

const state: State = {
  tenants: [],
  users: [],
  secrets: [],
  actorId: getActorId(),
  tab: 'customer',
  error: null,
  dialog: null,
}

// Stable section roots. Both <audit-trail> elements stay mounted across
// tab switches so they don't refetch tokens unnecessarily; we just
// toggle the parent section's display.
let topbarEl!: HTMLElement
let errorBar!: HTMLElement
let tabsBar!: HTMLElement
let customerSection!: HTMLElement
let adminSection!: HTMLElement
let vaultSection!: HTMLElement
let customerEmbed!: AuditTrailEl
let dialogLayer!: HTMLElement

interface AuditTrailEl extends HTMLElement {
  onTokenExpired?: () => Promise<string>
}

export function mountApp(root: HTMLElement) {
  topbarEl = buildTopbar()
  errorBar = el('div', { className: 'error-bar' })
  tabsBar = buildTabs()
  vaultSection = el('div')
  customerEmbed = buildCustomerEmbed()
  customerSection = buildCustomerSection()
  adminSection = buildAdminSection()
  dialogLayer = el('div', { className: 'dialog-layer' })

  const appShell = el('div', { className: 'app' },
    topbarEl, errorBar, tabsBar, customerSection, adminSection,
  )
  root.append(appShell, dialogLayer)

  applyTabVisibility()
  renderError()
  renderVault()
  renderDialog()
  void refreshAll()
}

// -------------------------- data refresh --------------------------

async function refreshAll() {
  try {
    const [tenants, users] = await Promise.all([api.tenants(), api.users()])
    state.tenants = tenants
    state.users = users
    if (!state.actorId && users.length > 0) {
      pickActor(users[0].id, { skipRebuild: true })
    }
    if (state.actorId) {
      state.secrets = await api.secrets()
    }
  } catch (err) {
    state.error = String(err)
  }
  renderTopbar()
  renderTabs()
  renderVault()
  renderError()
}

async function refreshSecrets() {
  try {
    state.secrets = await api.secrets()
  } catch (err) {
    state.error = String(err)
  }
  renderVault()
  renderError()
}

function pickActor(id: string, opts: { skipRebuild?: boolean } = {}) {
  setActorId(id)
  state.actorId = id
  // Tenant changed → swap the customer embed for a fresh element. The
  // simplest correctness guarantee: brand-new instance, brand-new token
  // fetch, no stale state.
  if (!opts.skipRebuild) {
    rebuildCustomerEmbed()
  }
  renderTabs()
}

function setError(msg: string | null) {
  state.error = msg
  renderError()
}

function setTab(t: Tab) {
  state.tab = t
  applyTabVisibility()
  renderTabs()
}

// -------------------------- topbar --------------------------

function buildTopbar(): HTMLElement {
  return el('header', { className: 'topbar' })
}

function renderTopbar() {
  topbarEl.replaceChildren(
    el('div', {},
      el('h1', {}, 'Secrets vault'),
      el('p', { className: 'subtitle' },
        'Demo · Vanilla JS frontend + Go backend · multi-tenant'),
    ),
    el('label', { className: 'who' },
      el('span', {}, 'Logged in as'),
      buildActorSelect(),
    ),
  )
}

function buildActorSelect(): HTMLSelectElement {
  const select = el('select', {
    onchange: (e: Event) => {
      pickActor((e.target as HTMLSelectElement).value)
      void refreshSecrets()
    },
  }) as HTMLSelectElement
  for (const u of state.users) {
    const t = state.tenants.find((x) => x.id === u.tenant_id)
    const label = `${u.name} · ${u.role} @ ${t?.name ?? u.tenant_id}`
    const opt = el('option', { value: u.id }, label) as HTMLOptionElement
    opt.selected = u.id === state.actorId
    select.append(opt)
  }
  return select
}

// -------------------------- tabs --------------------------

function buildTabs(): HTMLElement {
  return el('div', { className: 'tabs', role: 'tablist' })
}

function renderTabs() {
  const me = currentUser()
  const myTenant = state.tenants.find((t) => t.id === me?.tenant_id)
  tabsBar.replaceChildren(
    el('button', {
      role: 'tab',
      className: state.tab === 'customer' ? 'active' : '',
      onclick: () => setTab('customer'),
    },
      document.createTextNode('Customer view'),
      myTenant
        ? el('span', { className: 'tab-sub' }, myTenant.name)
        : '',
    ),
    el('button', {
      role: 'tab',
      className: state.tab === 'admin' ? 'active' : '',
      onclick: () => setTab('admin'),
    },
      document.createTextNode('Admin view'),
      el('span', { className: 'tab-sub' }, 'all tenants'),
    ),
  )
}

function applyTabVisibility() {
  customerSection.style.display = state.tab === 'customer' ? '' : 'none'
  adminSection.style.display = state.tab === 'admin' ? '' : 'none'
}

// -------------------------- error bar --------------------------

function renderError() {
  if (!state.error) {
    errorBar.replaceChildren()
    return
  }
  errorBar.replaceChildren(
    el('div', { className: 'error' },
      document.createTextNode(state.error + ' '),
      el('button', { onclick: () => setError(null) }, 'dismiss'),
    ),
  )
}

// -------------------------- customer section --------------------------

function buildCustomerSection(): HTMLElement {
  // Vault panel + embed panel live inside the customer section. The
  // vault panel re-renders on data changes; the embed is stable.
  return el('div', {},
    vaultSection,
    el('section', { className: 'panel labeled' },
      el('div', { className: 'label-corner' }, 'Embedded Everscribe Component'),
      el('div', { className: 'panel-body' },
        el('p', { className: 'scope-hint' }, ...customerScopeHint()),
        customerEmbed,
      ),
    ),
  )
}

function customerScopeHint(): (Node | string)[] {
  const me = currentUser()
  return [
    document.createTextNode('Token scoped to '),
    code(`tenant_id=${me?.tenant_id ?? '—'}`),
    document.createTextNode(" — only this tenant's events are visible."),
  ]
}

function renderVault() {
  const me = currentUser()
  const myTenant = state.tenants.find((t) => t.id === me?.tenant_id)
  vaultSection.replaceChildren(
    el('section', { className: 'panel labeled' },
      el('div', { className: 'label-corner' },
        `your code · vault UI (${myTenant?.name ?? '—'})`),
      el('div', { className: 'panel-body' },
        el('div', { className: 'vault-header' },
          el('h2', {}, `Vault (${state.secrets.length})`),
          el('button', {
            className: 'new-secret-btn',
            onclick: () => openDialog({ kind: 'create' }),
          },
            el('span', { className: 'plus', 'aria-hidden': 'true' }, '+'),
            document.createTextNode('New secret'),
          ),
        ),
        buildSecretsTable(),
      ),
    ),
  )
}

function buildCreateForm(): HTMLElement {
  const me = currentUser()
  const myTenant = state.tenants.find((t) => t.id === me?.tenant_id)
  const nameEl = el('input', {
    name: 'name',
    placeholder: 'name (e.g. stripe_api_key)',
    required: true,
    autofocus: true,
  }) as HTMLInputElement
  const valueEl = el('input', {
    name: 'value',
    placeholder: 'plaintext value',
    required: true,
  }) as HTMLInputElement
  return el('form', {
    onsubmit: async (e: Event) => {
      e.preventDefault()
      const name = nameEl.value.trim()
      const value = valueEl.value
      if (!name || !value) return
      try {
        await api.create({ name, value })
        closeDialog()
        await refreshSecrets()
      } catch (err) {
        setError(String(err))
      }
    },
  },
    el('h3', {}, 'New secret'),
    hint('Records a ', code('secret.create'),
      ` event scoped to ${myTenant?.name ?? 'this tenant'}.`),
    nameEl,
    valueEl,
    el('div', { className: 'modal-buttons' },
      el('button', { type: 'button', className: 'secondary', onclick: closeDialog }, 'Cancel'),
      el('button', { type: 'submit' }, 'Add'),
    ),
  )
}

function buildActionSelect(s: Secret): HTMLElement {
  const placeholder = el('option', { value: '', disabled: true, selected: true }, 'Actions…')
  return el('select', {
    className: 'action-select',
    onchange: (e: Event) => {
      const sel = e.currentTarget as HTMLSelectElement
      const action = sel.value as RowAction | ''
      sel.value = ''
      if (action) onRowAction(s, action)
    },
  },
    placeholder,
    el('option', { value: 'reveal' }, 'Reveal'),
    el('option', { value: 'rotate' }, 'Rotate'),
    el('option', { value: 'share' }, 'Share'),
    el('option', { value: 'expire' }, 'Expire'),
    el('option', { value: 'revoke' }, 'Revoke'),
  )
}

function onRowAction(s: Secret, action: RowAction) {
  if (action === 'reveal') {
    void onReveal(s)
  } else {
    openDialog({ kind: action, secret: s })
  }
}

function buildSecretsTable(): HTMLElement {
  return el('table', { className: 'secrets' },
    el('thead', {},
      el('tr', {},
        el('th', {}, 'Name'),
        el('th', {}, 'Created by'),
        el('th', {}, 'Status'),
        el('th', {}, 'Actions'),
      ),
    ),
    el('tbody', {}, ...state.secrets.map(buildSecretRow)),
  )
}

function buildSecretRow(s: Secret): HTMLElement {
  const nameTd = el('td', {},
    el('code', {}, s.name),
    s.shared_with.length > 0
      ? el('span', { className: 'badge' }, `shared · ${s.shared_with.length}`)
      : '',
    s.expires_at
      ? el('span', { className: 'badge' }, `expires ${fmtTime(s.expires_at)}`)
      : '',
  )
  const actionsTd = el('td', { className: 'actions' })
  if (!s.revoked) {
    actionsTd.append(buildActionSelect(s))
  }
  return el('tr', { className: s.revoked ? 'revoked' : '' },
    nameTd,
    el('td', {}, userName(s.created_by)),
    el('td', {}, s.revoked ? el('em', {}, 'revoked') : el('span', {}, 'active')),
    actionsTd,
  )
}

// -------------------------- embeds --------------------------

function buildCustomerEmbed(): AuditTrailEl {
  const audit = document.createElement('audit-trail') as AuditTrailEl
  audit.setAttribute('poll-interval', '1000')
  audit.setAttribute('theme', 'light')
  audit.setAttribute('default-time-range', '7d')
  // JS callback (not the token-endpoint attribute) so we can send
  // X-Demo-Actor — required for /api/embed-token/customer to identify
  // the actor's tenant.
  audit.onTokenExpired = async () => {
    const res = await fetch('/api/embed-token/customer', {
      headers: { 'X-Demo-Actor': getActorId() },
    })
    if (!res.ok) throw new Error(`mint failed: ${res.status}`)
    const body = (await res.json()) as { token: string }
    return body.token
  }
  return audit
}

function rebuildCustomerEmbed() {
  const next = buildCustomerEmbed()
  customerEmbed.replaceWith(next)
  customerEmbed = next
}

function buildAdminSection(): HTMLElement {
  // Admin embed: token has no tenant scope. /api/embed-token/admin
  // doesn't read X-Demo-Actor, so the simpler `token-endpoint`
  // attribute is enough. Built once, never replaced.
  const audit = document.createElement('audit-trail') as HTMLElement
  audit.setAttribute('token-endpoint', '/api/embed-token/admin')
  audit.setAttribute('poll-interval', '1000')
  audit.setAttribute('theme', 'light')
  audit.setAttribute('default-time-range', '7d')

  return el('section', { className: 'panel labeled' },
    el('div', { className: 'label-corner' }, 'Embedded Everscribe Component'),
    el('div', { className: 'panel-body' },
      el('p', { className: 'scope-hint' },
        document.createTextNode('Token has no '),
        code('tenant_id'),
        document.createTextNode(" — events from every tenant in the project are visible. This is your business's internal console."),
      ),
      audit,
    ),
  )
}

// -------------------------- dialog --------------------------

function openDialog(d: Dialog) {
  state.dialog = d
  renderDialog()
}

function closeDialog() {
  state.dialog = null
  renderDialog()
}

function renderDialog() {
  dialogLayer.replaceChildren()
  const d = state.dialog
  if (!d) return
  dialogLayer.append(
    el('div', {
      className: 'modal-backdrop',
      onclick: closeDialog,
    },
      el('div', {
        className: 'modal',
        onclick: (e: Event) => e.stopPropagation(),
      },
        ...buildDialogBody(d),
      ),
    ),
  )
}

function buildDialogBody(d: NonNullable<Dialog>): HTMLElement[] {
  const me = currentUser()
  const myTenant = state.tenants.find((t) => t.id === me?.tenant_id)
  switch (d.kind) {
    case 'create':
      return [buildCreateForm()]

    case 'reveal':
      return [
        el('h3', {}, 'Revealed value'),
        el('p', { className: 'hint' },
          document.createTextNode('Recorded as '),
          el('code', {}, 'secret.reveal'),
          document.createTextNode(me ? ` by ${me.name}.` : '.'),
        ),
        el('pre', {}, d.value),
        el('div', { className: 'modal-buttons' },
          el('button', { onclick: closeDialog }, 'Close'),
        ),
      ]

    case 'revoke':
      return [
        el('h3', {}, `Revoke ${d.secret.name}?`),
        hint('Records a ', code('secret.revoke'), ' event with a redacted before/after diff.'),
        el('div', { className: 'modal-buttons' },
          el('button', { className: 'secondary', onclick: closeDialog }, 'Cancel'),
          el('button', {
            className: 'danger',
            onclick: async () => {
              try {
                await api.revoke(d.secret.id)
                closeDialog()
                await refreshSecrets()
              } catch (err) { setError(String(err)) }
            },
          }, 'Revoke'),
        ),
      ]

    case 'rotate': {
      const input = el('input', {
        autofocus: true,
        placeholder: 'new plaintext value',
        required: true,
        oninput: () => { submit.disabled = !input.value },
      }) as HTMLInputElement
      const submit = el('button', { type: 'submit', disabled: true }, 'Rotate') as HTMLButtonElement
      return [
        el('form', {
          onsubmit: async (e: Event) => {
            e.preventDefault()
            if (!input.value) return
            try {
              await api.rotate(d.secret.id, input.value)
              closeDialog()
              await refreshSecrets()
            } catch (err) { setError(String(err)) }
          },
        },
          el('h3', {}, `Rotate ${d.secret.name}`),
          hint('Records a ', code('secret.rotate'),
            ' event. The plaintext is replaced with ', code('[REDACTED]'),
            ' in the audit diff.'),
          input,
          el('div', { className: 'modal-buttons' },
            el('button', { type: 'button', className: 'secondary', onclick: closeDialog }, 'Cancel'),
            submit,
          ),
        ),
      ]
    }

    case 'share': {
      // Same-tenant only: filter candidates to actor's tenant, exclude
      // self and anyone already shared with.
      const candidates = me
        ? state.users.filter(
            (u) =>
              u.tenant_id === me.tenant_id &&
              u.id !== state.actorId &&
              !d.secret.shared_with.includes(u.id),
          )
        : []
      const body: HTMLElement[] = [el('h3', {}, `Share ${d.secret.name}`)]
      if (candidates.length === 0) {
        body.push(hint(`No one else in ${myTenant?.name ?? 'this tenant'} to share with.`))
      } else {
        body.push(hint('Records a ', code('secret.share'),
          ' event. Sharing is restricted to users in the same tenant.'))
        body.push(
          el('ul', { className: 'share-list' },
            ...candidates.map((u) =>
              el('li', {},
                el('button', {
                  onclick: async () => {
                    try {
                      await api.share(d.secret.id, u.id)
                      closeDialog()
                      await refreshSecrets()
                    } catch (err) { setError(String(err)) }
                  },
                },
                  document.createTextNode(`${u.name} `),
                  el('span', { className: 'role' }, `(${u.role})`),
                ),
              ),
            ),
          ),
        )
      }
      body.push(
        el('div', { className: 'modal-buttons' },
          el('button', { className: 'secondary', onclick: closeDialog },
            candidates.length === 0 ? 'Close' : 'Cancel'),
        ),
      )
      return body
    }

    case 'expire': {
      const input = el('input', {
        type: 'number',
        min: '1',
        autofocus: true,
        required: true,
        value: '60',
        oninput: () => { submit.disabled = !Number(input.value) },
      }) as HTMLInputElement
      const submit = el('button', { type: 'submit' }, 'Set expiry') as HTMLButtonElement
      return [
        el('form', {
          onsubmit: async (e: Event) => {
            e.preventDefault()
            const minutes = Number(input.value)
            if (!Number.isFinite(minutes) || minutes <= 0) return
            try {
              await api.expire(d.secret.id, minutes)
              closeDialog()
              await refreshSecrets()
            } catch (err) { setError(String(err)) }
          },
        },
          el('h3', {}, `Expire ${d.secret.name}`),
          hint('Records a ', code('secret.expire'),
            ' event with the new expiry timestamp in metadata.'),
          el('label', { className: 'field' },
            el('span', {}, 'Expire in (minutes)'),
            input,
          ),
          el('div', { className: 'modal-buttons' },
            el('button', { type: 'button', className: 'secondary', onclick: closeDialog }, 'Cancel'),
            submit,
          ),
        ),
      ]
    }
  }
}

// -------------------------- vault actions --------------------------

async function onReveal(s: Secret) {
  try {
    const { value } = await api.reveal(s.id)
    openDialog({ kind: 'reveal', secret: s, value })
  } catch (err) {
    setError(String(err))
  }
}

// -------------------------- helpers --------------------------

function currentUser(): User | undefined {
  return state.users.find((u) => u.id === state.actorId)
}

type Attrs = Record<string, unknown>
type Child = Node | string

function el(tag: string, attrs: Attrs = {}, ...children: Child[]): HTMLElement {
  const node = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs)) {
    if (v === false || v == null) continue
    if (k === 'className') node.className = String(v)
    else if (k.startsWith('on') && typeof v === 'function') {
      node.addEventListener(k.slice(2).toLowerCase(), v as EventListener)
    } else if (v === true) {
      node.setAttribute(k, '')
    } else {
      node.setAttribute(k, String(v))
    }
  }
  for (const c of children) {
    if (c === '' || c == null) continue
    node.append(c instanceof Node ? c : document.createTextNode(String(c)))
  }
  return node
}

function code(text: string): HTMLElement {
  return el('code', {}, text)
}

function hint(...parts: Child[]): HTMLElement {
  return el('p', { className: 'hint' }, ...parts)
}

function userName(id: string): string {
  return state.users.find((u) => u.id === id)?.name ?? id
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
