---
step: 3
title: 数据中心骨架与核心面板
status: done
---

## 目标
新建数据中心独立窗口（骨架 + 工作区筛选器），平移组卡（DigestsPanel）与用量（UsageTab）两个面板，落地轮询 visibilitychange 纪律；主窗口 header 加入口。

## 依赖上下文（接力棒输入）
- 前置 step 产出：[step2] 已建 `electron/main/tipc/windows.ts`（openSettingsWindow 等三 procedure 已注册进路由聚合）、`settingsChanged` 广播链路已通；窗口创建模板在 `electron/main/index.ts`（settingsWindow 实现）
- 当前关键文件状态：
  - `app/settings/page.tsx` — digests tab（`TabsContent value="digests"`，渲染 `<DigestsPanel />`）、usage tab（渲染 `<UsageTab />`）；两组件当前从 workspace-store / 自身 props 取工作区
  - `app/settings/memory/DigestsPanel.tsx` — 组卡列表 + 详情 + 单组重新提炼 + 2s 轮询 listGroupDigests（`getGroupDigestActivity`）
  - `app/settings/UsageTab.tsx` — 内层时间分页（今日/7天/30天/全部），走 getUsageStats / getUsage
  - `electron/main/tipc/digest.ts` — listGroupDigests 等组卡 RPC；`electron/main/tipc/usage.ts` — getUsageStats / getUsage
- 关键决策回顾：
  - 筛选器 = `全部 | 各工作区` Select，**默认「全部」**；面板组件 workspaceId 一律 props 传入（类型 `string | 'all'`），禁止读 workspace-store（工作区切换器只在主窗口）
  - 「不传 workspaceId = 聚合全部工作区」为后端聚合语义；现有 RPC 不满足则扩展
  - 轮询必须绑 visibilitychange（隐藏暂停、可见立即对齐）

## 计划改动

### 主进程
- [ ] `electron/main/index.ts` — `dataCenterWindow` 变量 + `createDataCenterWindow()`（1200×800，title「数据中心」，照抄模板）
- [ ] `electron/main/tipc/windows.ts` — 加 `openDataCenterWindow` procedure
- [ ] 聚合接口检查与扩展（逐个看签名，缺则改为 workspaceId 可选）：
  - `digest.ts` listGroupDigests / getGroupDigestActivity → 支持全工作区聚合（主进程遍历 workspaces.json 聚合列表）
  - `usage.ts` getUsageStats → workspaceId 可选，全部时跨工作区聚合（会话行需带 workspace 归属标识，供前端区分）
  - `workspace.ts` getAll 已有（筛选器数据源）

### 渲染层
- [ ] `app/data-center/page.tsx`（新建）— 骨架：顶部工具条（标题 + 工作区筛选 Select，数据 client.getAll，默认「全部」）+ 左侧纵向 tab（本 step 先挂「组卡」「用量」两项，后续 step 增补）+ 右侧内容区；筛选值存本地 state，切 tab 不丢失
- [ ] `hooks/use-visible-polling.ts`（新建）— 统一轮询 hook：`useVisiblePolling(fn, intervalMs)`，内部 `document.visibilitychange` 监听，hidden 停 interval、visible 立即执行一次并重启 interval
- [ ] `app/data-center/digests-panel.tsx` — 从 `app/settings/memory/DigestsPanel.tsx` 平移改造：workspaceId 改 props；轮询换 useVisiblePolling；「重新提炼」等 RPC 调用不变
- [ ] `app/data-center/usage-panel.tsx` — 从 `app/settings/UsageTab.tsx` 平移改造：workspaceId 改 props（'all' 时不传 / 传 undefined，跟随后端聚合语义）；会话行展示 workspace 名（全部模式下）
- [ ] `src/App.tsx` — 加 `/data-center` 路由
- [ ] `stores/workspace-store.ts` + `app/page.tsx` — 加 `openDataCenterWindow` 方法与 header「数据中心」按钮（icon 用 lucide `Database`）

### 设置页联动（小改，完整瘦身留 step4）
- [ ] `app/settings/page.tsx` — 本 step 不动设置页（避免半迁移态），数据中心与设置两处暂时并存同功能面板，step4 收敛

