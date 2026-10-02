const button = document.getElementById('connect')
const disconnectButton = document.getElementById('disconnect')
const handoffButton = document.getElementById('handoff')
const statusEl = document.getElementById('status')
const permEl = document.getElementById('perm')

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
  handoffButton.hidden = state.status !== 'connected'
}

button.addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'dogear_connect' }).catch(() => {})
})

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === 'dogear_state') render(message)
})

function originFromUrl(url) {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:' && parsed.protocol !== 'ftp:' && parsed.protocol !== 'file:') {
      return null
    }
    const origin = parsed.origin
    return origin === 'null' ? null : origin
  } catch {
    return null
  }
}

async function getCurrentOrigin() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    return tab ? originFromUrl(tab.url) : null
  } catch {
    return null
  }
}

function isOriginGranted(patterns, origin) {
  return patterns.includes('<all_urls>') || patterns.includes(origin + '/*')
}

function renderPermission(origin, granted) {
  permEl.textContent = ''
  if (!origin) {
    permEl.className = 'muted'
    permEl.textContent = '此页面无法按域名授权'
    return
  }
  permEl.className = ''
  const originEl = document.createElement('div')
  originEl.className = granted ? 'perm-origin perm-granted' : 'perm-origin'
  originEl.textContent = granted ? `已授权 ✓ ${origin}` : origin
  permEl.appendChild(originEl)
  const permButton = document.createElement('button')
  if (granted) {
    permButton.className = 'secondary'
    permButton.textContent = '撤销'
    permButton.addEventListener('click', async () => {
      permButton.disabled = true
      try {
        await chrome.permissions.remove({ origins: [origin + '/*'] })
      } catch {
      }
      chrome.runtime.sendMessage({ type: 'dogear_permission_changed' }).catch(() => {})
      await refreshPermission()
    })
  } else {
    permButton.textContent = '授权此域名'
    permButton.addEventListener('click', async () => {
      permButton.disabled = true
      try {
        await chrome.permissions.request({ origins: [origin + '/*'] })
      } catch {
      }
      chrome.runtime.sendMessage({ type: 'dogear_permission_changed' }).catch(() => {})
      await refreshPermission()
    })
  }
  permEl.appendChild(permButton)
}

async function refreshPermission() {
  const origin = await getCurrentOrigin()
  let granted = false
  if (origin) {
    try {
      const all = await chrome.permissions.getAll()
      const patterns = Array.isArray(all?.origins) ? all.origins : []
      granted = isOriginGranted(patterns, origin)
    } catch {
    }
  }
  renderPermission(origin, granted)
}

async function refresh() {
  chrome.runtime.sendMessage({ type: 'dogear_get_state' }).then(render).catch(() => {})
  await refreshPermission()
}

refresh()
setInterval(refresh, 3000)
