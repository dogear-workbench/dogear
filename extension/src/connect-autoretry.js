const RETRY_ALARM = 'dogear-reconnect'
const RETRY_DELAY_MIN = 0.5
const MANUAL_KEY = 'manualDisconnected'
const CONNECT_POLL_MS = 200
const CONNECT_TIMEOUT_MS = 10000

let connectFn = null
let isPortAliveFn = null

export function initAutoConnect({ connect, isPortAlive }) {
  connectFn = connect
  isPortAliveFn = isPortAlive
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === RETRY_ALARM) ensureConnected()
  })
  ensureConnected()
}

export async function ensureConnected() {
  if (!connectFn || isPortAliveFn()) return
  if (await isManualDisconnected()) return
  await connectFn()
}

export function scheduleRetry() {
  chrome.alarms.create(RETRY_ALARM, { delayInMinutes: RETRY_DELAY_MIN })
}

export async function markManualDisconnect(v) {
  try {
    await chrome.storage.session.set({ [MANUAL_KEY]: v })
  } catch {
  }
}

export async function isManualDisconnected() {
  try {
    const data = await chrome.storage.session.get(MANUAL_KEY)
    return data[MANUAL_KEY] === true
  } catch {
    return false
  }
}

export function waitForConnected(isConnected, timeoutMs = CONNECT_TIMEOUT_MS) {
  return new Promise((resolve) => {
    const started = Date.now()
    const timer = setInterval(() => {
      if (isConnected() || Date.now() - started >= timeoutMs) {
        clearInterval(timer)
        resolve(isConnected())
      }
    }, CONNECT_POLL_MS)
  })
}
