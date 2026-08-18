---
step: 2
title: 内置任务提示词与工具清单 IPC
status: pending
---

## 目标

补齐 review / categorize_organize 的提示词磁盘模板能力，定义内置任务元数据（提示词模板文件 + 只读工具清单），新增 3 个 IPC 路由。完成标志：`bun run build:electron` 通过，三个新路由可读写内置任务提示词。

## 依赖上下文（接力棒输入）

- 前置 step 产出：[step1-main-model-migration.md] 主进程已切换 ScheduledTask 模型；`builtin-task-meta.ts` 已存在（含 BUILTIN_LABELS）
- 当前关键文件状态：
  - `group-digest-prompt.ts`：`DEFAULT_GROUP_DIGEST_PROMPT` 常量 + `<configDir>/group-digest-prompt.md` load（缺失播种、哨兵覆盖旧版）——机制完整，参考样板
  - `categorize-prompt.ts`：`DEFAULT_CATEGORIZE_PROMPT` + `loadCategorizePrompt/saveCategorizePrompt`——机制完整
  - `review-prompt.ts` / `organize-prompt.ts`：机制待确认（实施时先读，缺 load/save 磁盘化就按 group-digest 样板补）
- 关键决策回顾：提示词模板是全局单份（改了影响所有触发入口，有意行为）；恢复默认 = 写回 DEFAULT 常量；内置工具清单是静态展示文案，不参与执行

## 计划改动

### 1. `electron/main/services/memory/review-prompt.ts`（或 review-skill-service.ts，按实际所在）

- [ ] 确认现状：有 DEFAULT 常量？有磁盘 load/save？缺什么补什么，对齐 group-digest 样板（load 缺失播种 + save）

### 2. `electron/main/services/memory/organize-prompt.ts`

- [ ] 同上补齐 load/save 磁盘化

### 3. `electron/main/services/scheduler/builtin-task-meta.ts` — 扩展为完整元数据

- [ ] 每个 builtinId 定义：

```ts
interface BuiltinTaskMeta {
  id: BuiltinTaskId;
  label: string;                          // 组卡提炼 / 复盘报告 / 智能分类 / 分类整理
  loadPrompt: (configDir: string) => Promise<string>;
  savePrompt: (configDir: string, prompt: string) => Promise<void>;
  defaultPrompt: (configDir: string) => Promise<string>;   // 恢复默认用（重读常量）
  tools: string[];                        // 只读展示的管线工具名
}
```

- [ ] 工具清单从各管线的 prompt 前言/工具注册处整理静态数组（如 group_digest：ReadGroupDigest / CleanTranscript / SaveGroupDigest / SaveGroupBackground / ListGroupFiles）
- [ ] seed（step1 的 plan-store）改从本模块读 label，避免重复定义

### 4. `electron/main/tipc/scheduler.ts` — 三个新路由

- [ ] `getBuiltinTaskDetail`：input `{ builtinId }` → `{ prompt, tools, error? }`
- [ ] `saveBuiltinPrompt`：input `{ builtinId, prompt }` → `{ ok, error? }`（空 prompt 拒绝）
- [ ] `resetBuiltinPrompt`：input `{ builtinId }` → `{ ok, prompt, error? }`（写回默认并返回）
- [ ] builtinId 非法时返回 error，不抛异常

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
