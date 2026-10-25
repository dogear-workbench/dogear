import { resolvePageState } from './page-state.js'
import { waitForTabComplete } from './nav-tracker.js'
import { watchInterventionTab } from './intervention-watch.js'
import { resolveAgentWindowId, getAgentWindowId } from './agent-window.js'

const OPEN_TAB_TIMEOUT_MS = 15000
const BLANK_TAB_URL_RE = /^(chrome|edge):\/\/new|^about:blank/

export async function listAgentWindowTabs() {
  const windowId = await getAgentWindowId()
  if (windowId == null) return []
  try {
    const tabs = await chrome.tabs.query({ windowId })
    return tabs.filter((t) => !BLANK_TAB_URL_RE.test(t.url ?? ''))
  } catch {
    return []
  }
}

export async function pickFallbackFocus(closedTabId) {
  const candidates = (await listAgentWindowTabs()).filter((t) => t.id != null && t.id !== closedTabId)
  if (!candidates.length) return null
  candidates.sort((a, b) => (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0))
  return candidates[0]
}

async function openTab(msg, ctx) {
  const params = msg.params || {}
  const targetUrl = params.targetUrl
  if (typeof targetUrl !== 'string' || !targetUrl) {
    ctx.fail(msg, 'navigation_blocked', 'open_tab 缺少有效的目标地址')
    return
  }
  let parsed
  try {
    parsed = new URL(targetUrl)
  } catch {
    ctx.fail(msg, 'navigation_blocked', '目标地址不是合法 URL')
    return
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    ctx.fail(msg, 'navigation_blocked', '仅支持 http/https 目标地址')
    return
  }
  let windowId
  try {
    windowId = await resolveAgentWindowId()
  } catch (err) {
    ctx.fail(msg, 'navigation_blocked', `agent 窗口创建失败：${String(err?.message ?? err)}`)
    return
  }
  let created
  try {
    created = await chrome.tabs.create({ url: targetUrl, windowId, active: params.background !== true })
  } catch (err) {
    ctx.fail(msg, 'navigation_blocked', `标签页未能创建：${String(err?.message ?? err)}`)
    return
  }
  if (created?.id == null) {
    ctx.fail(msg, 'navigation_blocked', '标签页创建失败')
    return
  }
  await waitForTabComplete(created.id, OPEN_TAB_TIMEOUT_MS).promise
  let tab
  try {
    tab = await chrome.tabs.get(created.id)
  } catch {
    ctx.fail(msg, 'tab_closed', '新开的标签页已被关闭')
    return
  }
  ctx.setFocusedTab(tab)
  ctx.pushSnapshot()
  ctx.postResult(msg, {
    ok: true,
    data: {
      tabId: tab.id,
      url: tab.url ?? targetUrl,
      title: tab.title ?? '',
      pageState: resolvePageState(tab.url ?? targetUrl, tab.title ?? '', ''),
      focused: true
    }
  })
}

async function closeTab(msg, ctx) {
  const focusedTabId = ctx.getFocusedTabId()
  const requested = (msg.params || {}).targetTabId
  const targetTabId = typeof requested === 'number' ? requested : focusedTabId
  if (targetTabId == null) {
    ctx.fail(msg, 'stale_tab', '当前没有受控标签页')
    return
  }
  let tab
  try {
    tab = await chrome.tabs.get(targetTabId)
  } catch {
    ctx.fail(msg, 'tab_closed', '目标标签页不存在或已关闭')
    return
  }
  const agentWindowId = await getAgentWindowId()
  if (tab.windowId !== agentWindowId) {
    ctx.fail(msg, 'permission_denied', '仅能关闭 agent 窗口内的标签页（tabId 用 list_tabs 查询）')
    return
  }
  try {
    await chrome.tabs.remove(targetTabId)
  } catch {
    ctx.fail(msg, 'tab_closed', '标签页关闭失败（可能已被关闭）')
    return
  }
  let nextFocusedTabId = null
  if (targetTabId === focusedTabId) {
    const next = await pickFallbackFocus(targetTabId)
    if (next) {
      ctx.setFocusedTab(next)
      nextFocusedTabId = next.id
      ctx.pushSnapshot()
    } else {
      ctx.clearFocusedTab()
    }
  }
  ctx.postResult(msg, { ok: true, data: { closedTabId: targetTabId, focusedTabId: nextFocusedTabId } })
}

