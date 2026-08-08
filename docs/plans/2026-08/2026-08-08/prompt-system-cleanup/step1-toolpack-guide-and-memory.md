---
step: 1
title: 砍掉工具包导览 + 修正记忆提示词
status: done
---

## 目标

删除无用的工具包导览（buildToolPackGuide），修正记忆使用规范提示词（MEMORY_GUIDANCE_APPEND），清理 memory-tools.ts 的 dead code。

## 依赖上下文（接力棒输入）

- 无前置 step，本 step 是起点
- `buildToolPackGuide` 在 `pi-session.ts:286` 注入 promptParts，同时被 `session-append-templates.ts:8` import 用于 getSystemPromptSegments 展示
- `MEMORY_GUIDANCE_APPEND` 在 `pi-session.ts:292-294` 注入（条件：主会话 + 有 workspacePath）
- `MEMORY_GUIDANCE_APPEND` 当前内容提到了主会话没有的 UpdateCoreProfile
- `memory-tools.ts:26-33` 的 saveMemoryDescription 三元分支两边完全相同

## 计划改动

### 1. 删除 buildToolPackGuide

- [ ] 删除 `electron/main/agents/tool-pack-guide.ts`
- [ ] `pi-session.ts` 删 `import { buildToolPackGuide }` 和 promptParts 中的注入行（约 line 286）
- [ ] `session-append-templates.ts` 删 `import { buildToolPackGuide }`，删 getSystemPromptSegments 中 key='tool-pack-guide' 条目

### 2. 修正 MEMORY_GUIDANCE_APPEND

当前：
```
## 记忆系统
- 只记录有长期价值的信息（稳定的偏好、重要决策、反复出现的模式），不要存一次性对话内容
- UpdateCoreProfile 是全量覆盖——调用前必须先 GetCoreProfile 拿现有内容合并后再写入
```

改为：
```
## 记忆系统
- 只记录有长期价值的信息（稳定的偏好、重要决策、反复出现的模式），不要存一次性对话内容
- 讨论用户可能已有偏好的话题时，先 RecallMemory 查一下有没有相关记忆
```

- 第二条（UpdateCoreProfile）删掉：主会话没有这个工具
- 新增第二条：补上"何时该查"的引导（之前完全缺失）

### 3. 清理 saveMemoryDescription dead code

`memory-tools.ts:26-33`：删掉无意义的三元分支，直接用一个字符串。

### 4. 验证

- `bun run build:electron` 编译通过
- `bun run lint` 通过
- grep 确认无残留 `buildToolPackGuide` 引用

## 实施回填（做完后填）

### 实际改动
- 与计划差异：无差异，完全按计划执行
- 改动文件清单：
  1. **删除** `electron/main/agents/tool-pack-guide.ts`（整个文件）
  2. **修改** `electron/main/agents/pi-session/pi-session.ts`：删 `import { buildToolPackGuide }` 和 promptParts 中的注入行
  3. **修改** `electron/main/agents/session-append-templates.ts`：删 `import { buildToolPackGuide }`、删 getSystemPromptSegments 中 `key='tool-pack-guide'` 条目、修正 MEMORY_GUIDANCE_APPEND 内容、修正 memory-guidance 条目的 triggerDescription
  4. **修改** `electron/main/agents/tools/memory-tools.ts`：删掉 saveMemoryDescription 三元分支（两边完全相同的 dead code），直接内联字符串

### 给下一步的接力棒
- 关键签名 / 数据结构：
  - `getSystemPromptSegments()` 返回数组中已无 `tool-pack-guide` 条目（从 8 条减为 7 条）
  - `MEMORY_GUIDANCE_APPEND` 第二条从 UpdateCoreProfile 引导改为 RecallMemory 引导
  - `createMemoryToolDefs` 中 `autonomous` 变量仍保留（用于 if(autonomous) 注册 GetCoreProfile/UpdateCoreProfile），仅删了 saveMemoryDescription 的三元分支
- 下个 step 该从哪里继续：session-append-templates.ts 中 REFERENCE_APPEND / groupAppendFor / MAIN_AGENT_DELEGATION_APPEND 等段仍提及具体工具名，按后续 step 的计划处理
- 待办或已知限制：
  - 预先存在的 lint error（`app/settings/AbilityTab.tsx:152` packByNameMap 未使用）与本 step 无关
  - `bun run build:electron` 编译通过，无新增 error
