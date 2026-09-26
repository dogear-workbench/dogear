---
step: 1
title: 微信功能整链删除
status: done
---

## 目标
微信 bot 功能（扫码登录、收发消息、联系人、ilink 服务）全链删除，只留飞书。

## 依赖上下文（接力棒输入）
- 用户拍板：微信相关功能都删，只留飞书；飞书单文件保持现状不做抽象
- 调研确认：main-app.ts 无 wechat 引用（bot 为 lazy 启动，启动链干净）
- 关键区分：文章解析的「微信公众号」平台检测（article-service detectPlatform / mp.weixin.qq.com / article-parse-tools / agent-worker 的 parse 检测 / browser-domain-names 的 wechat.com）**不是微信功能，全部保留**

## 计划改动

### A. 整文件删除（18 个）
- [ ] `app/wechat/page.tsx`
- [ ] `components/wechat/` 全目录（WechatDialog / MessagePanel / ContactList / ConnectionStatus / BotControlPanel / MessageBubble / QRCodeAuth 共 8 文件）
- [ ] `electron/main/services/wechat/` 全目录（index / markdown-filter / wechat-auth-service / wechat-bot-controller / wechat-ilink-service / wechat-message-store / wechat-poller 共 7 文件）
- [ ] `electron/main/tipc/wechat.ts`
- [ ] `stores/wechat-store.ts`
- [ ] `types/wechat.ts`

### B. 点状引用清理（8 处）
- [ ] `src/App.tsx:6,27` — 删 WechatPage import 与 `/wechat` 路由
- [ ] `electron/main/tipc/index.ts:19,55` — 删 wechatRouter import 与注册
- [ ] `electron/main/tipc/renderer-handlers.ts:99-113,170` — 删 wechatAuthStatus / wechatConnectionStatus / wechatBotBindingChanged / wechatBotAutoInit 四个事件（注意同文件里 wechat/feishu 共用的部分只删 wechat 侧；先读文件确认 4 个事件的完整块）
- [ ] `stores/conversation-store.ts:831,889` — 删 wechatBotBindingChanged 监听与 `wechat:getBotStatus` 调用（读上下文，整块删）
- [ ] `electron/main/services/conversation-runtime-service.ts:12` — RuntimeHolderType 枚举去 `'wechat-bot'`（先 grep `'wechat-bot'` 全库确认无其他消费点）
- [ ] `electron/main/agents/pi-session/workspace-paths.ts:7,21` — 删 `'wechat'` 目录键（先读文件确认该键语义；磁盘上已存在的 wechat 数据目录不动）
- [ ] `electron/main/tipc/agent.ts:32` — 修正注释（bot 状态 getter 现仅由 feishu.ts 注册）
- [ ] settings.json / 各工作区 config 若有 wechat 相关键，顺带清数据（grep `wechat` 于 settings-service / settings-types 确认代码侧无 wechat 键定义后再动数据）

### C. 数据侧
- [ ] `.dogear` 下微信消息存储 / 登录态缓存目录盘点（wechat-message-store 的落盘位置），确认后删除对应数据目录

### D. 收尾验证
- [ ] 全库 grep -i wechat 复验：剩余命中应全部属于文章解析平台检测、域名映射、或注释
- [ ] lint + 双侧 tsc + bun test + 手动启动确认飞书 bot 不受影响

## 实施回填（2026-09-26 完成）

- 实删 16 文件（components/wechat 实际 7 文件，文档预估 8 有误）；B 节 8 处点状引用全清，feishu 侧完整保留
- 计划外连带清理：agent-chat 的 `'wechat-bot'` source 死链（transformers 渲染分支 / MessageItem 图标 / types+useTranscriptState 的 source 死字段 / 2 个测试 fixture 改 injectedTag 路径）；conversation-store 的 botBoundConversationId 状态与 setBotBoundConversation（无写入方死链）；ConversationRow 的 isBotBound 图标（值恒 null）
- 数据侧：.dogear 下 wechat 目录从未落盘，settings 无 wechat 键，无需动
- 验证：lint 0 errors（91 warnings 存量）、双侧 tsc 零错误、build:electron + vite build 通过、bun test 284 pass/8 fail（git stash 基线比对确认 8 fail 全为存量环境问题，回归锚点一致）
- 遗留：①手动启动冒烟飞书 bot 未做（无 GUI），静态链路完整；②registerBotStateGetter 注册后无消费方、unregisterBotStateGetter 零调用、holders 前端零消费——非 wechat 专属未动，待后续评估
