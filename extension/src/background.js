import { extractTabSnapshot } from './content-extract.js'

const NM_HOST_NAME = 'com.dogear.nmhost'

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
    ...(extractError ? { extractError } : {})
  })
}

async function connect() {
  disconnectPort()
  const tab = await getActiveTab()
  if (!tab || tab.id == null) {
    setStatus({ status: 'error', error: '未找到活动标签页' })
    return
  }
  setStatus({
    status: 'connecting',
    tabId: tab.id,
    title: tab.title ?? '',
    url: tab.url ?? '',
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
    tabId: tab.id
  })
}

function onHostMessage(message) {
  if (message?.type === 'welcome') {
    setStatus({ status: 'connected', appVersion: message.appVersion ?? '', error: '' })
    sendTabSnapshot()
    return
  }
  if (message?.type === 'goodbye') {
    disconnectPort()
    setStatus({ status: 'idle', error: '' })
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

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'dogear_connect') {
    connect()
    sendResponse({ ok: true })
    return
  }
  if (message?.type === 'dogear_get_state') {
    sendResponse({ ...state })
  }
})
