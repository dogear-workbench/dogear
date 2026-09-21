---
step: 1
title: hotkey registry 与设置快捷键 tab
status: done
---

## 目标

全局快捷键统一定义为数据（registry），组件从 registry 取定义绑定，设置页新增「快捷键」tab 自动渲染清单；迁移现有 Ctrl+F / Ctrl+\，预留 Ctrl+Alt+N（Step 3 接线）。

## 依赖上下文（接力棒输入）

- 无前置 step。现状：快捷键散落手写——`components/agent-chat/AgentChat.tsx:332`（Ctrl+F 搜索浮条）、`components/notes/NotesPanel.tsx:174`（Ctrl+\ 笔记面板），无注册中心
- 设置页 tab 结构参考 `app/settings/page.tsx`（现有 AbilityTab / SubAgentTab / WorkspaceManagementTab / AboutTab 的注册方式）

## 计划改动

- [x] 新建 `lib/hotkey-registry.ts`：条目 `{ id, combo, description, scope }` + 注册函数 `registerHotkey(def): () => void`（内部完成 window keydown 绑定/解绑，返回清理函数供 useEffect 用）+ `listHotkeys()` 供设置页读取；同 combo 注册时 console.warn
- [x] combo 判定统一 `ctrlKey || metaKey`（与现有两处一致），key 大小写不敏感
- [x] `AgentChat.tsx:332` Ctrl+F 迁移到 registry（保留原行为，effect 换成调用注册函数）
- [x] `NotesPanel.tsx:174` Ctrl+\ 迁移到 registry
- [x] registry 预定义 `quick-chat-new`（Ctrl+Alt+N，description「新建临时会话」），Step 3 在入口组件接线；本 step 先允许注册一个「无 handler」的展示条目（或 handler 由后续步骤补，清单先行）
- [x] 新建 `app/settings/ShortcutsTab.tsx`：按 scope 分组渲染 id/键位/描述，只读
- [x] `app/settings/page.tsx` 注册新 tab（名称「快捷键」）
- [x] `bun run lint` + 手动验收

## 验收

- [x] Ctrl+F 在会话内唤起搜索浮条、Ctrl+\ 唤起笔记面板，行为与迁移前一致（回归）
- [x] 设置页出现「快捷键」tab，清单含 Ctrl+F / Ctrl+\ / Ctrl+Alt+N，键位与实际一致
- [x] 移除任一组件挂载后快捷键解绑无泄漏（切换 tab 后不误触发）

## 实施回填（做完后填）

### 实际改动

改动文件清单：

- 新建 `lib/hotkey-registry.ts`：`HOTKEY_DEFS` 静态定义（chat-search / notes-toggle-list / quick-chat-new 三条）+ `registerHotkey(id, handler): () => void` + `listHotkeys(): HotkeyEntry[]`
- 新建 `app/settings/ShortcutsTab.tsx`：按 scope 分组只读清单（kbd 键位徽标 + 描述 + id）
- `components/agent-chat/AgentChat.tsx`：Ctrl+F effect 换成 `registerHotkey('chat-search', ...)`（imports 增 1 行）
- `components/notes/NotesPanel.tsx`：删 `handlePanelKeyDown` 与根 div `onKeyDown`，改为 `registerHotkey('notes-toggle-list', ...)`，handler 内判断 `isActive`
- `app/settings/page.tsx`：注册「快捷键」tab（位于「子会话派遣」与「关于」之间）

与计划差异：

1. **registerHotkey 签名收窄为 `(id, handler)`**：定义从静态 `HOTKEY_DEFS` 取，调用方只传 id + handler（原计划写 `registerHotkey(def)`）；无 handler 条目 = 只在 `HOTKEY_DEFS` 中定义、无人注册，`listHotkeys()` 通过 `active` 字段区分
2. **同 combo console.warn 收窄为「跨 id 冲突」**：主窗口多会话 tab 的 AgentChat 常驻挂载（切 display 不卸载），同 id 多实例注册是常态，按原语义会持续告警；现只在**不同 id** 的 combo 规范化后相同时 warn
3. **window keydown 用共享单 listener + 引用计数**（而非每次注册各挂一个）：首个注册时挂上，最后一个解绑时移除，语义与计划等价且避免多 AgentChat 下的 listener 膨胀
4. **NotesPanel 的 Ctrl+\ handler 内加 `isActive` 判断**：原实现绑在面板 div 的 onKeyDown（焦点在面板内才触发），迁 window 级后若不判断，笔记 tab 未激活时按键会改变后台面板状态；NotesPanel 主窗口常驻挂载、独立笔记窗口 session-store 初始 activeTabId 即 NOTES_TAB_ID（isActive 恒 true），故该判断仅收敛主窗口行为、不影响独立窗口
5. Ctrl+\ 触发面从「焦点在面板内」放宽为「笔记 tab 可见」（含面板外焦点），属迁移到 window 级的自然语义变化，已按验收「切换 tab 后不误触发」标准收敛

### 给下一步的接力棒

关键签名 / 数据结构：

```ts
// lib/hotkey-registry.ts
interface HotkeyDef { id: string; combo: string; description: string; scope: string }
interface HotkeyEntry extends HotkeyDef { active: boolean }
const HOTKEY_DEFS: readonly HotkeyDef[]  // chat-search(Ctrl+F/会话) / notes-toggle-list(Ctrl+\/笔记) / quick-chat-new(Ctrl+Alt+N/全局)
registerHotkey(id: string, handler: (e: KeyboardEvent) => void): () => void  // 返回清理函数供 useEffect；匹配且有 handler 时统一 preventDefault
listHotkeys(): HotkeyEntry[]
```

combo 解析规则：`+` 分段、末段为 key（小写比对），ctrl 与 meta 等价（`ctrlKey || metaKey`），alt/shift 按段严格匹配；新快捷键只需在 `HOTKEY_DEFS` 加条目 + 组件里 `registerHotkey`。

下个 step 该从哪里继续：

- Step 3 接线 Ctrl+Alt+N：入口组件 `registerHotkey('quick-chat-new', handler)` 即自动出现在设置页清单（无需改 ShortcutsTab）；handler 需自建临时会话 + 切换 activeTabId
- 快捷键 id `quick-chat-new` 已占位，勿换名

待办或已知限制：

- Windows 欧洲键盘布局下 Ctrl+Alt = AltGr，Ctrl+Alt+N 可能与字符输入冲突（Electron 常见 trade-off，未处理）
- 设置页为 overlay，打开时 AgentChat/NotesPanel 仍挂载，快捷键仍激活（现状行为，未改动）
- 手动验收项（lint/tsc 已过，运行时行为需 `bun run dev` 验证）：Ctrl+F / Ctrl+\ 回归、设置页清单展示、弹独立笔记窗口后主窗口 Ctrl+\ 失效
