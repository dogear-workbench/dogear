---
step: 3
title: staged-execution skill 调整
status: pending
---

## 目标

去掉 staged-execution skill 中冗余的工具名引用，改为行为描述。保留唯一需要严格锁死的 ListLinkedSessions（子会话查父 sessionId 的操作步骤）。

## 依赖上下文

- 改动清单全文：`docs/standards/skill-staged-execution-changes.md`（逐处旧→新对比）
- Step 1 产出：工具描述已改为"做什么+何时做"
- Step 2 产出：子会话契约段已强化交付路径措辞（"交付路径"无条件写入共享区）
- 关键认知：契约段已经管了交付方式，协作段已经管了 WaitForMessage 纪律，skill 不需要重复

## 计划改动

文件：`resources/skill-templates/staged-execution/SKILL.md`

按改动清单 8 处修改：

1. **主/子分工表** — 子会话行去掉 `SaveSharedNote` / `SendMessage`，改为"把交付文档写到共享区 / 向派出会话交付结果"；禁止项去掉"没 CreateSession 工具"实现细节
2. **分派规则-默认派出** — 去掉 `CreateSession` / `SaveSharedNote` / `SendMessage` / `outputPath` 占位符；保留 `ListLinkedSessions`（子会话查 sessionId 的操作步骤）；"照抄"改为"按模板填写，N 替换为实际步骤号"
3. **分派规则-批量派出** — `CreateSessionBatch` 改为"批量派出"
4. **执行循环** — 步骤 3/4/5 去掉工具名
5. **执行循环 7a** — "读子会话产出的 stepN-delivery.md" 改为"从共享区读交付文档"
6. **验收清单** — "stepN-delivery.md 内容存在" 改为"确认共享区有交付文档"
7. **失败处理** — `SendMessage` / `StopSession` 改为行为描述
8. **反模式** — `SendMessage 疯狂指导` 改为"疯狂发消息指导"

## 验证

- 无需编译（纯 md 文件）
- 全文搜索确认工具名只在分派规则第 3 块的 ListLinkedSessions 出现一次
- 逐条对照改动清单确认无遗漏

## 实施回填（做完后填）

### 实际改动
- （待填）

### 给下一步的接力棒
- 三层改动全部完成
- 回 plan.md 打勾所有步骤，写完成总结
