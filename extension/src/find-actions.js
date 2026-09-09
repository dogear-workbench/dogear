// findFn 经 chrome.scripting.executeScript 序列化后注入页面执行，函数体内不得引用模块作用域
export function findFn(roleFilter, nameFilter, exact, maxResults, generation) {
  const gen = typeof generation === 'number' && Number.isInteger(generation) && generation >= 0 ? generation : 0
  const role = typeof roleFilter === 'string' ? roleFilter.trim().toLowerCase() : ''
  const name = typeof nameFilter === 'string' ? nameFilter.trim().toLowerCase() : ''
  if (!role && !name) {
    return { errorCode: 'stale_protocol', error: '语义查找至少需要 role 或 name 参数' }
  }
  const limit = Math.min(Math.max(Number.isInteger(maxResults) && maxResults > 0 ? maxResults : 20, 1), 50)

  const INTERACTIVE_NAME_LIMIT = 160
  const HINT_LIMIT = 80
  const HREF_LIMIT = 400
  const PAGE_TEXT_LIMIT = 4000

  const squashed = (raw) => (raw || '').replace(/\s+/g, ' ').trim()

  const roleOf = (el) => {
    const explicit = (el.getAttribute('role') || '').trim().toLowerCase()
    if (explicit) return explicit
    const tag = el.tagName.toLowerCase()
    if (tag === 'a' || tag === 'area') return el.hasAttribute('href') ? 'link' : 'generic'
    if (tag === 'button' || tag === 'summary') return 'button'
    if (tag === 'select') return el.hasAttribute('multiple') ? 'listbox' : 'combobox'
    if (tag === 'textarea') return 'textbox'
    if (tag === 'option') return 'option'
    if (tag === 'img') return el.getAttribute('alt') ? 'img' : 'presentation'
    if (tag === 'svg' || tag === 'figure') return 'img'
    if (tag === 'article') return 'article'
    if (tag === 'nav') return 'navigation'
    if (tag === 'aside') return 'complementary'
    if (tag === 'main') return 'main'
    if (tag === 'header') return 'banner'
    if (tag === 'footer') return 'contentinfo'
    if (tag === 'form' || tag === 'fieldset') return 'group'
    if (tag === 'dialog' || tag === 'table') return tag
    if (tag === 'ul' || tag === 'ol' || tag === 'dl') return 'list'
    if (tag === 'li') return 'listitem'
    if (tag === 'blockquote') return 'blockquote'
    if (tag === 'hr') return 'separator'
    if (tag === 'p') return 'paragraph'
    if (tag === 'pre' || tag === 'code') return 'code'
    if (tag === 'h1' || tag === 'h2' || tag === 'h3' || tag === 'h4' || tag === 'h5' || tag === 'h6') return 'heading'
    if (tag === 'input') {
      const type = (el.getAttribute('type') || 'text').toLowerCase()
      if (type === 'checkbox') return 'checkbox'
      if (type === 'radio') return 'radio'
      if (type === 'range') return 'slider'
      if (type === 'number') return 'spinbutton'
      if (type === 'search') return 'searchbox'
      if (type === 'button' || type === 'submit' || type === 'reset' || type === 'image') return 'button'
      if (type === 'hidden') return ''
      return 'textbox'
    }
    if (el.isContentEditable) return 'textbox'
    return 'generic'
  }

  const nameOf = (el) => {
    const ariaLabel = el.getAttribute('aria-label')
    if (ariaLabel && ariaLabel.trim()) return squashed(ariaLabel)
    const labelledby = el.getAttribute('aria-labelledby')
    if (labelledby) {
      let text = ''
      for (const id of labelledby.split(/\s+/)) {
        const node = document.getElementById(id)
        if (node) text += ' ' + (node.textContent || '')
      }
      text = squashed(text)
      if (text) return text
    }
    const tag = el.tagName.toLowerCase()
    if (tag === 'input' || tag === 'textarea' || tag === 'select') {
      let label = null
      if (el.id) {
        try {
          label = document.querySelector('label[for="' + (window.CSS && CSS.escape ? CSS.escape(el.id) : el.id) + '"]')
        } catch {
          label = null
        }
      }
      if (!label) label = el.closest('label')
      const labelName = label ? squashed(label.textContent) : ''
      const type = tag === 'input' ? (el.getAttribute('type') || '').toLowerCase() : ''
      if (tag === 'input' && (type === 'submit' || type === 'reset' || type === 'button' || type === 'image')) {
        const value = squashed(el.value || el.getAttribute('alt') || '')
        return value || (type === 'submit' ? '提交' : type === 'reset' ? '重置' : '按钮')
      }
      const placeholder = el.getAttribute('placeholder') || ''
      const value = tag === 'select' ? '' : squashed(el.value || '')
      return (labelName || placeholder || value).trim()
    }
    if (tag === 'img') return squashed(el.getAttribute('alt'))
    return squashed(el.textContent)
  }

  const levelOf = (el) => {
    const ariaLevel = Number(el.getAttribute('aria-level'))
    if (Number.isFinite(ariaLevel) && ariaLevel > 0) return ariaLevel
    const match = /^h([1-6])$/.exec(el.tagName.toLowerCase())
    return match ? Number(match[1]) : undefined
  }

  const hrefOf = (el) => {
    const raw = el.href || ''
    if (!raw) return null
    return raw.length > HREF_LIMIT ? raw.slice(0, HREF_LIMIT) + '…' : raw
  }

  const nodes = []
  const collect = (root) => {
    root.querySelectorAll('[data-dogear-ref]').forEach((el) => el.removeAttribute('data-dogear-ref'))
    for (const el of root.querySelectorAll('*')) {
      nodes.push(el)
      if (el.shadowRoot) collect(el.shadowRoot)
    }
  }
  collect(document)

  const elements = []
  for (const el of nodes) {
    if (role && roleOf(el) !== role) continue
    const elName = nameOf(el)
    if (name) {
      const lowered = elName.toLowerCase()
      const matched = exact ? lowered === name : lowered.includes(name)
      if (!matched) continue
    } else if (!elName) {
      continue
    }
    const element = {
      ref: 'e' + (elements.length + 1) + '@' + gen,
      role: roleOf(el),
      text: elName.slice(0, INTERACTIVE_NAME_LIMIT),
      hint: squashed(el.getAttribute('placeholder') || el.getAttribute('aria-description') || el.getAttribute('title') || '').slice(0, HINT_LIMIT),
      editable: false,
      interactive: false
    }
    el.setAttribute('data-dogear-ref', element.ref)
    const elRole = element.role
    if (elRole === 'textbox' || elRole === 'searchbox') element.editable = true
    if (
      elRole === 'button' ||
      elRole === 'link' ||
      elRole === 'checkbox' ||
      elRole === 'radio' ||
      elRole === 'menuitem' ||
      elRole === 'tab' ||
      elRole === 'option' ||
      elRole === 'textbox' ||
      elRole === 'searchbox' ||
      elRole === 'combobox'
    ) {
      element.interactive = true
    }
    const href = hrefOf(el)
    if (href) element.href = href
    const level = levelOf(el)
    if (elRole === 'heading' && level !== undefined) element.level = level
    elements.push(element)
    if (elements.length >= limit) break
  }

  const pageText = squashed(document.body ? document.body.innerText : '').slice(0, PAGE_TEXT_LIMIT)

  return {
    url: location.href,
    title: document.title || '',
    generation: gen,
    elements,
    textSample: pageText
  }
}
