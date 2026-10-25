import { getAgentWindowId, resolveAgentWindowId } from './agent-window.js'

const DETECT_POLL_TIMES = 2
const DETECT_POLL_INTERVAL_MS = 750

// 快照与检测必须同口径且不过滤空白起始页：过滤会让 before/after 不对称——新开 tab 初始为空白页被漏检，或窗口既有空白页每次被误判为新 tab
async function collectOperableTabs(focusedTabId) {
  const agentWindowId = await getAgentWindowId()
  const tabs = await chrome.tabs.query({})
  return tabs.filter(
    (t) => t.id != null && (t.windowId === agentWindowId || t.openerTabId === focusedTabId)
  )
}

export async function snapshotOperableTabIds(focusedTabId) {
  try {
    const tabs = await collectOperableTabs(focusedTabId)
    return new Set(tabs.map((t) => t.id))
  } catch {
    return null
  }
}

export async function detectNewOperableTab(beforeIds, options) {
  if (!beforeIds) return null
  const focusedTabId = options?.focusedTabId
  const pollTimes = options?.pollTimes ?? DETECT_POLL_TIMES
  const intervalMs = options?.intervalMs ?? DETECT_POLL_INTERVAL_MS
  for (let i = 0; i < pollTimes; i++) {
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
    try {
      const tabs = await collectOperableTabs(focusedTabId)
      const fresh = tabs.filter((t) => !beforeIds.has(t.id))
      if (fresh.length) {
        fresh.sort((a, b) => (b.id ?? 0) - (a.id ?? 0))
        const newTab = fresh[0]
        try {
          const agentWindowId = await resolveAgentWindowId()
          if (newTab.windowId !== agentWindowId) {
            await chrome.tabs.move(newTab.id, { windowId: agentWindowId, index: -1 })
          }
        } catch {
        }
        return newTab
      }
    } catch {
      return null
    }
  }
  return null
}
