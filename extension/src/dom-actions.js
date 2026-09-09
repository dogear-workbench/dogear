// 各函数经 chrome.scripting.executeScript 序列化后注入页面执行，函数体内不得引用模块作用域
export async function scrollFn(ref, deltaY, position) {
  const hasPosition = position === 'top' || position === 'bottom'
  const delta = typeof deltaY === 'number' && Number.isFinite(deltaY) ? deltaY : null
  if (!hasPosition && (delta === null || delta === 0)) {
    return { errorCode: 'scroll_invalid', error: 'deltaY 与 position 至少提供一个，且 deltaY 不能为 0' }
  }
  const read = (el) => ({
    top: Math.round(el.scrollTop),
    height: Math.round(el.scrollHeight),
    clientHeight: Math.round(el.clientHeight)
  })
  let target = null
  let container = false
  if (ref) {
    if (!/^e\d+(@\d+)?$/.test(String(ref))) {
      return { errorCode: 'ref_expired', error: `ref "${ref}" 不存在或已失效，请重新观察页面后再操作` }
    }
    target = document.querySelector(`[data-dogear-ref="${ref}"]`)
    if (!target) {
      return {
        errorCode: 'ref_expired',
        error: `ref "${ref}" 对应元素已不在页面上，页面可能已导航或内容重建，请重新观察页面`
      }
    }
    container = true
  } else {
    target = document.scrollingElement || document.documentElement
  }
  if (!target || typeof target.scrollTo !== 'function') {
    return { errorCode: 'ref_expired', error: '目标元素不支持滚动，请重新观察页面确认可滚动的容器元素' }
  }
  const before = read(target)
  const top = hasPosition
    ? position === 'top'
      ? 0
      : Math.max(0, target.scrollHeight - target.clientHeight)
    : target.scrollTop + delta
  target.scrollTo({ top, left: target.scrollLeft, behavior: 'auto' })
  await new Promise((resolve) => setTimeout(resolve, 200))
  const after = read(target)
  return { target: container ? 'container' : 'document', before, after, moved: before.top !== after.top }
}

export async function clickFn(ref) {
  if (!/^e\d+(@\d+)?$/.test(String(ref))) {
    return { errorCode: 'ref_expired', error: `ref "${ref}" 不存在或已失效，请重新观察页面后再操作` }
  }
  const selector = `[data-dogear-ref="${ref}"]`
  const el = document.querySelector(selector)
  if (!el) {
    return {
      errorCode: 'ref_expired',
      error: `ref "${ref}" 对应元素已不在页面上，页面可能已导航或内容重建，请重新观察页面`,
    }
  }
  const tag = el.tagName.toLowerCase()
  const type = (el.getAttribute('type') || '').toLowerCase()
  const isSubmit =
    (tag === 'button' && type === 'submit') ||
    (tag === 'input' && (type === 'submit' || type === 'image')) ||
    (tag === 'button' && !type && !!el.closest('form'))
  if (isSubmit) {
    return {
      errorCode: 'guard_submit',
      error: '提交类操作属 L2+，本阶段未开放；请引导用户在浏览器中手动完成提交',
    }
  }
  const mainTextLength = () => {
    const count = (node) => (node && node.innerText ? node.innerText.replace(/\s+/g, '') : '').length
    let container = 0
    document.querySelectorAll('article, main, [role="main"], #content, .content').forEach((node) => {
      container = Math.max(container, count(node))
    })
    return Math.max(container, count(document.body))
  }
  const urlBefore = location.href
  const textBefore = mainTextLength()
  el.click()
  await new Promise((resolve) => setTimeout(resolve, 400))
  let elementGone = false
  try {
    elementGone = !document.querySelector(selector)
  } catch {
    elementGone = true
  }
  return { urlBefore, urlAfter: location.href, elementGone, textBefore, textAfter: mainTextLength() }
}

