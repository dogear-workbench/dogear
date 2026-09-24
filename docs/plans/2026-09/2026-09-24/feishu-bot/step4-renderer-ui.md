---
step: 4
title: 渲染层——store + 引导 UI + 控制台 + 入口
status: pending
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
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
