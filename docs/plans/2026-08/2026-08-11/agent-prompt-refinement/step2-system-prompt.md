---
step: 2
title: 系统提示词段合并
status: pending
---

## 目标

合并"会话组上下文"+"共享区阶段总结"为一段，强化子会话交付路径措辞，消除系统提示词与 skill 的定位冲突。

## 依赖上下文

- 改动方案全文：`docs/standards/system-prompt-changes.md`
- Step 1 产出：工具描述已改为"做什么+何时做"，outputPath 参数已去掉"建议"
- 关键代码位置：
  - `electron/main/agents/group-context-builder.ts` — 组上下文段实际构建逻辑（`buildGroupContextPrompt`）
  - `electron/main/agents/session-append-templates.ts` — 段模板定义 + `subAgentContractFor` + `getSystemPromptSegments`

## 计划改动

### group-context-builder.ts

合并阶段总结引导到组上下文段：

```
当前 buildGroupContextPrompt 返回：
## 当前会话组上下文
**组**：<title>
遇到不清楚的背景，可以先看看共享区有没有相关文件（ListGroupFiles）。

改为：
## 当前会话组上下文
**组**：<title>
共享区是会话组内跨会话传递文件的区域。遇到不清楚的背景，先看看共享区有没有相关文件（ListGroupFiles）。
当某个阶段告一段落或上下文用量较高时，可以主动写一份阶段总结到共享区（SaveSharedNote），方便下次接续或组卡提炼。这不是强制——只在你判断有价值时做。
```

### session-append-templates.ts

1. **删除 NOTES_GUIDANCE_APPEND** — 内容已合并到 group-context-builder.ts
2. **修改 subAgentContractFor 交付路径措辞**：
   - `建议交付路径` → `交付路径`
   - `内容较长时先用 SaveSharedNote 写进去，SendMessage 里只放摘要` → `把完整交付内容写到共享区这个路径，SendMessage 里只放摘要通知`
3. **清理 NOTES_GUIDANCE_APPEND 的注入点** — 搜索所有引用 NOTES_GUIDANCE_APPEND 的地方，删除注入逻辑（原来是仅主会话+有工作区时注入）
4. **更新 getSystemPromptSegments()** — 删除 notes-guidance 段定义，或合并到 group-context 段说明

### 注入条件变化

原来阶段总结只注入给主会话，合并后通过 group-context-builder.ts 注入给所有有 groupId 的会话（主/子都看到）——子会话也能看到共享区写入说明。

## 验证

- `bun run build:electron` 编译通过
- 搜索确认没有遗留的 NOTES_GUIDANCE_APPEND 引用
- 设置页系统提示词预览段数正确（少了 notes-guidance 段）

## 实施回填（做完后填）

### 实际改动
- （待填）

### 给下一步的接力棒
- 系统提示词层已改完，子会话契约段已强化交付路径
- Step 3 的 skill 改动假设契约段已经说了交付方式，skill 不再重复
