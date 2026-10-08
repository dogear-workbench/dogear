import { resolvePageState } from './page-state.js'

const STORAGE_KEY = 'interventionWatches'
// onUpdated complete 后等 SPA 渲染稳定再判定，避免拿到跳转中间态
const DETECT_DELAY_MS = 1000
// 登录墙等待上限 5min；超期自清兜底，防 tab 永不关闭也不恢复 ready 时条目滞留
const WATCH_MAX_AGE_MS = 10 * 60_000

// SW 挂起重启后模块状态清零，watched 列表存 storage.session 以便恢复（监听器顶层注册会随 SW 唤醒重挂）
const watched = new Map()
const pendingDetects = new Map()
let restored = false
let onResolved = null

function persist() {
  chrome.storage.session.set({ [STORAGE_KEY]: [...watched.keys()] }).catch(() => {})
}

async function restoreWatched() {
  if (restored) return
  restored = true
  try {
    const data = await chrome.storage.session.get(STORAGE_KEY)
    const ids = data?.[STORAGE_KEY]
    if (!Array.isArray(ids)) return
    for (const id of ids) {
      if (typeof id === 'number' && !watched.has(id)) armWatch(id)
    }
  } catch {
  }
}

function armWatch(tabId) {
  const prev = watched.get(tabId)
  if (prev !== undefined) clearTimeout(prev)
  watched.set(tabId, setTimeout(() => dropExpired(tabId), WATCH_MAX_AGE_MS))
}

function dropExpired(tabId) {
  if (!watched.has(tabId)) return
  watched.delete(tabId)
  persist()
}

export function clearWatch(tabId) {
  const timer = watched.get(tabId)
  if (timer === undefined) return
  clearTimeout(timer)
  watched.delete(tabId)
  persist()
}

function scheduleDetect(tabId) {
  const prev = pendingDetects.get(tabId)
  if (prev !== undefined) clearTimeout(prev)
  pendingDetects.set(tabId, setTimeout(() => {
    pendingDetects.delete(tabId)
    void detectTabState(tabId)
  }, DETECT_DELAY_MS))
}

async function detectTabState(tabId) {
  if (!watched.has(tabId)) return
  let tab
  try {
    tab = await chrome.tabs.get(tabId)
  } catch {
    clearWatch(tabId)
    return
  }
  // 浏览器内部页判不出 pageState，等下一次导航
  if (!/^https?:/.test(tab.url ?? '')) return
  if (resolvePageState(tab.url ?? '', tab.title ?? '', '') !== 'ready') return
  clearWatch(tabId)
  onResolved?.(tabId)
}

export function watchInterventionTab(tabId) {
  armWatch(tabId)
  persist()
  scheduleDetect(tabId)
}

export function initInterventionWatch(callback) {
  onResolved = callback
  void restoreWatched()
}

chrome.tabs.onRemoved.addListener((tabId) => {
  clearWatch(tabId)
})

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo?.status !== 'complete') return
  restoreWatched().then(() => {
    if (watched.has(tabId)) scheduleDetect(tabId)
  })
})
