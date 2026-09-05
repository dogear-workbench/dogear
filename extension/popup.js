const button = document.getElementById('connect')
const statusEl = document.getElementById('status')

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
}

button.addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'dogear_connect' }).catch(() => {})
})

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === 'dogear_state') render(message)
})

function refresh() {
  chrome.runtime.sendMessage({ type: 'dogear_get_state' }).then(render).catch(() => {})
}

refresh()
setInterval(refresh, 3000)
