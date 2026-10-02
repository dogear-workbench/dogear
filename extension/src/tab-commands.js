import { resolvePageState } from './page-state.js'
import { waitForTabComplete } from './nav-tracker.js'

const DOGEAR_GROUP_TITLE = 'Dogear'
const GROUP_COLOR = 'blue'
const OPEN_TAB_TIMEOUT_MS = 15000

function patternToOrigin(pattern) {
  return pattern.endsWith('/*') ? pattern.slice(0, -2) : pattern
}

async function getAuthorizedOrigins() {
  try {
    const all = await chrome.permissions.getAll()
    if (all) {
      return (Array.isArray(all.origins) ? all.origins : [])
        .filter((p) => typeof p === 'string' && (p === '<all_urls>' || p.endsWith('/*')))
        .map(patternToOrigin)
    }
  } catch {
  }
  try {
    const stored = await chrome.storage.local.get('authorizedOrigins')
    return Array.isArray(stored?.authorizedOrigins)
      ? stored.authorizedOrigins.filter((o) => typeof o === 'string')
      : []
  } catch {
    return []
  }
}

function isOriginAuthorized(url, origins) {
  if (origins.includes('<all_urls>')) return true
  try {
    return origins.includes(new URL(url).origin)
  } catch {
    return false
  }
}

async function ensureDogearGroup(tabId) {
  try {
    await chrome.tabGroups.group({
      tabIds: tabId,
      createProperties: { title: DOGEAR_GROUP_TITLE, color: GROUP_COLOR }
    })
  } catch {
  }
}

export async function getDogearTabs() {
  const groups = await chrome.tabGroups.query({ title: DOGEAR_GROUP_TITLE })
  if (!groups.length) return []
  return chrome.tabs.query({ groupId: { in: groups.map((g) => g.id) } })
}

async function isInDogearGroup(tab) {
  if (tab.groupId == null) return false
  const groups = await chrome.tabGroups.query({ title: DOGEAR_GROUP_TITLE })
  return groups.some((g) => g.id === tab.groupId)
}

async function pickFallbackFocus(closedTabId) {
  const candidates = (await getDogearTabs()).filter((t) => t.id != null && t.id !== closedTabId)
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
  if (!isOriginAuthorized(targetUrl, await getAuthorizedOrigins())) {
    ctx.fail(msg, 'navigation_blocked', '目标域名未授权，请先在 Dogear 扩展弹窗中授权该域名')
    return
  }
  let created
  try {
    created = await chrome.tabs.create({ url: targetUrl, active: params.background !== true })
  } catch (err) {
    ctx.fail(msg, 'navigation_blocked', `标签页未能创建：${String(err?.message ?? err)}`)
    return
  }
  if (created?.id == null) {
    ctx.fail(msg, 'navigation_blocked', '标签页创建失败')
    return
  }
  await ensureDogearGroup(created.id)
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
  if (!(await isInDogearGroup(tab))) {
    ctx.fail(msg, 'permission_denied', '仅能关闭 Dogear 分组内的标签页')
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
  const tabs = await getDogearTabs()
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

export async function handleTabCommand(msg, ctx) {
  if (msg.kind === 'open_tab') {
    await openTab(msg, ctx)
    return true
  }
  if (msg.kind === 'close_tab') {
    await closeTab(msg, ctx)
    return true
  }
  if (msg.kind === 'list_tabs') {
    await listTabs(msg, ctx)
    return true
  }
  return false
}
