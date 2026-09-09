// observeFn 经 chrome.scripting.executeScript 序列化后注入页面执行，函数体内不得引用模块作用域
export function observeFn(region, textFilter, generation) {
  const gen = typeof generation === 'number' && Number.isInteger(generation) && generation >= 0 ? generation : 0
  const regionFilter = region === 'top' || region === 'middle' || region === 'bottom' ? region : null
  const filter = typeof textFilter === 'string' ? textFilter.trim().toLowerCase() : ''

  const MAX_INTERACTIVE = 250
  const MAX_HEADINGS = 60
  const MAX_SUMMARY = 12
  const INTERACTIVE_NAME_LIMIT = 160
  const CONTEXT_NAME_LIMIT = 80
  const HINT_LIMIT = 80
  const SUMMARY_SAMPLE_LIMIT = 120
  const HREF_LIMIT = 400
  const PAGE_TEXT_LIMIT = 4000

  const INTERACTIVE_ROLES = new Set([
    'button',
    'checkbox',
    'combobox',
    'gridcell',
    'link',
    'listbox',
    'menuitem',
    'menuitemcheckbox',
    'menuitemradio',
    'option',
    'radio',
    'searchbox',
    'slider',
    'spinbutton',
    'switch',
    'tab',
    'textbox',
    'treeitem'
  ])
  const NOISE_ROLES = new Set(['generic', 'none', 'presentation', 'ignored'])

  const nodes = []
  const collect = (root) => {
    root.querySelectorAll('[data-dogear-ref]').forEach((el) => el.removeAttribute('data-dogear-ref'))
    for (const el of root.querySelectorAll('*')) {
      nodes.push(el)
      if (el.shadowRoot) collect(el.shadowRoot)
    }
  }
  collect(document)

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

  const hintOf = (el) =>
    el.getAttribute('placeholder') || el.getAttribute('aria-description') || el.getAttribute('title') || ''

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

  const vh = window.innerHeight
  const regionOf = (rect) => {
    const cy = rect.top + rect.height / 2
    if (cy < vh / 3) return 'top'
    if (cy > (2 * vh) / 3) return 'bottom'
    return 'middle'
  }

  const interactive = []
  const headingEls = []
  const contextual = []
  for (const el of nodes) {
    const role = roleOf(el)
    if (!role || NOISE_ROLES.has(role)) continue
    if (INTERACTIVE_ROLES.has(role)) interactive.push({ el, role })
    else if (role === 'heading') headingEls.push(el)
    else contextual.push({ el, role })
  }

  const interactiveSet = new Set(interactive.map((item) => item.el))
  const hasInteractiveAncestor = (startEl) => {
    let node = startEl
    while (node) {
      let next = node.parentElement
      if (!next) {
        const root = node.getRootNode()
        next = root && root.host ? root.host : null
      }
      if (!next) return false
      if (interactiveSet.has(next)) return true
      node = next
    }
    return false
  }

  const matches = (name, hint) => !filter || `${name} ${hint}`.toLowerCase().includes(filter)

  const regionCounts = { top: 0, middle: 0, bottom: 0 }
  const candidates = []
  for (const item of interactive) {
    if (!visible(item.el)) continue
    const reg = regionOf(item.el.getBoundingClientRect())
    regionCounts[reg]++
    if (regionFilter && reg !== regionFilter) continue
    candidates.push(item)
  }
  const filtered = []
  for (const item of candidates) {
    const name = nameOf(item.el)
    const hint = squashed(hintOf(item.el))
    if (!matches(name, hint)) continue
    item.name = name
    item.hint = hint
    filtered.push(item)
  }
  const interactiveTruncated = filtered.length > MAX_INTERACTIVE
  const shown = filtered.slice(0, MAX_INTERACTIVE)

  const filteredHeadings = []
  for (const el of headingEls) {
    const name = squashed(el.textContent)
    if (!name) continue
    if (!matches(name, '')) continue
    filteredHeadings.push({ el, name })
  }
  const headingsTruncated = filteredHeadings.length > MAX_HEADINGS
  const shownHeadings = filteredHeadings.slice(0, MAX_HEADINGS)

  let refSeq = 0
  const markRef = (el) => {
    refSeq++
    const ref = 'e' + refSeq + '@' + gen
    el.setAttribute('data-dogear-ref', ref)
    return ref
  }

  const elements = shown.map((item) => {
    const element = {
      ref: markRef(item.el),
      role: item.role,
      text: item.name.slice(0, INTERACTIVE_NAME_LIMIT),
      hint: item.hint.slice(0, HINT_LIMIT),
      editable: item.role === 'textbox' || item.role === 'searchbox',
      interactive: true
    }
    const href = hrefOf(item.el)
    if (href) element.href = href
    return element
  })

  const headings = shownHeadings.map((item) => {
    const element = {
      ref: markRef(item.el),
      role: 'heading',
      text: item.name.slice(0, CONTEXT_NAME_LIMIT),
      hint: '',
      editable: false,
      interactive: false
    }
    const level = levelOf(item.el)
    if (level !== undefined) element.level = level
    return element
  })

  const byRole = new Map()
  for (const item of contextual) {
    if (hasInteractiveAncestor(item.el)) continue
    const name = squashed(item.el.textContent)
    if (!name) continue
    const existing = byRole.get(item.role)
    if (existing) {
      existing.count += 1
      existing.totalChars += name.length
      if (name.length > existing.sample.length) existing.sample = name
    } else {
      byRole.set(item.role, {
        role: item.role,
        count: 1,
        totalChars: name.length,
        sample: name.slice(0, SUMMARY_SAMPLE_LIMIT)
      })
    }
  }
  const roleSummary = [...byRole.values()].sort((a, b) => b.totalChars - a.totalChars).slice(0, MAX_SUMMARY)

  const pageText = squashed(document.body ? document.body.innerText : '').slice(0, PAGE_TEXT_LIMIT)

  return {
    url: location.href,
    title: document.title || '',
    generation: gen,
    totalInteractive: filtered.length,
    shownInteractive: shown.length,
    regionCounts,
    elements,
    headings,
    roleSummary,
    truncated: interactiveTruncated || headingsTruncated,
    textSample: pageText
  }
}
