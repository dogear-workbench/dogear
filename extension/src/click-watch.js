import { getDogearTabs } from './tab-commands.js'

const DETECT_POLL_TIMES = 2
const DETECT_POLL_INTERVAL_MS = 750

export async function snapshotGroupTabIds() {
  try {
    const tabs = await getDogearTabs()
    return new Set(tabs.map((t) => t.id).filter((id) => id != null))
  } catch {
    return null
  }
}

export async function detectNewGroupTab(beforeIds, options) {
  if (!beforeIds) return null
  const pollTimes = options?.pollTimes ?? DETECT_POLL_TIMES
  const intervalMs = options?.intervalMs ?? DETECT_POLL_INTERVAL_MS
  for (let i = 0; i < pollTimes; i++) {
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
    try {
      const tabs = await getDogearTabs()
      const fresh = tabs.filter((t) => t.id != null && !beforeIds.has(t.id))
      if (fresh.length) {
        fresh.sort((a, b) => (b.id ?? 0) - (a.id ?? 0))
        return fresh[0]
      }
    } catch {
      return null
    }
  }
  return null
}
