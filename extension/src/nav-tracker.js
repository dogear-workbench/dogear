const NAVIGATE_TIMEOUT_MS = 15000
const URL_TRACK_DEBOUNCE_MS = 800

const generations = new Map()
const generationUrls = new Map()
let trackTimer = null

export function resetGeneration(tabId, url) {
  generations.set(tabId, 0)
  generationUrls.set(tabId, url ?? '')
}

export function currentGeneration(tabId) {
  return generations.get(tabId) ?? 0
}

export function bumpGeneration(tabId, url) {
  if (url && generationUrls.get(tabId) === url) return generations.get(tabId) ?? 0
  const next = (generations.get(tabId) ?? 0) + 1
  generations.set(tabId, next)
  if (url) generationUrls.set(tabId, url)
  return next
}

export function parseRefGeneration(ref) {
  const match = /^e\d+(?:@(\d+))?$/.exec(String(ref))
  if (!match) return null
  return match[1] ? Number(match[1]) : 0
}

export function scheduleTrackedSnapshot(sendFn) {
  if (trackTimer) clearTimeout(trackTimer)
  trackTimer = setTimeout(() => {
    trackTimer = null
    sendFn()
  }, URL_TRACK_DEBOUNCE_MS)
}

export function waitForTabComplete(tabId, timeoutMs) {
  let finished = false
  let listener
  let timer
  const finish = () => {
    if (finished) return
    finished = true
    clearTimeout(timer)
    chrome.tabs.onUpdated.removeListener(listener)
  }
  const promise = new Promise((resolve) => {
    listener = (updatedTabId, changeInfo) => {
      if (updatedTabId === tabId && changeInfo?.status === 'complete') {
        finish()
        resolve()
      }
    }
    chrome.tabs.onUpdated.addListener(listener)
    timer = setTimeout(() => {
      finish()
      resolve()
    }, timeoutMs)
  })
  return { promise, abort: finish }
}

export async function navigateTab(tabId, targetUrl) {
  try {
    await chrome.tabs.get(tabId)
  } catch {
    return { errorCode: 'tab_closed', error: '标签页已关闭' }
  }
  const wait = waitForTabComplete(tabId, NAVIGATE_TIMEOUT_MS)
  try {
    await chrome.tabs.update(tabId, { url: targetUrl })
  } catch (err) {
    wait.abort()
    return { errorCode: 'navigation_blocked', error: `导航未能执行：${String(err?.message ?? err)}` }
  }
  await wait.promise
  let tab
  try {
    tab = await chrome.tabs.get(tabId)
  } catch {
    return { errorCode: 'tab_closed', error: '标签页已关闭' }
  }
  return { url: tab.url ?? targetUrl }
}
