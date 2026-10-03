import { extractTabSnapshot } from './content-extract.js'
import { handleTabCommand, getDogearTabs } from './tab-commands.js'
import { clickFn, fillFn, scrollFn, readTextFn, readStateFn } from './dom-actions.js'
import { snapshotGroupTabIds, detectNewGroupTab } from './click-watch.js'
import { observeFn } from './observe-actions.js'
import { findFn } from './find-actions.js'
import { resolvePageState } from './page-state.js'
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
  scheduleRetry,
  markManualDisconnect,
  waitForConnected
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

const HANDOFF_EXCERPT_LIMIT = 4000
const BADGE_RESET_MS = 3000
let badgeTimer = null

function flashHandoffError() {
  chrome.action.setBadgeText({ text: '!' }).catch(() => {})
  clearTimeout(badgeTimer)
  badgeTimer = setTimeout(() => {
    chrome.action.setBadgeText({ text: '' }).catch(() => {})
  }, BADGE_RESET_MS)
}

async function extractHandoffExcerpt(tabId) {
  try {
    const [injection] = await chrome.scripting.executeScript({
      target: { tabId },
      func: readTextFn,
      args: [null]
    })
    return String(injection?.result?.text ?? '').slice(0, HANDOFF_EXCERPT_LIMIT)
  } catch {
    return ''
  }
}

async function sendPageHandoff(tab, selectionText) {
  if (!port) {
    flashHandoffError()
    return { ok: false, error: '等待连接' }
  }
  if (!tab || tab.id == null || !tab.url || !/^https?:/.test(tab.url)) {
    return { ok: false, error: '当前页面不支持移交' }
  }
  const textExcerpt = await extractHandoffExcerpt(tab.id)
  const payload = {
    type: 'page_handoff',
    url: tab.url,
    title: tab.title ?? '',
    ...(selectionText ? { selectionText } : {}),
    ...(textExcerpt ? { textExcerpt } : {})
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

async function pushGroupTabSnapshots() {
  if (!port || state.tabId == null) return
  const tabs = await getDogearTabs()
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
  scroll: scrollFn
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

// 点击触发导航会销毁注入上下文，executeScript 的 Promise 永不 settle，必须外层加超时竞赛
function executeScriptWithTimeout(tabId, func, args, world) {
  let timer
  return Promise.race([
    chrome.scripting.executeScript({ target: { tabId }, func, args, ...(world ? { world } : {}) }),
    new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new Error(INJECT_TIMEOUT_MSG)), INJECT_TIMEOUT_MS)
    })
  ]).finally(() => clearTimeout(timer))
}

async function resolveLostClickResult(msg) {
  for (let attempt = 0; attempt < 4; attempt++) {
    let tabAfter
    try {
      tabAfter = await chrome.tabs.get(msg.tabId)
    } catch {
      return { ok: false, errorCode: 'tab_closed', error: '标签页已关闭' }
    }
    if (msg.url && tabAfter.url && !tabAfter.url.startsWith(msg.url)) {
      return { ok: true, data: { clicked: true, navigated: true, urlAfter: tabAfter.url, verification: 'lost' } }
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  return {
    ok: false,
    errorCode: 'navigated_away',
    error: '页面在命令执行期间发生变化，无法完成命令，请重新观察后再操作'
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

async function handleCommand(msg) {
  if (!port) return
  try {
    if (await handleTabCommand(msg, TAB_COMMAND_CTX)) return
  } catch (err) {
    fail(msg, 'timeout', `tab 命令执行异常：${String(err?.message ?? err)}`)
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
  const readSafe = msg.kind === 'observe' || msg.kind === 'find' || msg.kind === 'read_text' || msg.kind === 'read_state'
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
  if ((msg.kind === 'click' || msg.kind === 'fill' || msg.kind === 'scroll' || msg.kind === 'read_text') && p.ref) {
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
                : [p.ref]
  ).map((v) => (v === undefined ? null : v))
  const injectWorld = msg.kind === 'read_state' ? 'MAIN' : undefined
  const clickBeforeIds = msg.kind === 'click' ? await snapshotGroupTabIds() : null
  let result = null
  let injectTimedOut = false
  try {
    const [injection] = await executeScriptWithTimeout(msg.tabId, func, args, injectWorld)
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
      result.submitTarget !== undefined ? { submitTarget: result.submitTarget } : undefined
    )
    return
  }
  if (msg.kind === 'observe' || msg.kind === 'find') {
    result.pageState = resolvePageState(result.url || tab.url || '', result.title || '', result.textSample || '')
    delete result.textSample
  } else if (msg.kind === 'scroll') {
    result.pageState = resolvePageState(tab.url || '', tab.title || '', '')
  }
  if (msg.kind === 'click') {
    const newTab = await detectNewGroupTab(clickBeforeIds)
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
    scheduleRetry()
    return
  }
  port.onMessage.addListener(onHostMessage)
  port.onDisconnect.addListener(onHostDisconnect)
  port.postMessage({
    type: 'hello',
    extensionVersion: chrome.runtime.getManifest().version,
    protocolVersion: 4,
    tabId: NO_FOCUS_TAB_ID
  })
}

async function handleFocusCurrent() {
  const tab = await getActiveTab()
  if (!tab || tab.id == null) return { ok: false, error: '未找到活动标签页' }
  if (state.status === 'connected' && state.tabId === tab.id) return { ok: true }
  await markManualDisconnect(false)
  await connect()
  const connected = await waitForConnected(() => state.status === 'connected')
  if (!connected) return { ok: false, error: '等待连接超时，请确认 Dogear 已运行' }
  TAB_COMMAND_CTX.setFocusedTab(tab)
  sendTabSnapshot()
  return { ok: true }
}

initAutoConnect({ connect, isPortAlive: () => port != null })

function onHostMessage(message) {
  if (message?.type === 'welcome') {
    setStatus({ status: 'connected', appVersion: message.appVersion ?? '', error: '' })
    sendTabSnapshot()
    pushGroupTabSnapshots()
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
  scheduleRetry()
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (!port || state.tabId == null || tabId !== state.tabId) return
  const url = changeInfo?.url
  if (typeof url !== 'string' || !url) return
  bumpGeneration(tabId, url)
  scheduleTrackedSnapshot(sendTabSnapshot)
})

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'dogear_connect') {
    markManualDisconnect(false).then(() => connect())
    sendResponse({ ok: true })
    return
  }
  if (message?.type === 'dogear_disconnect') {
    markManualDisconnect(true)
    disconnectPort()
    setStatus({ status: 'idle', error: '' })
    sendResponse({ ok: true })
    return
  }
  if (message?.type === 'dogear_focus_current') {
    handleFocusCurrent()
      .then(sendResponse)
      .catch(() => sendResponse({ ok: false, error: '操作失败' }))
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
