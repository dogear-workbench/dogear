export function extractTabSnapshot() {
  return {
    title: document.title || '',
    url: location.href,
    textPreview: (document.body?.innerText ?? '').replace(/\s+/g, ' ').trim().slice(0, 500)
  }
}

// extractArticleHtml 经 chrome.scripting.executeScript 序列化后注入页面执行，函数体内不得引用模块作用域
export async function extractArticleHtml(selector) {
  if (document.readyState !== 'complete') {
    const deadline = Date.now() + 3000
    while (document.readyState !== 'complete' && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 200))
    }
  }
  const html = document.documentElement.outerHTML
  const base = { url: location.href, title: document.title || '' }
  if (typeof selector !== 'string' || selector.trim().length === 0) {
    return { html, ...base }
  }
  let el = null
  try {
    el = document.querySelector(selector)
  } catch {
    return {
      errorCode: 'value_mismatch',
      error: `selector 语法无效: ${selector}`,
      reason: `CSS selector 语法无效: ${selector}，请修正后重试`,
    }
  }
  if (!el) {
    return {
      errorCode: 'value_mismatch',
      error: `页面上不存在匹配 "${selector}" 的元素`,
      reason: `页面上不存在匹配 "${selector}" 的元素，可换选择器重试或不传 selector 自动识别正文`,
    }
  }
  return { html, containerHtml: el.outerHTML, ...base }
}
