const disconnectButton = document.getElementById('disconnect')
const reconnectButton = document.getElementById('reconnect')
const handoffButton = document.getElementById('handoff')
const statusEl = document.getElementById('status')
const hintEl = document.getElementById('hint')

const MANUAL_DISCONNECT_KEY = 'manualDisconnected'
let manualDisconnected = false

let handoffTimer = null
const HANDOFF_LABEL = '发送当前页到 Dogear'

handoffButton.addEventListener('click', async () => {
  handoffButton.disabled = true
  let result
  try {
    result = await chrome.runtime.sendMessage({ type: 'dogear_handoff' })
  } catch {
    result = { ok: false, error: '后台未就绪' }
  }
  handoffButton.textContent = result?.ok ? '已发送 ✓' : result?.error || '发送失败'
  clearTimeout(handoffTimer)
  handoffTimer = setTimeout(() => {
    handoffButton.textContent = HANDOFF_LABEL
    handoffButton.disabled = false
  }, 2000)
})

disconnectButton.addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'dogear_disconnect' }).catch(() => {})
  window.close()
})

reconnectButton.addEventListener('click', async () => {
  reconnectButton.disabled = true
  try {
    await chrome.runtime.sendMessage({ type: 'dogear_connect' })
  } catch {
  }
  reconnectButton.disabled = false
  refresh()
})

function render(state) {
  if (state.status === 'connected') {
    statusEl.className = 'ok'
    statusEl.textContent = `已连接${state.appVersion ? ' · Dogear ' + state.appVersion : ''}\n${state.title || ''}\n${state.url || ''}`
  } else if (state.status === 'connecting') {
    statusEl.className = 'muted'
    statusEl.textContent = '连接中…'
  } else if (state.status === 'error') {
    statusEl.className = 'err'
    statusEl.textContent = state.error || '连接失败'
  } else {
    statusEl.className = 'muted'
    statusEl.textContent = '未连接'
  }
  disconnectButton.hidden = state.status !== 'connected'
  const manualOff = manualDisconnected && state.status !== 'connected'
  reconnectButton.hidden = !manualOff
  hintEl.hidden = !manualOff
}

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === 'dogear_state') render(message)
})

async function refresh() {
  const [data, state] = await Promise.all([
    chrome.storage.session.get(MANUAL_DISCONNECT_KEY).catch(() => ({})),
    chrome.runtime.sendMessage({ type: 'dogear_get_state' }).catch(() => null)
  ])
  manualDisconnected = data[MANUAL_DISCONNECT_KEY] === true
  if (state) render(state)
}

refresh()
setInterval(refresh, 3000)
