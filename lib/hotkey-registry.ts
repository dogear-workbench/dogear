export interface HotkeyDef {
  id: string;
  combo: string;
  description: string;
  scope: string;
}

export interface HotkeyEntry extends HotkeyDef {
  active: boolean;
}

type HotkeyHandler = (e: KeyboardEvent) => void;

export const HOTKEY_DEFS: readonly HotkeyDef[] = [
  { id: 'chat-search', combo: 'Ctrl+F', description: '会话内搜索', scope: '会话' },
  { id: 'notes-toggle-list', combo: 'Ctrl+\\', description: '显示/隐藏笔记列表', scope: '笔记' },
  { id: 'quick-chat-new', combo: 'Ctrl+Alt+N', description: '新建临时会话', scope: '全局' },
];

const normCombo = (combo: string) => combo.toLowerCase().replace(/\s+/g, '');

function matchesCombo(e: KeyboardEvent, combo: string): boolean {
  const parts = combo.toLowerCase().split('+').map((p) => p.trim());
  const key = parts[parts.length - 1];
  if (!(e.ctrlKey || e.metaKey)) return false;
  if (parts.includes('alt') !== e.altKey) return false;
  if (parts.includes('shift') !== e.shiftKey) return false;
  return e.key.toLowerCase() === key;
}

const handlersById = new Map<string, Set<HotkeyHandler>>();
let listenerAttached = false;

function handleKeyDown(e: KeyboardEvent) {
  for (const def of HOTKEY_DEFS) {
    if (!matchesCombo(e, def.combo)) continue;
    const handlers = handlersById.get(def.id);
    if (!handlers || handlers.size === 0) continue;
    e.preventDefault();
    for (const handler of handlers) handler(e);
  }
}

export function registerHotkey(id: string, handler: HotkeyHandler): () => void {
  const def = HOTKEY_DEFS.find((d) => d.id === id);
  if (!def) {
    console.warn(`[hotkey] 未知快捷键 id: ${id}`);
    return () => {};
  }
  for (const other of HOTKEY_DEFS) {
    if (other.id === id) continue;
    const otherHandlers = handlersById.get(other.id);
    if (!otherHandlers || otherHandlers.size === 0) continue;
    if (normCombo(other.combo) === normCombo(def.combo)) {
      console.warn(`[hotkey] 快捷键 ${def.combo} 被 ${id} 与 ${other.id} 同时注册`);
    }
  }
  let set = handlersById.get(id);
  if (!set) {
    set = new Set();
    handlersById.set(id, set);
  }
  set.add(handler);
  if (!listenerAttached) {
    window.addEventListener('keydown', handleKeyDown);
    listenerAttached = true;
  }
  return () => {
    if (handlersById.get(id) !== set) return;
    set.delete(handler);
    if (set.size === 0) handlersById.delete(id);
    if (handlersById.size === 0 && listenerAttached) {
      window.removeEventListener('keydown', handleKeyDown);
      listenerAttached = false;
    }
  };
}

export function listHotkeys(): HotkeyEntry[] {
  return HOTKEY_DEFS.map((def) => ({
    ...def,
    active: (handlersById.get(def.id)?.size ?? 0) > 0,
  }));
}
