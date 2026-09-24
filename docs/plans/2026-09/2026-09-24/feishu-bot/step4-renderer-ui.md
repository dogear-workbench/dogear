---
step: 4
title: 渲染层——store + 引导 UI + 控制台 + 入口
status: done
---

## 目标

飞书 Dialog（未配置显示引导、已配置显示控制台）、工具栏入口、引导文案（含精确权限名）、连接状态与 Bot 绑定联动。

## 依赖上下文（接力棒输入）

- 前置 step 产出：[step3-bot-controller.md] 的 tipc 路由全集与 renderer 事件名（`feishuConnectionStatus` / `feishuBotAutoInit` / `feishuBotBindingChanged`）
- 参照实现：`components/wechat/WechatDialog.tsx`（Dialog 骨架）、`components/wechat/BotControlPanel.tsx`（Bot 控制台）、`stores/wechat-store.ts`（状态结构）；入口按钮 `app/page.tsx:300`（微信按钮旁并列）
- 关键决策回顾：引导用外部浏览器（`shell.openExternal`——渲染层经 IPC 或既有工具方法打开外部链接，查项目内已有做法），不写死内嵌浏览器；不做消息面板

## 计划改动

- [ ] 先核对引导文案的精确权限名：webSearch 开放平台当前文档（「接收消息 im.message.receive_v1 所需权限」「机器人发消息权限」），把实际权限标识写进文案
- [ ] 新建 `stores/feishu-store.ts`：`configExists` / `connectionState` / `botStatus`（工作区/对话绑定/调试）+ 事件订阅 action
- [ ] 新建 `components/feishu/FeishuSetupGuide.tsx`：
  - 步骤文档（编号列表，写死文案）：① 打开开放平台并登录（按钮 `打开飞书开放平台`）② 创建企业自建应用 ③ 添加应用能力-机器人 ④ 权限管理-开通权限（列出核对后的权限标识，注明「勾选后发布新版本生效」）⑤ 事件与回调-选「使用长连接接收事件」+ 订阅 `im.message.receive_v1` ⑥ 创建版本并发布（可用范围含自己）⑦ 凭证与基础信息页复制 App ID / App Secret
  - 底部两个输入框（App ID / App Secret）+「测试连接」按钮：调 `feishu:testConnection`，失败按错误文案展示（含修复指引）；成功 →「保存并连接」→ `feishu:saveConfig` + `feishu:connect`
- [ ] 新建 `components/feishu/FeishuControlPanel.tsx`：连接状态徽标（connecting/connected/error + 重连按钮）+ Bot 控制台（当前工作区/对话、对话列表「使用」按钮、断开连接入口——参照 `BotControlPanel` 精简，去掉联系人/消息区）
- [ ] 新建 `components/feishu/FeishuDialog.tsx`：容器，按 `configExists` 切换 SetupGuide / ControlPanel；挂载时 `feishu:getConfig` + `feishu:getBotStatus` 初始化、订阅三个 renderer 事件
- [ ] `app/page.tsx`：微信按钮旁加飞书按钮（图标用 lucide 合适的，如 `MessageSquareMore` 或 `Send`）+ Dialog 挂载
- [ ] 验证：`bun run lint` + `bun run build` 通过；UI 走查——无凭证显示引导、粘贴后测试连接错误文案正确显示、（有凭证时）控制台状态流转

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
  1. **新增 `feishu:openPlatform` tipc 路由**（主进程 `electron/main/tipc/feishu.ts`，计划改动清单未列）：计划决策要求引导按钮用 `shell.openExternal` 打开外部浏览器，全仓 grep 确认渲染层无任何既有外部链接打开做法（无 openExternal/window.open/target=_blank），故按「渲染层经 IPC」补最小路由——input `{ url }` + `https://open.feishu.cn` 前缀白名单校验，错误返回 `{ error }`。微信零改动
  2. **三个 renderer 事件订阅放 store 文件底部**而非 Dialog：处理逻辑均为 setState/重拉状态，与 wechat-store 的 `wechatBotAutoInit` 订阅同模式，Dialog 保持纯容器（仅挂载时 `initialize()` 并行拉 getConfig + getConnectionStatus + getBotStatus，覆盖启动自动连接场景）
  3. **计划中「webSearch 核对权限标识」跳过**：主会话已核对（`im:message.p2p_msg:readonly` / `im:message:send_as_bot`），直接写入文案并注明「勾选后需发布新版本生效」
  4. **补充 `resetConfig` action + 控制台「重新配置」按钮**（计划未列）：用户跳过测试直接保存错误凭证后，ControlPanel 只有「重连」（仍失败）无法自救——error/disconnected 态显示「重新配置」，调 `feishu:clearConfig`（路由已有但原无 UI 入口）后自动切回 SetupGuide
