---
step: 3
title: 数据中心骨架与核心面板
status: pending
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
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：useVisiblePolling 签名、聚合 RPC 的 workspaceId 可选约定、data-center 页骨架的 tab 挂载方式
- 下个 step 该从哪里继续：
- 待办或已知限制：
