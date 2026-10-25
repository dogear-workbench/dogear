import { extractTabSnapshot, extractArticleHtml } from './content-extract.js'
import { handleTabCommand, listAgentWindowTabs, pickFallbackFocus } from './tab-commands.js'
import { getAgentWindowId } from './agent-window.js'
import { clickFn, fillFn, scrollFn, readTextFn, readStateFn } from './dom-actions.js'
import { waitFn } from './wait-actions.js'
import { snapshotOperableTabIds, detectNewOperableTab } from './click-watch.js'
import { observeFn } from './observe-actions.js'
import { findFn } from './find-actions.js'
import { resolvePageState } from './page-state.js'
import { initInterventionWatch } from './intervention-watch.js'
import {
  bumpGeneration,
  currentGeneration,
  navigateTab,
  parseRefGeneration,
  resetGeneration,
  scheduleTrackedSnapshot
} from './nav-tracker.js'
import {
  initAutoConnect,
  ensureConnected,
  markManualDisconnect
} from './connect-autoretry.js'

const NM_HOST_NAME = 'com.dogear.nmhost'
// gateway 拒绝 tabId 为 null 的 hello；-1 是其 NO_FOCUS 空闲哨兵
const NO_FOCUS_TAB_ID = -1

let port = null
let state = {
  status: 'idle',
  tabId: null,
  title: '',
  url: '',
  error: '',
  appVersion: ''
}

function broadcast() {
  chrome.runtime.sendMessage({ type: 'dogear_state', ...state }).catch(() => {})
}

function setStatus(patch) {
  state = { ...state, ...patch }
  broadcast()
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  return tab ?? null
}

const BADGE_RESET_MS = 3000
let badgeTimer = null

function flashHandoffError() {
  chrome.action.setBadgeText({ text: '!' }).catch(() => {})
  clearTimeout(badgeTimer)
  badgeTimer = setTimeout(() => {
    chrome.action.setBadgeText({ text: '' }).catch(() => {})
  }, BADGE_RESET_MS)
}

async function sendPageHandoff(tab, selectionText) {
  if (!port) {
    flashHandoffError()
    return { ok: false, error: '等待连接' }
  }
  if (!tab || tab.id == null || !tab.url || !/^https?:/.test(tab.url)) {
    return { ok: false, error: '当前页面不支持移交' }
  }
  TAB_COMMAND_CTX.setFocusedTab(tab)
  sendTabSnapshot()
  const payload = {
    type: 'page_handoff',
    tabId: tab.id,
    url: tab.url,
    title: tab.title ?? '',
    ...(selectionText ? { selectionText } : {})
  }
  try {
    port.postMessage(payload)
  } catch {
    flashHandoffError()
    return { ok: false, error: '发送失败，请稍后重试' }
  }
  return { ok: true }
}

chrome.storage.local.remove('authorizedOrigins').catch(() => {})

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: 'dogear-handoff-page', contexts: ['page'], title: '发送到 Dogear' })
    chrome.contextMenus.create({ id: 'dogear-handoff-selection', contexts: ['selection'], title: '发送选中内容到 Dogear' })
  })
})

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== 'dogear-handoff-page' && info.menuItemId !== 'dogear-handoff-selection') return
  sendPageHandoff(tab, info.selectionText ?? '').catch(() => {})
})

function disconnectPort() {
  if (!port) return
  const closing = port
  port = null
  try {
    closing.disconnect()
  } catch {
  }
}

async function sendTabSnapshot() {
  if (!port || state.tabId == null) return
  const tabId = state.tabId
  let snapshot = { title: state.title, url: state.url, textPreview: '' }
  let extractError = ''
  try {
    const [injection] = await chrome.scripting.executeScript({
      target: { tabId },
      func: extractTabSnapshot
    })
    if (injection?.result) snapshot = injection.result
  } catch (err) {
    extractError = String(err?.message ?? err)
  }
  port.postMessage({
    type: 'tab_snapshot',
    tabId,
    title: snapshot.title ?? '',
    url: snapshot.url ?? '',
    textPreview: snapshot.textPreview ?? '',
    generation: currentGeneration(tabId),
    ...(extractError ? { extractError } : {})
  })
}

