export function extractTabSnapshot() {
  return {
    title: document.title || '',
    url: location.href,
    textPreview: (document.body?.innerText ?? '').replace(/\s+/g, ' ').trim().slice(0, 500)
  }
}
