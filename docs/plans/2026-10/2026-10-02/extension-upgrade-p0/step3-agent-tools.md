---
step: 3
title: agent 工具 open_tab/close_tab/list_tabs
status: pending
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
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
