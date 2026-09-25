# 网页 AI 站点切换器收进 tab 标签项 设计

**日期**：2026-09-25
**状态**：已确认

## 背景

网页 AI tab 页内顶部有一条 42px 站点切换横排（Globe + 全部站点按钮），占一整排。用户希望省掉这排：切换器挪到 tab 标签项上，页面内容占满全 tab。

关键约束：页面内容是原生 WebContentsView，浮于一切 DOM 之上——切换控件必须在 view bounds 之外；WebAiPanel 已有 Radix 弹层遮挡自动隐藏 view 的链路（detectOverlay），弹菜单场景零新机制。

## 目标

- 删掉 WebAiPanel 顶部横排，网页内容占满全 tab
- 站点切换收进 WorkspaceTabBar 的网页 AI tab 项：显示当前站点名 + 小箭头弹菜单
- 站点被删兜底行为与现状等价，且不引入「tab 未开却后台起 embedded tab」

## 架构

**核心做法**（用户已拍板方案 A）：

1. `stores/session-store.ts` 加 `webAiSelectedSiteId: string | null` 内存态 + setter，与 `webAiTabOpen` 同族（不落盘，刷新即收起；不新建 store）。
2. 新建 `components/webai/WebAiSiteMenu.tsx`：shadcn DropdownMenu 站点菜单（Radix，带 `data-radix-popper-content-wrapper`，天然走 overlay 隐藏链路），当前站点高亮。
3. WorkspaceTabBar 网页 AI tab 项改造：Globe 图标 + 当前站点名（title「网页 AI」）+ ChevronDown 小箭头（stopPropagation，点箭头只弹菜单）+ 原有 hover 关闭 X。点 tab 主体照常仅激活。
4. WebAiPanel 删顶部横排与站点按钮；保留挂载恢复（getWebAiState 有 state 恢复、null 按选中站点 openWebAiSite）。

**排除的选项**：

- 横排压成单个 Select（方案 B）：仍占一排，未满足核心诉求
- 每站点一个 tab（方案 C）：与单哨兵 tab 模型（WEB_AI_TAB_ID / 主进程单例）冲突，改造面最大
- 站点被删主动同步 store：改为读取处归一化（见数据流），更省且避开后台起 embedded tab 的坑

## 模块边界

- `stores/session-store.ts` — 加 webAiSelectedSiteId + setter（内存态，同 webAiTabOpen 模式）
- `components/webai/WebAiSiteMenu.tsx` — 新建：站点菜单（订阅 settings.webAiSites + store 选中态 + client.openWebAiSite）
- `components/WorkspaceTabBar.tsx` — 网页 AI tab 项接入菜单与当前站点名
- `components/webai/WebAiPanel.tsx` — 删横排；selectedSiteId 改读 store；兜底导航 effect 保留在组件内（挂载中才跑）
- **不动**：主进程 webai.ts 五路由、settings schema、数据中心面板

## 数据流

- **读取归一化**：`resolveSelectedSite(sites, selectedId)` —— selectedId 不在列表 → 第一项。菜单高亮、tab 项显示、恢复打开统一走它；store 里的过期 id 无需主动清理。
- **选站点**（菜单点击）：写 store + `client.openWebAiSite` + `switchTab(WEB_AI_TAB_ID)`（在别的 tab 上选也切过去）。
- **站点被删**：WebAiPanel 兜底 effect（挂在组件内 = embedded tab 活着才导航）→ 归一化第一项 + openWebAiSite；tab 未开时仅读取归一化生效，不触碰主进程。
- **弹层遮挡**：网页 AI tab 激活时弹菜单 → WebAiSurface detectOverlay 检测到 Radix 弹层 → reportWebAiOverlay 隐藏 view → 菜单关闭自动恢复（既有链路）。

## 错误处理 / 边界情况

- openWebAiSite / getWebAiState 失败：console.error 维持现状；失败时按归一化第一项落地本地显示
- 站点列表为空：resolveSites 已兜底 DEFAULT_WEB_AI_SITES，不变
- tab 项宽度：只显示站点名（如「DeepSeek」），不拼「网页 AI ·」前缀，避免 tab 栏挤压

## 未决问题

无——实施时若发现 overlay 链路对 DropdownMenu 属性不匹配（shadcn 版本差异），以实测为准在组件上加 data 属性适配。
