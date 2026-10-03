const button = document.getElementById('connect')
const disconnectButton = document.getElementById('disconnect')
const handoffButton = document.getElementById('handoff')
const statusEl = document.getElementById('status')

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
  button.disabled = state.status === 'connecting'
  disconnectButton.hidden = state.status !== 'connected'
}

button.addEventListener('click', async () => {
  button.disabled = true
  let result
  try {
    result = await chrome.runtime.sendMessage({ type: 'dogear_focus_current' })
  } catch {
    result = { ok: false, error: '后台未就绪' }
  }
  if (result && result.ok === false) {
    statusEl.className = 'err'
    statusEl.textContent = result.error || '操作失败'
  }
  button.disabled = false
})

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === 'dogear_state') render(message)
})

function refresh() {
  chrome.runtime.sendMessage({ type: 'dogear_get_state' }).then(render).catch(() => {})
}

refresh()
setInterval(refresh, 3000)
