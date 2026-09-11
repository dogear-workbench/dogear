---
step: 3
title: 注入轻量化
status: pending
---

## 目标
开局注入从「完整状态卡」改为统一轻量头（topic + 未提炼标题 + 强指引），移除 start() 上的触发调用，会话启动回归亚秒级。

## 依赖上下文（接力棒输入）
- 前置 step 产出：[step2-read-sync.md] ensureGroupFresh 已可用，ReadGroupBackground 已读时同步
- 当前关键文件状态：`electron/main/agents/group-context-builder.ts` — 现注入「### 话题状态」完整卡四段（topic/条目/未提炼列表/指引），裁剪逻辑每类 ≤8、状态段 ≤2400 字符；`electron/main/agents/pi-session/pi-session.ts:395-400` needGroupContext 分支 `await triggerStateExtractForSessionStart(...)`
- 关键决策回顾：统一轻量头（fresh 也走此形态，不再两态）；完整卡不进 systemPrompt；裁剪逻辑随完整卡注入一起退役

## 计划改动
- [ ] `pi-session.ts` start()：移除 triggerStateExtractForSessionStart 调用（含 import 清理）
- [ ] `group-context-builder.ts`：注入模板改轻量头 = 话题一句话（topic + 确立时间）+ 未提炼会话标题列表（保留现有零模型派生与条数上限）+ 强指引「本会话属于话题 X。开局第一轮先调 dogear__ReadGroupBackground 获取话题最新状态（存在未提炼会话时会自动同步，可能需等待）；深挖某会话可 dogear__ReadReferenceSession」
- [ ] 删除完整卡注入与裁剪函数（每类 ≤8 / 2400 字符等）；未提炼为空时指引弱化为「开局先调 ReadGroupBackground」即可
- [ ] 检查 `### 话题状态（尚未初始化）` 分支（无卡时）与新轻量头形态合并统一

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
