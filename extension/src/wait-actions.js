// waitFn 经 chrome.scripting.executeScript 序列化后注入页面执行，函数体内不得引用模块作用域（含常量与辅助函数，一律内联）

export async function waitFn(selector, ref, condition, text, timeoutMs) {
  const isElementVisible = (el) => {
    const rect = el.getBoundingClientRect()
    return el.offsetParent !== null || (rect.width > 0 && rect.height > 0)
  }
  const timeout =
    typeof timeoutMs === 'number' && Number.isFinite(timeoutMs) && timeoutMs >= 1000
      ? Math.min(timeoutMs, 30000)
      : 10000
  const cond = condition === 'visible' || condition === 'hidden' || condition === 'text_contains' ? condition : null
  if (!cond) {
    return {
      errorCode: 'value_mismatch',
      error: `未知等待条件 ${condition}`,
      reason: '等待条件仅支持 visible（出现）/ hidden（消失）/ text_contains（文本包含）',
    }
  }
  const hasSelector = typeof selector === 'string' && selector.trim().length > 0
  const hasRef = typeof ref === 'string' && ref.trim().length > 0
  const hasText = typeof text === 'string' && text.length > 0
  if (cond === 'text_contains') {
    if (!hasText) {
      return {
        errorCode: 'value_mismatch',
        error: 'text_contains 条件缺少 text',
        reason: 'condition=text_contains 时必须提供 text（要等待出现的文本子串）',
      }
    }
  } else if (!hasSelector && !hasRef) {
    return {
      errorCode: 'value_mismatch',
      error: 'visible/hidden 条件缺少元素定位',
      reason: 'condition=visible/hidden 时必须提供 selector 或 ref',
    }
  }
  if (hasSelector) {
    try {
      document.querySelector(selector)
    } catch {
      return {
        errorCode: 'value_mismatch',
        error: `selector 语法无效: ${selector}`,
        reason: `CSS selector 语法无效: ${selector}，请修正后重试`,
      }
    }
  }
  if (hasRef && !/^e\d+(@\d+)?$/.test(String(ref))) {
    return { errorCode: 'ref_expired', error: `ref "${ref}" 不存在或已失效，请重新观察页面后再操作` }
  }
  const queryBySelector = hasSelector
    ? () => {
        try {
          return document.querySelector(selector)
        } catch {
          return null
        }
      }
    : null
  const queryByRef = hasRef ? () => document.querySelector(`[data-dogear-ref="${ref}"]`) : null
  const deadline = Date.now() + timeout
  const url = () => location.href
  if (cond === 'text_contains') {
    while (Date.now() < deadline) {
      let container = document.body
      if (queryByRef) {
        container = queryByRef()
        if (!container) {
          return { errorCode: 'ref_expired', error: `ref "${ref}" 对应元素已不在页面上，请重新观察页面` }
        }
      } else if (queryBySelector) {
        container = queryBySelector()
      }
      const source = container ? container.innerText || '' : ''
      if (source.includes(text)) {
        return { matched: true, url: url() }
      }
      await new Promise((resolve) => setTimeout(resolve, 400))
    }
    return { matched: false, url: url() }
  }
  while (Date.now() < deadline) {
    let el = null
    if (queryByRef) {
      el = queryByRef()
      if (cond === 'visible' && !el) {
        return { errorCode: 'ref_expired', error: `ref "${ref}" 对应元素已不在页面上，data-dogear-ref 标记不会重新出现，请重新观察页面` }
      }
    } else {
      el = queryBySelector()
    }
    if (cond === 'visible') {
      if (el && isElementVisible(el)) {
        return { matched: true, url: url() }
      }
    } else if (!el || !isElementVisible(el)) {
      return { matched: true, url: url() }
    }
    await new Promise((resolve) => setTimeout(resolve, 400))
  }
  return { matched: false, url: url() }
}
