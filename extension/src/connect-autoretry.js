const RETRY_ALARM = 'dogear-reconnect'
const RETRY_PERIOD_MIN = 0.5
const MANUAL_KEY = 'manualDisconnected'

let connectFn = null
let isPortAliveFn = null
let connecting = false

export function initAutoConnect({ connect, isPortAlive }) {
  connectFn = connect
  isPortAliveFn = isPortAlive
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === RETRY_ALARM) ensureConnected()
  })
  // 常驻周期 alarm：SW 被休眠杀死时 NM 端口静默断开，onHostDisconnect 无从执行，
  // 一次性重试会断链；周期触发既兜底重连，也让 SW 无法长眠（NM 端口不被休眠回收，等效保活）
  chrome.alarms.create(RETRY_ALARM, { periodInMinutes: RETRY_PERIOD_MIN })
  ensureConnected()
}

export async function ensureConnected() {
  if (!connectFn || connecting || isPortAliveFn()) return
  connecting = true
  try {
    if (await isManualDisconnected()) return
    await connectFn()
  } finally {
    connecting = false
  }
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