export async function fillFn(ref, value) {
  if (!/^e\d+(@\d+)?$/.test(String(ref))) {
    return { errorCode: 'ref_expired', error: `ref "${ref}" 不存在或已失效，请重新观察页面后再操作` }
  }
  const el = document.querySelector(`[data-dogear-ref="${ref}"]`)
  if (!el) {
    return {
      errorCode: 'ref_expired',
      error: `ref "${ref}" 对应元素已不在页面上，页面可能已导航或内容重建，请重新观察页面`,
    }
  }
  const tag = el.tagName.toLowerCase()
  const type = (el.getAttribute('type') || '').toLowerCase()
  const formHasPassword = el.closest('form')?.querySelector('input[type="password"]') != null
  if ((tag === 'input' && type === 'password') || formHasPassword) {
    return { errorCode: 'guard_password', error: '密码类输入本阶段禁止；请引导用户在浏览器中手动填写' }
  }
  const expected = String(value)
  if (el.isContentEditable) {
    el.textContent = expected
    el.dispatchEvent(new Event('input', { bubbles: true }))
    if (el.textContent !== expected) {
      return { errorCode: 'value_mismatch', error: '填写后回读不一致，元素值可能被页面改写' }
    }
  } else {
    const proto =
      tag === 'textarea'
        ? window.HTMLTextAreaElement.prototype
        : tag === 'select'
          ? window.HTMLSelectElement.prototype
          : window.HTMLInputElement.prototype
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set
    if (!setter) {
      return { errorCode: 'value_mismatch', error: '该元素不支持填写' }
    }
    setter.call(el, expected)
    el.dispatchEvent(new Event(tag === 'select' ? 'change' : 'input', { bubbles: true }))
    if (el.value !== expected) {
      return { errorCode: 'value_mismatch', error: '填写后回读不一致，元素值可能被页面改写' }
    }
  }
  return { applied: true }
}

// __INITIAL_STATE__ 是页面主世界的全局，须以 world:'MAIN' 注入（隔离世界读不到）
export function readStateFn(path) {
  const state = window.__INITIAL_STATE__
  if (state === null || state === undefined) return { missing: true }
  const typeLabel = (v) => {
    if (v === null) return 'null'
    if (Array.isArray(v)) return 'array'
    return typeof v === 'object' ? 'object' : typeof v
  }
  if (!path) {
    const lines = []
    for (const key of Object.keys(state)) {
      const v = state[key]
      const t = typeLabel(v)
      let size
      if (t === 'array') size = `长度 ${v.length}`
      else if (t === 'object') size = `子项 ${Object.keys(v).length}`
      else if (t === 'string') size = `长度 ${v.length}`
      else size = String(v)
      lines.push(`${key}：${t}，${size}`)
    }
    return { summary: lines.join('\n') }
  }
  const segments = String(path)
    .split('.')
    .filter((s) => s !== '')
  let cur = state
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]
    if (cur === null || typeof cur !== 'object') return { notFound: true, availableKeys: [] }
    const next = cur[seg]
    if (next === undefined) return { notFound: true, availableKeys: Object.keys(cur) }
    cur = next
  }
  let raw
  try {
    raw = JSON.stringify(cur)
  } catch {
    return { notSerializable: true }
  }
  if (raw === undefined || raw === null) return { notSerializable: true }
  const totalLength = raw.length
  const truncated = totalLength > 8000
  return {
    json: truncated ? raw.slice(0, 8000) + '…（截断）' : raw,
    truncated,
    totalLength,
  }
}

export function readTextFn(ref) {
  if (ref) {
    if (!/^e\d+(@\d+)?$/.test(String(ref))) {
      return { errorCode: 'ref_expired', error: `ref "${ref}" 不存在或已失效，请重新观察页面后再操作` }
    }
    const el = document.querySelector(`[data-dogear-ref="${ref}"]`)
    if (!el) {
      return {
        errorCode: 'ref_expired',
        error: `ref "${ref}" 对应元素已不在页面上，页面可能已导航或内容重建，请重新观察页面`,
      }
    }
    const text = el.innerText || ''
    return { text: text.slice(0, 8000), totalLength: text.length }
  }
  let best = ''
  document.querySelectorAll('article, main, [role="main"], #content, .content').forEach((el) => {
    const t = el && el.innerText ? el.innerText : ''
    if (t.length > best.length) best = t
  })
  const text = best || (document.body ? document.body.innerText : '')
  return { text: text.slice(0, 8000), totalLength: text.length }
}
