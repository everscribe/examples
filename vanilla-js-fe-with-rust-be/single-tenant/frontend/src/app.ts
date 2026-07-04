// Vanilla TS vault UI. The audit-log embed is the <audit-trail> custom
// element from @everscribe/components-element (auto-registered when
// imported in main.ts). The rest is plain DOM manipulation — no
// framework, just structured event handlers and a small `el(...)`
// helper to keep markup readable.
import { api, getActorId, setActorId, type Secret, type User } from './api.js'

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
  users: User[]
  secrets: Secret[]
  actorId: string
  error: string | null
  dialog: Dialog
}

const state: State = {
  users: [],
  secrets: [],
  actorId: getActorId(),
  error: null,
  dialog: null,
}

// Stable section roots — built once on mount. The audit-trail embed
// lives inside `embedSection` and is NEVER replaced after mount, so
// it doesn't refetch tokens on every state change.
let topbarEl!: HTMLElement
let errorBar!: HTMLElement
let vaultSection!: HTMLElement
let embedSection!: HTMLElement
let dialogLayer!: HTMLElement

export function mountApp(root: HTMLElement) {
  topbarEl = buildTopbar()
  errorBar = el('div', { className: 'error-bar' })
  vaultSection = el('div')
  embedSection = buildEmbedSection()
  dialogLayer = el('div', { className: 'dialog-layer' })

  // .app provides the max-width gutter that styles.css expects;
  // dialogLayer sits outside it so the modal backdrop covers the full
  // viewport (its `position: fixed` makes that work either way, but
  // keeping it as a sibling is cleaner).
  const appShell = el('div', { className: 'app' },
    topbarEl, errorBar, vaultSection, embedSection,
  )
  root.append(appShell, dialogLayer)

  renderError()
  renderVault()
  renderDialog()
  void refreshAll()
}

// -------------------------- data refresh --------------------------

async function refreshAll() {
  try {
    const [users, secrets] = await Promise.all([api.users(), api.secrets()])
    state.users = users
    state.secrets = secrets
    if (!state.actorId && users.length > 0) {
      pickActor(users[0].id)
    }
  } catch (err) {
    state.error = String(err)
  }
  renderTopbar()
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

function pickActor(id: string) {
  setActorId(id)
  state.actorId = id
}

function setError(msg: string | null) {
  state.error = msg
  renderError()
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
        'Demo · Vanilla JS frontend + Go backend · single-tenant'),
    ),
    el('label', { className: 'who' },
      el('span', {}, 'Logged in as'),
      buildActorSelect(),
    ),
  )
}

function buildActorSelect(): HTMLElement {
  const select = el('select', {
    onchange: (e: Event) => {
      pickActor((e.target as HTMLSelectElement).value)
      void refreshSecrets()
    },
  }) as HTMLSelectElement
  for (const u of state.users) {
    const opt = el('option', { value: u.id }, `${u.name} (${u.role})`) as HTMLOptionElement
    opt.selected = u.id === state.actorId
    select.append(opt)
  }
  return select
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

// -------------------------- vault section --------------------------

function renderVault() {
  vaultSection.replaceChildren(
    el('section', { className: 'panel labeled' },
      el('div', { className: 'label-corner' }, 'your code · vault UI'),
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
    hint('Records a ', code('secret.create'), ' event.'),
    nameEl,
    valueEl,
    el('div', { className: 'modal-buttons' },
      el('button', { type: 'button', className: 'secondary', onclick: closeDialog }, 'Cancel'),
      el('button', { type: 'submit' }, 'Add'),
    ),
  )
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

function buildActionSelect(s: Secret): HTMLElement {
  const placeholder = el('option', { value: '', disabled: true, selected: true }, 'Actions…')
  const select = el('select', {
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
  return select
}

function onRowAction(s: Secret, action: RowAction) {
  if (action === 'reveal') {
    void onReveal(s)
  } else {
    openDialog({ kind: action, secret: s })
  }
}

// -------------------------- embed section --------------------------

function buildEmbedSection(): HTMLElement {
  const audit = document.createElement('audit-trail') as HTMLElement
  audit.setAttribute('token-endpoint', '/api/embed-token')
  audit.setAttribute('poll-interval', '1000')
  audit.setAttribute('theme', 'light')
  audit.setAttribute('default-time-range', '7d')
  return el('section', { className: 'panel labeled' },
    el('div', { className: 'label-corner' }, 'Embedded Everscribe Component'),
    el('div', { className: 'panel-body' }, audit),
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
  const me = state.users.find((u) => u.id === state.actorId)
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
      const candidates = state.users.filter(
        (u) => u.id !== state.actorId && !d.secret.shared_with.includes(u.id),
      )
      const body: HTMLElement[] = [el('h3', {}, `Share ${d.secret.name}`)]
      if (candidates.length === 0) {
        body.push(hint('No one else to share with.'))
      } else {
        body.push(hint('Records a ', code('secret.share'), ' event.'))
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

type Attrs = Record<string, unknown>
type Child = Node | string

// Tiny createElement helper so the markup above stays readable. Spreads
// attrs onto the element, attaches event listeners for `on*` keys,
// and appends children.
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
