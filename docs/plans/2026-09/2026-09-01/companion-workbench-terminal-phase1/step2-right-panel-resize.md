---
step: 2
title: 右侧栏容器化 + 宽度记忆
status: done
---

## 目标
`app/page.tsx` 内联的右侧栏 aside 抽为 `components/companion/CompanionPanel.tsx`；支持拖拽自由调宽，每个 tab 记住各自宽度；tab 栏新增「终端」位（本步仅空态占位，内容在 Step 3）。

## 依赖上下文（接力棒输入）
- 现状：`app/page.tsx:348-390` 内联 `<aside>`，固定 `w-96`，tab 按钮手写三个（files/additional/topic），内容条件渲染 `WorkspaceExplorer` / `AdditionalFilesPanel workspaceId` / `TopicPanel workspaceId+groupId`；折叠由 `ui-store` 的 `rightPanelOpen` 控制（`app/page.tsx:33-36`，`toggleRightPanel` / `setRightPanelTab`）
- 全局决策：宽度存 localStorage（key `companion-width:{tab}`）；tab 类型扩 `'terminal'`；拖拽仅左侧边缘 handle（`cursor-col-resize`，mousedown + mousemove + mouseup，拖拽中 `user-select:none`），宽度范围 240~720px，默认 files/additional/topic 384（现 w-96）、terminal 560
- 会话独立窗口 `app/session-window/page.tsx` 也有 rightPanelOpen 引用——勘查该文件右侧栏是否与本组件同构，若同构则一并换用新组件（保持 props 注入 workspaceId/groupId 的差异），若耦合不同则本步不动并记录

## 计划改动
- [x] `stores/ui-store.ts`：`rightPanelTab` 类型加 `'terminal'`；宽度逻辑不放 store（localStorage 直接读写，组件内 useState + 持久化 effect）
- [x] 新建 `components/companion/CompanionPanel.tsx`：抽 aside + tab 栏 + 内容分发 + 左缘拖拽 handle；props `{ workspaceId, groupId }`；tab 切换时读对应 localStorage 宽度，拖拽结束时写入
- [x] `app/page.tsx`：右侧栏替换为 `<CompanionPanel />`，删除内联 aside
- [x] tab 栏四个等分按钮（文件/附加/话题/终端），终端内容先渲染空态提示（「Step 3 接入」文案不留——直接空态组件：「该会话暂无命令执行」）
- [x] `app/session-window/page.tsx` 视勘查结果同构替换或不动（回填记录）

## 验证
- 拖动左缘流畅无抖动，松手后刷新窗口宽度保持；切 tab 各自宽度恢复；折叠/展开正常
- 三个现有 tab 功能不回归（文件树浏览、附加开关、话题面板刷新）
- 会话独立窗口（若有右侧栏）行为正常

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
  - `transition-all duration-200` 改为 `transition-[width] duration-200`，且拖拽中加 `transition-none`：拖宽时 transition-all 会每帧动画导致抖动，与「拖动流畅无抖动」要求冲突；开合/切 tab 仍有 200ms 宽度过渡
  - 终端 tab 内容先建了空态版 `components/companion/TerminalPanel.tsx`（Step 3 在同文件内实现完整功能，CompanionPanel 分发处不用再动）
- 改动文件清单：
  - `stores/ui-store.ts`：`rightPanelTab` 类型 + `setRightPanelTab` 参数加 `'terminal'`
  - `components/companion/CompanionPanel.tsx`（新建）：aside + 左缘拖拽 handle + 四 tab 栏 + 内容分发 + localStorage 宽度记忆
  - `components/companion/TerminalPanel.tsx`（新建）：空态「该会话暂无命令执行」
  - `app/page.tsx`：内联 aside 替换为 `<CompanionPanel workspaceId={workspace.id} groupId={currentGroupId} />`，删除相关 import 与 selector
  - `app/session-window/page.tsx`：勘查后未动（右侧栏是 ArticlePreview 文章预览，折叠用本地 useState，与主窗口 aside 不同构）

### 给下一步的接力棒
- 关键签名 / 数据结构：`CompanionPanel({ workspaceId, groupId })`；tab 分发点在文件末尾三元链，终端分支渲染 `<TerminalPanel />`（无 props，Step 3 需要会话 id 时自行从 conversation-store/session-store 取）；`export type CompanionTab = 'files' | 'additional' | 'topic' | 'terminal'`；宽度常量 MIN 240 / MAX 720 / 默认 384（terminal 560），localStorage key `companion-width:{tab}`
- 下个 step 该从哪里继续：直接改写 `components/companion/TerminalPanel.tsx`（拉历史 + 订阅增量 + 卡片流）；step1 回填处有 RPC/事件签名
- 待办或已知限制：拖宽 handle 只在面板展开时可见（折叠后 width:0，handle 随 aside 消失，与原版行为一致）；宽度持久化仅主窗口渲染进程 localStorage（session-window 不加载本组件，无跨窗干扰）
