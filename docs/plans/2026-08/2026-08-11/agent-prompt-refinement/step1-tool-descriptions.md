---
step: 1
title: 工具描述改动
status: done
---

## 目标

按"做什么+何时做"格式重写 11 个协作工具的 description，去掉参数语法、实现细节、返回格式、跨工具引用。

## 依赖上下文

- 改动清单全文：`docs/standards/tool-description-changes.md`（旧→新逐条对比）
- 编写规范：`docs/standards/tool-description-guide.md`

## 计划改动

### delegation-tools.ts（`electron/main/agents/tools/delegation-tools.ts`）

1. CreateSession — description 重写 + outputPath 参数去掉"建议"
2. CreateSessionBatch — description 重写 + outputPath 参数去掉"建议"
3. StopSession — description 重写
4. SendMessage — description 重写（SEND_MESSAGE_DESC 常量）
5. WaitForMessage — description 重写（WAIT_FOR_MESSAGE_DESC 常量）
6. ListLinkedSessions — description 微调（LIST_LINKED_DESC 常量）

### group-tools.ts（`electron/main/agents/tools/group-tools.ts`）

7. ListGroupFiles — description 重写，去掉否定式排除
8. SaveSharedNote — description 重写，去掉跨工具引用

### reference-tools.ts（`electron/main/agents/tools/reference-tools.ts`）

9. ReadReferenceSession — description 重写 + tail/rangeStart/rangeEnd 参数补充用法
10. ReadGroupBackground — description 重写
11. ListSiblingSessions — description 重写

## 验证

- `bun run build:electron` 编译通过（description 是纯字符串，不影响逻辑）
- `bun run lint` 通过

## 实施回填（做完后填）

### 实际改动
- delegation-tools.ts：6 个工具 description 全部重写（3 个常量 + 2 个内联 + 1 个微调），CreateSession/CreateSessionBatch 的 outputPath 参数 describe 去掉"建议"措辞
- group-tools.ts：ListGroupFiles / SaveSharedNote description 重写，去掉否定式排除和跨工具引用
- reference-tools.ts：3 个工具 description 重写，ReadReferenceSession 的 tail/rangeStart/rangeEnd 参数 describe 补充用法
- build:electron ✅、lint ✅ 均通过
- 计划遗漏：SendMessage 的 delivery 参数 describe 仍含"配合 WaitForMessage 使用"跨工具引用（changes 文档未列此条）

### 给下一步的接力棒
- 工具描述层已改完，Step 2 的系统提示词段不再需要重复工具边界说明
- outputPath 参数已去掉"建议"，Step 2 的子会话契约段措辞需与之配合