- 改动文件清单：
  - `electron/main/tipc/feishu.ts`：+`feishu:openPlatform` 路由（见差异 1）
  - `stores/feishu-store.ts`（新建，~190 行）：状态 configExists/botName/connectionState/connectionError/botStatus + initialize/loadConfig/loadConnectionStatus/loadBotStatus/testConnection/saveAndConnect/reconnect/disconnect/botUseConversation/resetConfig + 文件底部订阅三个 renderer 事件
  - `components/feishu/FeishuSetupGuide.tsx`（新建，~230 行）：七步编号引导（① 打开开放平台按钮 ② 创建企业自建应用 ③ 添加机器人能力 ④ 权限管理两条精确权限标识 ⑤ 长连接 + 订阅 im.message.receive_v1 ⑥ 创建版本发布 ⑦ 复制凭证）+ App ID/Secret 输入 + 测试连接（内联结果展示含修复指引）+ 保存并连接
  - `components/feishu/FeishuControlPanel.tsx`（新建，~200 行）：名称 + 状态徽标（connected 绿/connecting 琥珀/error 红/disconnected 灰）+ 错误行 + 重连/断开/重新配置按钮 + 当前工作区/对话行 + 对话列表（当前项高亮 + 「使用」）+ 9 条命令参考（同微信命令集）
  - `components/feishu/FeishuDialog.tsx`（新建，~33 行）：纯容器，按 configExists 切 SetupGuide/ControlPanel，open 时 initialize
  - `app/page.tsx`：+`MessageSquareMore` 图标导入 + 飞书按钮（微信按钮旁）+ FeishuDialog 挂载，共 5 处小改
- 验证：`bun run lint` 0 error（新增文件 0 警告）+ `bun run build:electron` + `bun run build` 全部通过；UI 运行时走查待 Step 5 端到端（子会话无法起 GUI 交互）

### 给下一步的接力棒
- 关键签名 / 数据结构：
  - store 状态：`configExists: boolean` / `botName: string | null` / `connectionState: FeishuConnectionState` / `connectionError: string | null` / `botStatus: FeishuBotStatus | null`（autoInitData 结构：status{workspaceId,workspaceName,conversationId,conversationTitle,debugMode} + conversations[{index,id,title,updatedAt}]）
  - UI 流：无凭证 → SetupGuide（测试连接 → 保存并连接 → loadConfig 刷 configExists → 自动切 ControlPanel）；有凭证 → ControlPanel（重连/断开/重新配置）
  - `feishu:getBotStatus` 渲染层直接拿到 autoInitData 对象（无 data 包装，同微信）；`feishu:botUseConversation` 直接拿 `{ success, error? }`
- 下个 step 该从哪里继续：Step 5 端到端联调——真实凭证走 SetupGuide 七步 + 测试连接/保存并连接 → 飞书 App 私聊机器人发 `/help`、文本转发、卡片回复、`/ls`+`/use` 切对话（UI 对话列表同步）、断开重连；另验证启动自动连接后打开 Dialog 状态正确（initialize 主动拉取已覆盖）
- 待办或已知限制：
  - UI 运行时未走查（无真实凭证 + 无法起 GUI），Step 5 覆盖
  - 「保存并连接」不强制先测试成功（connect 自身会校验凭证，失败时 config 保留、进 ControlPanel 可「重新配置」自救）