async function listTabs(msg, ctx) {
  const focusedTabId = ctx.getFocusedTabId()
  const tabs = await listAgentWindowTabs()
  const items = tabs
    .filter((t) => t.id != null)
    .map((t) => ({
      tabId: t.id,
      url: t.url ?? '',
      title: t.title ?? '',
      focused: t.id === focusedTabId
    }))
  ctx.postResult(msg, { ok: true, data: { tabs: items } })
}

async function closeAgentWindow(msg, ctx) {
  const windowId = await getAgentWindowId()
  if (windowId == null) {
    ctx.postResult(msg, { ok: true, data: { closedTabIds: [] } })
    return
  }
  let closedTabIds = []
  try {
    const tabs = await chrome.tabs.query({ windowId })
    closedTabIds = tabs.map((t) => t.id).filter((id) => id != null)
    await chrome.windows.remove(windowId)
  } catch {
  }
  const focusedTabId = ctx.getFocusedTabId()
  if (focusedTabId != null && closedTabIds.includes(focusedTabId)) ctx.clearFocusedTab()
  ctx.postResult(msg, { ok: true, data: { closedTabIds } })
}

async function focusTab(msg, ctx) {
  const requested = (msg.params || {}).tabId
  if (typeof requested !== 'number' || !Number.isFinite(requested)) {
    ctx.fail(msg, 'stale_tab', 'focus_tab 缺少有效的 tabId')
    return
  }
  let tab
  try {
    tab = await chrome.tabs.get(requested)
  } catch {
    ctx.fail(msg, 'tab_closed', '目标标签页不存在或已关闭')
    return
  }
  const agentWindowId = await getAgentWindowId()
  if (tab.windowId !== agentWindowId) {
    ctx.fail(msg, 'permission_denied', '仅能聚焦 agent 窗口内的标签页（tabId 用 list_tabs 查询）')
    return
  }
  try {
    await chrome.tabs.update(requested, { active: true })
    await chrome.windows.update(tab.windowId, { focused: true })
  } catch (err) {
    ctx.fail(msg, 'navigation_blocked', `标签页聚焦失败：${String(err?.message ?? err)}`)
    return
  }
  let fresh
  try {
    fresh = await chrome.tabs.get(requested)
  } catch {
    ctx.fail(msg, 'tab_closed', '目标标签页已被关闭')
    return
  }
  ctx.setFocusedTab(fresh)
  ctx.pushSnapshot()
  ctx.postResult(msg, {
    ok: true,
    data: {
      tabId: fresh.id,
      url: fresh.url ?? '',
      title: fresh.title ?? '',
      focused: true
    }
  })
}

async function watchIntervention(msg, ctx) {
  const requested = (msg.params || {}).tabId
  if (typeof requested !== 'number' || !Number.isFinite(requested)) {
    ctx.fail(msg, 'stale_tab', 'watch_intervention 缺少有效的 tabId')
    return
  }
  let tab
  try {
    tab = await chrome.tabs.get(requested)
  } catch {
    ctx.fail(msg, 'tab_closed', '目标标签页不存在或已关闭')
    return
  }
  const agentWindowId = await getAgentWindowId()
  if (tab.windowId !== agentWindowId && requested !== ctx.getFocusedTabId()) {
    ctx.fail(msg, 'permission_denied', '仅能监听 agent 窗口内或当前焦点的标签页（tabId 用 list_tabs 查询）')
    return
  }
  watchInterventionTab(requested)
  ctx.postResult(msg, { ok: true, data: { watching: requested } })
}

export async function handleTabCommand(msg, ctx) {
  if (msg.kind === 'open_tab') {
    await openTab(msg, ctx)
    return true
  }
  if (msg.kind === 'close_tab') {
    await closeTab(msg, ctx)
    return true
  }
  if (msg.kind === 'close_agent_window') {
    await closeAgentWindow(msg, ctx)
    return true
  }
  if (msg.kind === 'list_tabs') {
    await listTabs(msg, ctx)
    return true
  }
  if (msg.kind === 'focus_tab') {
    await focusTab(msg, ctx)
    return true
  }
  if (msg.kind === 'watch_intervention') {
    await watchIntervention(msg, ctx)
    return true
  }
  return false
}
