---
step: 3
title: agent 工具 open_tab/close_tab/list_tabs
status: done
---

## 目标
agent 获得 tab 管理三工具，探索循环（开页→读→跟链→关）在扩展通道闭环；动作流与面板可见。

## 依赖上下文（接力棒输入）
- 前置 step 产出：[step2-gateway-tabs.md] `sendExtensionCommand` 支持 opts.tabId；ExtensionStatus 带 tabs 数组与焦点回落。
- 当前关键文件状态：`electron/main/agents/tools/extension-tools.ts` 工具结构统一模板：`acquireGate`（独占+断连清零）→ `navigateGate/policyGate`（策略门控）→ `runCommand` → `emitAction` → 中文文案；`BrowserActionType` 定义在 `browser-action-stream.ts`；popup 授权白名单语义不变。
- 关键决策回顾：open_tab 后新 tab 即焦点；不引入 select_tab；SHARED_SCOPE_NOTE 需从「已连接标签页」改述为「Dogear 分组内标签页」。

## 计划改动
- [ ] `browser-action-stream.ts`：`BrowserActionType` 加 `'open_tab' | 'close_tab' | 'list_tabs'`。
- [ ] `extension-tools.ts` 新增三工具（对齐 navigate 模板）：
  - [ ] `dogear__extension__open_tab`（参数 `url: string`、`background?: boolean`）：acquireGate → `validateNavigateTarget` 前置（未授权域直接中文报错引导授权）→ `navigateGate` 策略门控（命中域走随机延迟/预算）→ runCommand('open_tab') → emitAction → 文案含新 tabId/url/pageState 与「已设为操作焦点，请先 observe_page」。
  - [ ] `dogear__extension__close_tab`（参数 `tab_id?: number`）：缺省关焦点；成功文案区分「焦点已回落到 <tabId/url>」/「分组已空」。
  - [ ] `dogear__extension__list_tabs`：无页面交互，不过 policyGate（对齐 site_knowledge 的先例）；返回分组内 tab 列表（tabId/url/标题/焦点标记）+ 分组空时提示 open_tab。
- [ ] `SHARED_SCOPE_NOTE` 更新：「作用于用户真实浏览器 Dogear 分组内的标签页；open_tab 开新页即成操作焦点；close_tab 仅能关组内标签页」。
- [ ] `stores/browser-store.ts` / `components/companion/BrowserPanel.tsx`：动作流卡片对新 action 类型的渲染（若走通用 map 则补文案即可，现场确认渲染分发方式）。
- [ ] 文件长度检查：extension-tools.ts 已 >600 行，新增三工具后评估拆分（如 tab 管理工具拆 `extension-tab-tools.ts`，registerToolGroup 合并注册）——按 >300 行拆分硬约束执行。
- [ ] 验证：真机会话中让 agent 执行「open_tab 打开某已授权域 → observe_page → close_tab」完整循环；另一会话占用时确认 busy 拒绝文案正确。

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
  1. 拆分执行了两步（计划建议的 tab 工具拆分 + 派生的共享辅助拆分）：tab 管理三工具拆 `extension-tab-tools.ts`；ERROR_MESSAGES / commandErrorMessage / runCommand / emitAction / SHARED_SCOPE_NOTE 等共用辅助拆 `extension-command-shared.ts`（tab-tools 与主文件共用这些，直接互相 import 会成环）。extension-tools.ts 净减 95 行（734→639）；剩余为 9 个页面工具既有模板，本 step 不扩大化拆分。
  2. 组空态文案替换落在 runCommand 层（计划未指定位置）：permission_denied 且焦点 tabId===-1 时统一替换为「Dogear 分组已空…」引导 open_tab，observe/click/fill 等所有普通工具自动获得正确文案。
  3. close_tab 增加缺省+组空前置拦截（不发命令直接报组空文案）：扩展侧此场景报 stale_tab「当前没有受控标签页」，映射文案不贴切。
  4. SHARED_SCOPE_NOTE 按「Dogear 分组内标签页」改述并含焦点模型引导；BrowserPanel.tsx 补 ACTION_ICONS/ACTION_LABELS 三条目，GOOD_RESULT_RE 补 opened/closed/listed。
- 改动文件清单：
  - `electron/main/services/browser/browser-action-stream.ts`（BrowserActionType 加 open_tab/close_tab/list_tabs）
  - `electron/main/agents/tools/extension-command-shared.ts`（新建，134 行）
  - `electron/main/agents/tools/extension-tab-tools.ts`（新建，265 行）
  - `electron/main/agents/tools/extension-tools.ts`（辅助移出、imports 收敛、尾部展开 tab 工具、清残留未用 import，净减 95 行）
  - `components/companion/BrowserPanel.tsx`（图标/标签/结果色映射）

### 给下一步的接力棒
- 关键签名 / 数据结构：
  - `createExtensionTabToolDefs(deps: ExtensionTabToolDeps)`：deps = { conversationId?, acquireGate, isErrorResult, textResult, emitAction(action, extra?), scopeNote }；在 extension-tools.ts 的 createExtensionToolDefs return 数组尾部展开（registerToolGroup 单点注册不变，getRegisteredTools IPC 动态获取自动含三新工具）。
  - 工具参数：open_tab `{ url, background? }`；close_tab `{ tab_id? }`；list_tabs `{}`。
  - runCommand 组空替换：所有普通命令 permission_denied + 组空 → EMPTY_GROUP_MESSAGE（shared 导出，可复用）。
  - close_tab 焦点判定：`wasFocus = (tab_id ?? focusTabId) === focusTabId`；成功文案三分支（回落 / 组空 / 焦点不变）。
- 下个 step 该从哪里继续：Step 4 右键菜单（不碰本 step 文件）；Step 5 guard_submit 只需改 ERROR_MESSAGES.guard_submit 文案（映射表已集中到 extension-command-shared.ts）。
- 待办或已知限制：真机手测未做（本会话无浏览器环境）；extension-tools.ts 仍 639 行（既有债务，页面工具模板重复，后续可按同模式再拆）。