async function pushWindowTabSnapshots() {
  if (!port || state.tabId == null) return
  const tabs = await listAgentWindowTabs()
  for (const tab of tabs) {
    if (tab.id == null || tab.id === state.tabId) continue
    port.postMessage({
      type: 'tab_snapshot',
      tabId: tab.id,
      title: tab.title ?? '',
      url: tab.url ?? '',
      textPreview: '',
      generation: currentGeneration(tab.id)
    })
  }
}

const COMMAND_FUNCS = {
  observe: observeFn,
  find: findFn,
  click: clickFn,
  fill: fillFn,
  read_text: readTextFn,
  read_state: readStateFn,
  scroll: scrollFn,
  wait_for: waitFn,
  readArticle: extractArticleHtml
}

// captureVisibleTab 只能截当前激活 tab；切走再切回后需留出合成器重绘时间，否则截到旧帧
const CAPTURE_SWITCH_SETTLE_MS = 150

async function captureTabView(tabId) {
  let tab
  try {
    tab = await chrome.tabs.get(tabId)
  } catch {
    return { errorCode: 'tab_closed', error: '目标标签页不存在或已关闭' }
  }
  if (!/^https?:/.test(tab.url ?? '')) {
    return { errorCode: 'permission_denied', error: `无法截取浏览器内部页（${tab.url ?? '未知地址'}），仅支持 http/https 页面` }
  }
  const agentWindowId = await getAgentWindowId()
  if (tab.windowId !== agentWindowId && tabId !== state.tabId) {
    return { errorCode: 'permission_denied', error: '仅能截取 agent 窗口内或当前焦点的标签页（tabId 用 list_tabs 查询）' }
  }
  const [prevActive] = await chrome.tabs.query({ active: true, windowId: tab.windowId })
  const windowBefore = await chrome.windows.get(tab.windowId)
  const wasActive = prevActive?.id === tabId
  const wasFocused = windowBefore.focused === true
  let prevFocusedWindowId = null
  if (!wasFocused) {
    const lastFocused = await chrome.windows.getLastFocused()
    prevFocusedWindowId = typeof lastFocused?.id === 'number' ? lastFocused.id : null
    await chrome.windows.update(tab.windowId, { focused: true })
  }
  try {
    if (!wasActive) {
      await chrome.tabs.update(tabId, { active: true })
      await new Promise((resolve) => setTimeout(resolve, CAPTURE_SWITCH_SETTLE_MS))
    }
    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' })
    return { dataUrl, url: tab.url ?? '', title: tab.title ?? '' }
  } catch (err) {
    return { errorCode: 'permission_denied', error: `截图失败：${String(err?.message ?? err)}` }
  } finally {
    try {
      if (!wasActive && prevActive?.id != null) await chrome.tabs.update(prevActive.id, { active: true })
      if (!wasFocused && prevFocusedWindowId != null) await chrome.windows.update(prevFocusedWindowId, { focused: true })
    } catch {
    }
  }
}

async function handleCapture(msg) {
  const requested = (msg.params || {}).tabId
  const targetTabId = typeof requested === 'number' ? requested : msg.tabId
  if (typeof targetTabId !== 'number' || targetTabId === NO_FOCUS_TAB_ID) {
    fail(msg, 'stale_tab', '当前没有受控标签页，请先连接或 open_tab')
    return
  }
  const result = await captureTabView(targetTabId)
  if (result.errorCode) {
    fail(msg, result.errorCode, result.error)
    return
  }
  postResult(msg, { ok: true, data: result })
}

function postResult(msg, payload) {
  if (!port) return
  try {
    port.postMessage({ type: 'command_result', requestId: msg.requestId, ...payload })
  } catch {
  }
}

function fail(msg, errorCode, error, data) {
  postResult(msg, { ok: false, errorCode, error, ...(data !== undefined ? { data } : {}) })
}

const INJECT_TIMEOUT_MS = 8000
const INJECT_TIMEOUT_MSG = 'dogear_inject_timeout'