## 验收
- header「数据中心」开独立窗口；重复点击 focus；关闭即销毁（主进程变量置 null）
- 筛选器切「某工作区」组卡/用量只显示该域；「全部」显示全库
- 窗口最小化 ≥ 轮询周期后恢复：数据立即刷新一次（DevTools Network 或日志验证请求发出）
- 单组「重新提炼」在数据中心可用（与原设置页行为一致）
- `bun run build:electron` + lint 通过

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
  1. 面板额外接收 `workspaces: Workspace[]` props（页面向下传递）：组卡「重新提炼」需 workspacePath 查表、用量全部模式需逐工作区拉会话列表与展示工作区名，不读 workspace-store 的前提下由页面的筛选数据源一并供给
  2. `tsconfig.json` include 追加 `hooks/**/*.ts`（新建 hooks 目录纳入类型检查，计划未列，属必要支撑改动）
  3. 组卡列表在「全部」模式下行内追加展示工作区名（与用量行工作区名 badge 对齐，提升多域聚合可读性）
  4. `getGroupDigestActivity` 未改签名：其本身无入参全局语义，且当前渲染层无调用方（计划「缺则改」不适用）
  5. 用量面板会话列表在「全部」模式由前端逐工作区调既有 `getByWorkspaceId` 合并（未新增跨域会话聚合 RPC，避免越界改 conversations.ts）；`conversationListChanged`/`usageEntryAdded` 主进程本就广播全部窗口，事件链路直接复用
  6. 轮询错误 toast 策略：用户主动动作（读详情/重新提炼/首次加载）toast 后端文案；周期轮询静默（避免每 2s 弹 toast 刷屏）
  7. digests-panel 挂载时 useVisiblePolling 立即执行与 workspaceId 切换 effect 的立即加载会各发一次 listGroupDigests（首开窗口多一次请求，无害）
- 改动文件清单：
  - 主进程：`electron/main/index.ts`（dataCenterWindow 单例 + createDataCenterWindow 1200×800 + closeAllChildWindows 追加）、`electron/main/tipc/windows.ts`（openDataCenterWindow）、`electron/main/tipc/digest.ts`（listGroupDigests workspaceId 可选 + 聚合 + 每行带 workspaceId）、`electron/main/tipc/usage.ts`（getUsageStats workspaceId 可选 + 跨域聚合 + 每行带 workspaceId）
  - 渲染层：`app/data-center/page.tsx`（新建，骨架：标题 + 全部/各工作区筛选 Select（默认全部）+ 左侧纵向 tab 组卡/用量 + 筛选本地 state）、`hooks/use-visible-polling.ts`（新建）、`app/data-center/digests-panel.tsx`（新建，平移改造）、`app/data-center/usage-panel.tsx`（新建，平移改造）、`src/App.tsx`（/data-center 路由）、`stores/workspace-store.ts`（openDataCenterWindow）、`app/page.tsx`（header 数据中心按钮，lucide Database）、`tsconfig.json`（include hooks）
  - 设置页未动（原 DigestsPanel.tsx / UsageTab.tsx / settings/page.tsx 保持原样，并存至 step4 收敛）

### 给下一步的接力棒
- 关键签名 / 数据结构：
  - `useVisiblePolling(fn: () => void | Promise<void>, intervalMs: number): void`（hooks/use-visible-polling.ts；挂载且可见立即执行一次+起 interval，hidden 停、visible 立即执行一次并重启；fn 变化不重置计时，intervalMs 变化重启；调用方需自行处理 props 变化时的立即刷新）
  - 聚合 RPC 约定：`listGroupDigests({ workspaceId?: string })` 与 `getUsageStats({ workspaceId?: string; sinceMs: number })`，**不传 workspaceId = 全工作区聚合**，返回行一律带 `workspaceId: string` 归属标识
  - 窗口管理：`electron/main/tipc/windows.ts` 集中窗口 RPC（现有 openSettingsWindow/requestCloseSettingsWindow/forceCloseSettingsWindow/openDataCenterWindow）；index.ts `createDataCenterWindow()` 导出；数据中心无 dirty 态故无 close guard（照自选股模式）
  - data-center 页骨架：顶部 header（标题+native select 筛选）+ `Tabs orientation="vertical"`（TabsList w-36），新增面板 = 加 TabsTrigger/TabsContent + 面板组件收 `workspaceId: string | 'all'` 与 `workspaces: Workspace[]` props；设置加载由页 useEffect 触发 loadSettings（面板内 resolveModelLabel 依赖）
  - 筛选值 `workspaceId: string`（'all' 或工作区 id）存页面本地 state，切 tab 不丢；Radix Tabs 切 tab 会卸载重建面板（轮询随之停/起）
- 下个 step 该从哪里继续：step4 收敛设置页（settings/page.tsx 的 digests/usage tab 与 SmartCategoryPanel 去向、原 DigestsPanel/UsageTab 删除、设置页 tab 列表瘦身）；后续面板增补直接挂 data-center 页左侧 tab
- 待办或已知限制：
  - GUI 手动验收（开窗/focus/关闭销毁/最小化恢复刷新）需人工跑 bun run dev 确认
  - 用量「全部工作区」模式下会话列表是逐工作区并发拉取（工作区数 N 次 RPC），量大时可考虑后端聚合 RPC 优化
  - step1 遗留的 `getDetailedStatus` procedure 无调用方问题仍未清理
