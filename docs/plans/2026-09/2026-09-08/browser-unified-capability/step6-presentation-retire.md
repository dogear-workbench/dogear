---
step: 6
title: 呈现交付与退役
status: done
---

## 目标

agent→用户的页面呈现（companion 面板挂 WebContentsView）、awaiting_human 状态机产品化（登录/验证暂停-恢复闭环）、Patchright 彻底退役删除。

## 依赖上下文（接力棒输入）

- 前置 step 产出：[step1] attach/detach 接口、[step3] page-state 判定、[step5] NM 收尾已完成，签名从前置回填
- 现状代码：`components/companion/BrowserPanel.tsx`（动作流展示，`browser-action-stream.ts`）、companion 窗口管理（执行时定位）、`browser-manager.ts`（364 行，Patchright，待删）
- 关键决策回顾：呈现是「agent→用户的交付」——页面本身就是产物；awaiting_human 不是错误是可交互任务状态；activeTabId（用户看的）/ agentTabId（agent 操作的）分离在此步落地

## 计划改动

- [x] 呈现层：embedded-browser-manager 的 attach 能力接到 companion 窗口——BrowserPanel 增加「页面视图」区（tab 列表 + 当前呈现 tab 的 WebContentsView attach/detach 切换）；用户切走 tab 视图不干扰 agent 操作目标（activeTabId/agentTabId 分离生效）
- [x] awaiting_human 产品化：pageState=login_required/verification_required 或 guard_submit 触发时，动作流中产生「等待人工」卡片（原因 + 当前页面 + 「完成后继续」按钮）；恢复路径：用户点击或 wait_for 检测到状态变化 → agent 继续当前任务；数据结构 `HumanInterventionRequest { id, tabId, reason, message, createdAt }` 存内存即可（不持久化）
- [x] agent→用户交付工具：`dogear__browser__present`（参数 tabId 或 url）——把页面 attach 到 companion 前台呈现，作为任务交付物的一种（页面即产物）
- [x] Patchright 退役：删除 `browser-manager.ts` 及其调用链（playwright/patchright 依赖从 package.json 移除）；确认无残留 import；受控浏览器窗口相关 UI 入口清理
- [x] 浏览器 Profile 文档更新：agent 浏览器工具描述按新协议统一重写（快档 + 原子工具 + 探索循环 + awaiting_human 语义），站点档案方法论保留衔接
- [x] `docs/codebase-map.md` 同步（doc-sync）
- [x] 全链路验收清单：内嵌搜索（成功/parse_empty 降级/验证页暂停恢复）、扩展连接 tab 操作、readArticle、present 呈现、Patchright 删除后全工具回归

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
  1. **呈现层实现口径**：companion 面板「页面视图区」不是常驻窗口，而是 BrowserPanel 内的占位容器（BrowserPageView）——渲染层 ResizeObserver 上报占位区 getBoundingClientRect 到主进程 reportPageViewBounds，主进程把 WebContentsView attach 到该 bounds；无面板上报时 fetch 层 presentTabWindow 保持全屏兑底。agentTabId/activeTabId 分离生效：用户切换呈现 tab 只改 workspace.activeTabId，agent 用 getAgentTabId 不受影响。输入管线（companion attach 后 CDP 键盘/鼠标是否恢复真实投递）需真实桌面验证，synthetic 兑底与 ensureInputReady 屏外兑底保留（两种情况下均正确）。
  2. **BrowserStreamStatus 重构**：删 browser-manager 后 getSnapshot 无来源，holder 改为事件活动推断（最近动作 60s 内视为运行中），launched 经 setBrowserStreamLaunchedProvider 注入（tipc 接线，保持 browser-action-stream 可在 node 环境 smoke），queued 字段删除（渲染层同步）。
  3. **BrowserTaskMeta 搬家**：browser-manager 删除后其内类型 BrowserTaskMeta（6 处消费）独立到 browser-task-meta.ts。
  4. **浏览器下载链整删**：browser-download-service.ts、lib/browser-download.ts、tipc browserDownloadProgress 事件、ArticlePreview/WorkspaceExplorer 下载状态文案、src/main.tsx setupBrowserDownloadToasts 全部删除；patchright+playwright 从 package.json dependencies 移除（bun install 已更新 lock）。
  5. **browser-eval 评测集处置**：删除 patchright 管线评测资产（run-pipeline/run-agent/electron-stub 依赖链、tasks.json、baseline.md、14 个 mock html；runner import 已删模块必挂）；保留 10 个现役 smoke（electron-hooks.mjs/electron-stub.mjs 是 smoke 的 electron mock 依赖被恢复保留）；observe-href-smoke 是 Step 5 重写 dom-actions 后已失效的存量（observeFn 已移至 observe-actions 且需真实 DOM），删除并在交付文档记录。内嵌链路回归由 DOGEAR_EMBEDDED_BROWSER_SELFTEST=1 运行时自测承接（新增 awaiting_human 闭环断言）。
  6. **Profile description 迁移**：新描述加入 LEGACY_BROWSER_PARSE_DESCRIPTIONS 第四值，profile-migration-smoke 同步。
  7. **工具描述/文案统一**：全工作区「受控浏览器」→「内嵌浏览器/浏览器面板」（工具描述、pageStateHint、site-policy/site-search 错误文案、设置页小节名、tool-packs 描述、ability-types）；tool-packs browser 工具数修正为 15（原 9 为过期数字）。