// 点击触发导航会销毁注入上下文，executeScript 的 Promise 永不 settle，必须外层加超时竞赛；wait_for 轮询长于默认超时，由调用方传入放宽后的上限
function executeScriptWithTimeout(tabId, func, args, world, timeoutMs) {
  const limit = typeof timeoutMs === 'number' && timeoutMs > 0 ? timeoutMs : INJECT_TIMEOUT_MS
  let timer
  return Promise.race([
    chrome.scripting.executeScript({ target: { tabId }, func, args, ...(world ? { world } : {}) }),
    new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new Error(INJECT_TIMEOUT_MSG)), limit)
    })
  ]).finally(() => clearTimeout(timer))
}

async function resolveLostClickResult(msg) {
  let lastUrl = ''
  for (let attempt = 0; attempt < 4; attempt++) {
    let tabAfter
    try {
      tabAfter = await chrome.tabs.get(msg.tabId)
    } catch {
      return { ok: false, errorCode: 'tab_closed', error: '标签页已关闭' }
    }
    lastUrl = tabAfter.url ?? ''
    if (msg.url && tabAfter.url && tabAfter.url !== msg.url) {
      return { ok: true, data: { clicked: true, navigated: true, urlAfter: tabAfter.url, verification: 'lost' } }
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  return {
    ok: false,
    errorCode: 'navigated_away',
    error: '点击已发出但页面地址未变化，无法确认点击是否生效，请重新观察后再操作',
    ...(lastUrl ? { currentUrl: lastUrl } : {})
  }
}

const TAB_COMMAND_CTX = {
  getFocusedTabId: () => state.tabId,
  setFocusedTab: (tab) => {
    setStatus({ tabId: tab.id, title: tab.title ?? '', url: tab.url ?? '' })
    resetGeneration(tab.id, tab.url ?? '')
  },
  clearFocusedTab: () => setStatus({ tabId: null, title: '', url: '' }),
  pushSnapshot: sendTabSnapshot,
  fail,
  postResult
}

async function recoverFocusAndPush() {
  const focused = await pickFallbackFocus(null)
  if (!focused) return
  TAB_COMMAND_CTX.setFocusedTab(focused)
  sendTabSnapshot()
  pushWindowTabSnapshots()
}

chrome.tabs.onRemoved.addListener((closedTabId) => {
  if (closedTabId !== state.tabId) return
  pickFallbackFocus(closedTabId)
    .then((fallback) => {
      if (fallback) TAB_COMMAND_CTX.setFocusedTab(fallback)
      else TAB_COMMAND_CTX.clearFocusedTab()
      sendTabSnapshot()
      pushWindowTabSnapshots()
    })
    .catch(() => {})
})

async function handleCommand(msg) {
  if (!port) return
  try {
    if (await handleTabCommand(msg, TAB_COMMAND_CTX)) return
  } catch (err) {
    fail(msg, 'timeout', `tab 命令执行异常：${String(err?.message ?? err)}`)
    return
  }
  if (msg.kind === 'capture') {
    await handleCapture(msg)
    return
  }
  if (state.tabId == null || msg.tabId !== state.tabId) {
    fail(msg, 'stale_tab', '命令指向的标签页与当前受控标签页不一致')
    return
  }
  if (msg.kind === 'navigate') {
    const targetUrl = (msg.params || {}).targetUrl
    if (typeof targetUrl !== 'string' || !targetUrl) {
      fail(msg, 'navigation_blocked', 'navigate 缺少有效的目标地址')
      return
    }
    const navigated = await navigateTab(msg.tabId, targetUrl)
    if (navigated.errorCode) {
      fail(msg, navigated.errorCode, navigated.error)
      return
    }
    bumpGeneration(msg.tabId, navigated.url)
    sendTabSnapshot()
    let title = ''
    try {
      const tabAfter = await chrome.tabs.get(msg.tabId)
      title = tabAfter?.title ?? ''
    } catch {
    }
    postResult(msg, {
      ok: true,
      data: { url: navigated.url, title, pageState: resolvePageState(navigated.url, title, '') }
    })
    return
  }
  const func = COMMAND_FUNCS[msg.kind]
  if (!func) {
    fail(msg, 'stale_protocol', '未知命令类型，请在浏览器扩展管理页重载 Dogear 扩展')
    return
  }
  let tab
  try {
    tab = await chrome.tabs.get(msg.tabId)
  } catch {
    fail(msg, 'tab_closed', '标签页已关闭')
    return
  }
  const readSafe =
    msg.kind === 'observe' ||
    msg.kind === 'find' ||
    msg.kind === 'read_text' ||
    msg.kind === 'read_state' ||
    msg.kind === 'wait_for' ||
    msg.kind === 'readArticle'
  if (!readSafe && msg.url && tab.url && !tab.url.startsWith(msg.url)) {
    bumpGeneration(msg.tabId, tab.url)
    sendTabSnapshot()
    postResult(msg, {
      ok: false,
      errorCode: 'navigated_away',
      error: `页面已离开命令发起时的地址（当前: ${tab.url}），已回推新页面快照，请重新观察后再操作`,
      currentUrl: tab.url
    })
    return
  }
  const p = msg.params || {}
  if (
    (msg.kind === 'click' ||
      msg.kind === 'fill' ||
      msg.kind === 'scroll' ||
      msg.kind === 'read_text' ||
      msg.kind === 'wait_for') &&
    p.ref
  ) {
    const refGen = parseRefGeneration(p.ref)
    if (refGen !== null && refGen !== currentGeneration(msg.tabId)) {
      fail(msg, 'ref_expired', `ref "${p.ref}" 已过期（页面已导航或更新），请重新观察后再操作`)
      return
    }
  }
  const args = (
    msg.kind === 'observe'
      ? [p.region, p.text_filter, currentGeneration(msg.tabId)]
      : msg.kind === 'find'
        ? [p.role, p.name, p.exact, p.max_results, currentGeneration(msg.tabId)]
        : msg.kind === 'click'
          ? [p.ref, p.confirmed]
          : msg.kind === 'fill'
            ? [p.ref, p.value]
            : msg.kind === 'read_state'
              ? [p.path]
              : msg.kind === 'scroll'
                ? [p.ref, p.delta_y, p.position]
                : msg.kind === 'wait_for'
                  ? [p.selector, p.ref, p.condition, p.text, p.timeoutMs]
                  : msg.kind === 'readArticle'
                    ? [p.selector]
                    : [p.ref]
  ).map((v) => (v === undefined ? null : v))
  const injectWorld = msg.kind === 'read_state' ? 'MAIN' : undefined
  const waitTimeoutMs = msg.kind === 'wait_for' && Number.isFinite(p.timeoutMs) ? Math.min(Math.max(p.timeoutMs, 1000), 30000) : null
  const injectTimeoutMs = waitTimeoutMs !== null ? waitTimeoutMs + 5000 : INJECT_TIMEOUT_MS
  const clickBeforeIds = msg.kind === 'click' ? await snapshotOperableTabIds(state.tabId) : null
  let result = null
  let injectTimedOut = false
  try {
    const [injection] = await executeScriptWithTimeout(msg.tabId, func, args, injectWorld, injectTimeoutMs)
    result = injection?.result ?? null
  } catch (err) {
    const text = String(err?.message ?? err)
    if (text === INJECT_TIMEOUT_MSG) {
      injectTimedOut = true
    } else {
      postResult(
        msg,
        msg.kind === 'click'
          ? await resolveLostClickResult(msg)
          : { ok: false, errorCode: 'navigated_away', error: '页面在命令执行期间发生变化，无法完成命令，请重新观察后再操作' },
      )
      return
    }
  }
  if (result == null || injectTimedOut) {
    postResult(
      msg,
      msg.kind === 'click'
        ? await resolveLostClickResult(msg)
        : { ok: false, errorCode: 'navigated_away', error: '页面在命令执行期间发生变化，无法完成命令，请重新观察后再操作' },
    )
    return
  }
  if (result && result.errorCode) {
    fail(
      msg,
      result.errorCode,
      result.error || '命令执行失败',
      result.submitTarget !== undefined || result.reason !== undefined
        ? {
            ...(result.submitTarget !== undefined ? { submitTarget: result.submitTarget } : {}),
            ...(result.reason !== undefined ? { reason: result.reason } : {}),
          }
        : undefined
    )
    return
  }
  if (msg.kind === 'observe' || msg.kind === 'find') {
    result.pageState = resolvePageState(result.url || tab.url || '', result.title || '', result.textSample || '')
    delete result.textSample
  } else if (msg.kind === 'scroll') {
    result.pageState = resolvePageState(tab.url || '', tab.title || '', '')
  } else if (msg.kind === 'wait_for') {
    result.pageState = resolvePageState(result.url || tab.url || '', tab.title || '', '')
  } else if (msg.kind === 'read_text' || msg.kind === 'readArticle') {
    result.pageState = resolvePageState(result.url || tab.url || '', result.title || tab.title || '', '')
  }
  if (msg.kind === 'click') {
    const newTab = await detectNewOperableTab(clickBeforeIds, { focusedTabId: state.tabId })
    if (newTab && newTab.id != null) {
      try {
        await chrome.tabs.update(newTab.id, { active: true })
      } catch {
      }
      TAB_COMMAND_CTX.setFocusedTab(newTab)
      sendTabSnapshot()
      result.openedTab = { tabId: newTab.id, url: newTab.url ?? '', title: newTab.title ?? '' }
    }
  }
  result.tabId = msg.tabId
  postResult(msg, { ok: true, data: result })
  if (msg.kind === 'observe' || msg.kind === 'read_text' || msg.kind === 'read_state') sendTabSnapshot()
}

async function connect() {
  disconnectPort()
  setStatus({
    status: 'connecting',
    tabId: null,
    title: '',
    url: '',
    error: '',
    appVersion: ''
  })
  try {
    port = chrome.runtime.connectNative(NM_HOST_NAME)
  } catch {
    port = null
    setStatus({ status: 'error', error: 'Dogear 未运行' })
    return
  }
  port.onMessage.addListener(onHostMessage)
  port.onDisconnect.addListener(onHostDisconnect)
  port.postMessage({
    type: 'hello',
    extensionVersion: chrome.runtime.getManifest().version,
    protocolVersion: 5,
    tabId: NO_FOCUS_TAB_ID
  })
}

initAutoConnect({ connect, isPortAlive: () => port != null })

initInterventionWatch((tabId) => {
  if (!port) return
  try {
    port.postMessage({ type: 'intervention_resolved', tabId })
  } catch {
  }
})

async function onHostMessage(message) {
  if (message?.type === 'welcome') {
    setStatus({ status: 'connected', appVersion: message.appVersion ?? '', error: '' })
    await recoverFocusAndPush()
    return
  }
  if (message?.type === 'goodbye') {
    disconnectPort()
    setStatus({ status: 'idle', error: '' })
    return
  }
  if (message?.type === 'command') {
    handleCommand(message)
  }
}

function onHostDisconnect() {
  port = null
  const lastError = chrome.runtime.lastError?.message ?? ''
  if (state.status === 'connected') {
    setStatus({ status: 'idle', error: '' })
  } else if (lastError) {
    setStatus({ status: 'error', error: 'Dogear 未运行' })
  } else {
    setStatus({ status: 'idle', error: '' })
  }
}

chrome.tabs.onCreated.addListener(() => {
  ensureConnected()
})

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  ensureConnected()
  if (!port || state.tabId == null || tabId !== state.tabId) return
  const url = changeInfo?.url
  if (typeof url !== 'string' || !url) return
  bumpGeneration(tabId, url)
  scheduleTrackedSnapshot(sendTabSnapshot)
})

chrome.tabs.onActivated.addListener(() => {
  ensureConnected()
})

chrome.windows.onFocusChanged.addListener(() => {
  ensureConnected()
})

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'dogear_disconnect') {
    markManualDisconnect(true)
    disconnectPort()
    setStatus({ status: 'idle', error: '' })
    sendResponse({ ok: true })
    return
  }
  if (message?.type === 'dogear_connect') {
    markManualDisconnect(false)
      .then(ensureConnected)
      .then(() => sendResponse({ ok: true }))
      .catch(() => sendResponse({ ok: false }))
    return true
  }
  if (message?.type === 'dogear_handoff') {
    getActiveTab()
      .then((tab) => sendPageHandoff(tab, ''))
      .then((result) => sendResponse(result))
      .catch(() => sendResponse({ ok: false, error: '发送失败' }))
    return true
  }
  if (message?.type === 'dogear_get_state') {
    sendResponse({ ...state })
  }
})
