# 浏览器面板三处体验修复 实施计划

**目标**：伴随面板浏览器 tab——地址栏常驻可手动输入 URL 直开；弹层覆盖页面视图区时临时隐藏 WebContentsView；agent 导航按智能跟随策略自动切换呈现。

**架构思路**：三个互相独立的子改动。地址栏是纯渲染层放开（后端 presentEmbeddedTab url 分支已存在）；弹层遮挡走渲染层 MutationObserver + 新 IPC 通知主进程 setVisible 切换（不动 retain 生命周期）；智能跟随在 presentation.ts 增加跟随函数，由 navigate.ts 与 fetch-page.ts 两个 agent 导航点调用。设计详见 [../browser-ux-fixes-design.md](../browser-ux-fixes-design.md)。

**涉及模块**：`components/companion/{CompanionPanel,BrowserPanel,BrowserPageView}.tsx`、`electron/main/tipc/browser.ts`、`electron/main/services/browser/embedded/{presentation,navigate,fetch-page}.ts`

## 步骤索引

- [x] [Step 1: 地址栏常驻与 URL 直开](./step1-address-bar.md) — 无 tab/无呈现时地址栏可输入，回车开新 tab 呈现
- [x] [Step 2: 弹层遮挡临时隐藏](./step2-overlay-hide.md) — Radix 弹层与视图区相交时主进程临时隐藏浏览器画面
- [x] [Step 3: agent 智能跟随](./step3-agent-follow.md) — agent 开新 tab 时呈现为空或旧 agent tab 的窗口自动跟过去

## 全局决策

- IPC 命名 `reportPageViewOverlay`，输入 `{hidden: boolean}`，从 sender 取窗口，语义「渲染层弹层遮挡页面视图区」；overlay 隐藏只 `setVisible(false)`，**不动 retain/release**，与面板收起的 bounds-null detach 通道完全分离
- 智能跟随条件：窗口呈现 tab ∈ {null, fromTabId}；跟随呈现统一 `retain(toTabId, 'companion-present')`，与用户手动呈现同生命周期
- 不跟随 readArticle/search 的 fetch tab 成功路径（静默抓取）；promote 失败页的无条件强呈现（presentRecordToCompanion）保持现状
- import 方向：navigate.ts / fetch-page.ts → presentation.ts → embedded-browser-manager.ts，不得反向（manager 不 import presentation，防环）
- UI 文案全部中文；不写注释（WHY 非显而易见时一行）
- 完成一步回填该 step 文档「实施回填」节 + plan.md 勾选；主进程改动需 `bun run build:electron` 重编译后真机验证

## 完成总结

三个 step 全部实施完毕（step1 fcbba30d / step3 ce1cef4a / step2 0e5da1b4）：
1. **地址栏常驻与 URL 直开**：无 tab / 无呈现时地址栏可输入，回车走 `presentEmbeddedTab({url, workspaceId})` 开新 tab 呈现；打字中（focus）agent 切呈现不清空 draft；顺带修好无 tab 时 hasPageView=false 的隐性缺陷
2. **弹层遮挡临时隐藏**：MutationObserver 检测 Radix 弹层（popper/dialog/alertdialog，排除 tooltip）与视图区相交，新 IPC `reportPageViewOverlay` 通知主进程 setVisible 切换；attachWithBounds 尾部守卫防 hidden 期间挂载闪现；mount 强制上报对齐 renderer 重载残留
3. **agent 智能跟随**：`followAgentNavigation` 让呈现为空或正呈现 agent 旧 tab 的面板自动跟随新 tab（retain PRESENT_HOLDER_ID 与手动呈现同生命周期）；挂点 navigate 开新 tab 分支 + fetch 失败页 promoteFetchTab

真机 GUI 验证清单（各 step 文档「验证」节）待用户在 GUI 环境确认；实施中未发现与计划冲突的技术假设。