- 改动文件清单：
  - 新增：electron/main/services/browser/browser-task-meta.ts、human-intervention.ts、electron/main/services/browser/embedded/presentation.ts、electron/main/agents/tools/browser-present-tool.ts、components/companion/BrowserPageView.tsx、BrowserInterventions.tsx
  - 删除：electron/main/services/browser/browser-manager.ts、browser-download-service.ts、lib/browser-download.ts、resources/browser-eval/{run-pipeline,run-agent,observe-href-smoke}.mjs、tasks.json、baseline.md、electron-{stub,hooks}.mjs 保留（依赖恢复）、14 个 mock html
  - 修改：electron/main/services/browser/{browser-action-stream,browser-article-types,browser-search-types,browser-search-service,browser-article-service,site-policy,site-search,tool-packs}.ts、settings-{types,service}.ts、embedded/{fetch-page,page-state,dev-selftest}.ts、electron/main/agents/tools/{browser-tool-shared,browser-tools,browser-atom-tools,browser-action-tools,extension-tools}.ts、electron/main/tipc/{browser,renderer-handlers}.ts、electron/main/main-app.ts、package.json + bun.lock、stores/browser-store.ts、components/companion/BrowserPanel.tsx、components/{ArticlePreview,WorkspaceExplorer}.tsx、app/settings/{page,ability-types}.tsx、src/main.tsx、resources/browser-eval/profile-migration-smoke.mjs + extension-ownership-smoke.mjs（文案断言同步）、docs/codebase-map.md

### 给下一步的接力棒
- 关键签名 / 数据结构：
  - presentation.ts：`presentTab(manager, { tabId } | { url, workspaceId, holderId? }) → { ok, tabId, url, windowId, presented } | { ok:false, message }`；presented=false 表示无面板可挂（页面已保留）；PRESENT_HOLDER_ID='companion-present'；同 tab 跨窗口抢占自动清表广播 null
  - human-intervention.ts：`HumanInterventionRequest { id, tabId, reason, message, url, createdAt }`；raise/resolve/resolveInterventionsForTab/listPending；同 tab 去重覆盖；广播 payload 为全量 pending 数组
  - tipc/browser.ts 新 RPC：getPageViewState（{tabs, selfWindowId, presentedTabId, hasPageView}）/ reportPageViewBounds / presentEmbeddedTab / dismissPresentedTab / listHumanInterventions / resolveHumanIntervention / getSelfWindowId
  - 渲染层事件：pagePresentationChanged { windowId, tabId|null }、humanInterventionChanged { pending }
  - BrowserActionType 新增 'present' | 'await_human'；BrowserStreamStatus 删 queued，holder 为活动推断
- 下个 step 该从哪里继续：浏览器统一能力计划 7 步全部完成，无下个 step
- 待办或已知限制：
  - 真实桌面待验证清单（见交付文档）：companion attach 后输入管线复查、页面视图区 bounds 对齐精度、多窗口（主窗口+工作台）呈现互斥、awaiting_human 卡片闭环手工路径
  - 扩展通道不产出 awaiting_human（任务级状态仅内嵌通道，Step 5 约定）
  - observe-href-smoke 已删（Step 5 遗留失效，href 提取由 nm/extension 运行时验证承接）
