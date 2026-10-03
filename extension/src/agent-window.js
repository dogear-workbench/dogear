export const DOGEAR_GROUP_TITLE = 'Dogear'

const WINDOW_ID_KEY = 'dogearWindowId'

async function getStoredWindowId() {
  try {
    const data = await chrome.storage.local.get(WINDOW_ID_KEY)
    const id = data?.[WINDOW_ID_KEY]
    return typeof id === 'number' ? id : null
  } catch {
    return null
  }
}

async function storeWindowId(id) {
  try {
    await chrome.storage.local.set({ [WINDOW_ID_KEY]: id })
  } catch {
  }
}

async function clearStoredWindowId() {
  try {
    await chrome.storage.local.remove(WINDOW_ID_KEY)
  } catch {
  }
}

export async function forgetAgentWindowIfDead() {
  const storedId = await getStoredWindowId()
  if (storedId == null) return null
  try {
    await chrome.windows.get(storedId)
    return storedId
  } catch {
    await clearStoredWindowId()
    return null
  }
}

async function findGroupWindowId() {
  try {
    const groups = await chrome.tabGroups.query({ title: DOGEAR_GROUP_TITLE })
    const windowId = groups[0]?.windowId
    return typeof windowId === 'number' ? windowId : null
  } catch {
    return null
  }
}

export async function resolveAgentWindowId() {
  const aliveId = await forgetAgentWindowIfDead()
  if (aliveId != null) return aliveId
  const groupWindowId = await findGroupWindowId()
  if (groupWindowId != null) {
    await storeWindowId(groupWindowId)
    return groupWindowId
  }
  const created = await chrome.windows.create({ focused: false })
  const createdId = created?.id
  if (typeof createdId !== 'number') throw new Error('窗口创建失败')
  await storeWindowId(createdId)
  return createdId
}

chrome.windows.onRemoved.addListener((closedId) => {
  getStoredWindowId().then((storedId) => {
    if (storedId != null && closedId === storedId) clearStoredWindowId()
  })
})
