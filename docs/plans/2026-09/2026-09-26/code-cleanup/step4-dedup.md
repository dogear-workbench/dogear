---
step: 4
title: 复用收口
status: pending
---

## 目标
消除逐字/近似重复实现，广播函数回迁收口模块。全部零行为差异。

## 依赖上下文（接力棒输入）
- 调研报告：共享区 `20260926-large-file-report.md` 第三节（R2-R6，含 diff 证据）
- R1（微信/飞书 controller 合并）已作废：微信 Step 1 删除，飞书单文件保持现状
- R2 原 4 处消费方中 wechat-bot-controller 已随 Step 1 删除，本步剩 3 处

## 计划改动

- [ ] **R2 广播收口**：`electron/main/agents/delegation-bridge.ts:90`、`electron/main/agents/model-failover.ts:63`、`electron/main/services/feishu/feishu-bot-controller.ts:363` 三处本地重实现改为 import `services/renderer-broadcast.ts`（三处调用链均主进程，无 worker 约束；若个别文件有 worker 上下文顾虑，用 `renderer-broadcast-lazy.ts` 变体——lazy 变体存在的正当理由见报告）
- [ ] **R3 safe() 合并**：新建 `electron/main/agents/tools/stock-format.ts`，`stock-tools.ts:41` 与 `stock-analysis-tools.ts:41` 改 import（本文件 Step 7 P7 会扩展，先建骨架）
- [ ] **R4 getRelativeTime 合并**：`components/WorkspaceExplorer.tsx:40` 私有副本删除，改 import `components/conversation-list/utils.ts`；`app/data-center/history-utils.ts` 变体保留（格式不同，不强行统一）
- [ ] **R5 detectPlatform 收口**：`agent-worker.ts:817` 的 wechat-only lowercase 变体删除，改动态 import article-service 的实现（agent-worker.ts:189 已有动态 import article-service 先例可照抄）；`article-service.ts:432` 内联 `url.includes('mp.weixin.qq.com')` 改调 detectPlatform（此文件 Step 6 P2 拆分后唯一实现落在 `article/fetch.ts`）
- [ ] **R6 deepEqual 双副本**：不合并（主/渲染 tsconfig 隔离，同 pi-model-catalog 先例）；在 `app/settings/page.tsx:59` 与 `electron/main/services/settings-diff.ts:39` 两处各加一行注释互相指认

## 收尾验证
- [ ] lint + 双侧 tsc + bun test
- [ ] 启动冒烟：话题归档/会话列表刷新（广播路径）、股票工具调用（safe）、工作台文件树时间显示（getRelativeTime）、文章解析微信文章（detectPlatform）
