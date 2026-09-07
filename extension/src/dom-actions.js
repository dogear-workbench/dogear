// 各函数经 chrome.scripting.executeScript 序列化后注入页面执行，函数体内不得引用模块作用域
export function observeFn(region, textFilter, generation) {
  const gen = typeof generation === 'number' && Number.isInteger(generation) && generation >= 0 ? generation : 0
  document.querySelectorAll('[data-dogear-ref]').forEach((el) => el.removeAttribute('data-dogear-ref'))
  const selector =
    'a[href], button, input, select, textarea, [role="button"], [role="link"], [role="tab"], ' +
    '[role="checkbox"], [role="radio"], [role="menuitem"], [role="combobox"], [role="option"], ' +
    '[role="textbox"], [contenteditable="true"]'
  const visible = (el) => {
    const style = window.getComputedStyle(el)
    const rect = el.getBoundingClientRect()
    return (
      style.display !== 'none' &&
      style.visibility !== 'hidden' &&
      style.pointerEvents !== 'none' &&
      rect.width > 0 &&
      rect.height > 0
    )
  }
  const defaultRole = (el) => {
    const tag = el.tagName.toLowerCase()
    if (tag === 'a') return 'link'
    if (tag === 'button') return 'button'
    if (tag === 'select') return 'combobox'
    if (tag === 'textarea') return 'textbox'
    if (tag === 'input') {
      const type = (el.getAttribute('type') || 'text').toLowerCase()
      if (type === 'checkbox') return 'checkbox'
      if (type === 'radio') return 'radio'
      if (type === 'button' || type === 'submit') return 'button'
      return 'textbox'
    }
    return 'generic'
  }
  const hintOf = (el) =>
    el.getAttribute('placeholder') || el.getAttribute('aria-label') || el.getAttribute('title') || ''
  const hrefOf = (el) => {
    if (el.tagName.toLowerCase() !== 'a') return null
    const raw = el.href || ''
    if (!raw) return null
    return raw.length > 400 ? raw.slice(0, 400) + '…' : raw
  }
  const textOf = (el) => {
    const raw = (el.tagName.toLowerCase() === 'input' ? el.value : el.innerText) || ''
    return raw.trim().replace(/\s+/g, ' ').slice(0, 80)
  }
  const vh = window.innerHeight
  const regionOf = (rect) => {
    const cy = rect.top + rect.height / 2
    if (cy < vh / 3) return 'top'
    if (cy > (2 * vh) / 3) return 'bottom'
    return 'middle'
  }
  const regionCounts = { top: 0, middle: 0, bottom: 0 }
  const matched = []
  for (const el of document.querySelectorAll(selector)) {
    if (!visible(el)) continue
    const rect = el.getBoundingClientRect()
    const reg = regionOf(rect)
    regionCounts[reg]++
    if (region && reg !== region) continue
    const text = textOf(el)
    const hint = hintOf(el)
    if (textFilter) {
      const f = String(textFilter).toLowerCase()
      const hay = (text + ' ' + hint).toLowerCase()
      if (!hay.includes(f)) continue
    }
    matched.push(el)
  }
  const elements = matched.slice(0, 120).map((el, i) => {
    const ref = 'e' + (i + 1) + '@' + gen
    el.setAttribute('data-dogear-ref', ref)
    const href = hrefOf(el)
    return {
      ref,
      tag: el.tagName.toLowerCase(),
      role: el.getAttribute('role') || defaultRole(el),
      text: textOf(el),
      hint: hintOf(el),
      ...(href ? { href } : {}),
    }
  })
  return { total: matched.length, regionCounts, elements, generation: gen }
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
