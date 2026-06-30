---
step: 1
title: 数据基础 + 类型
status: pending
---

## 目标

把 Phase 2 所有后续步骤需要的"数据形状 + 入口签名"先就位：settings 增配置、conversation.create 支持派生子会话、outputPath claim 表、统一类型定义。本步不引入任何运行时逻辑，只让别人后续能 import 到东西。

## 依赖上下文（接力棒输入）

- 设计文档：`docs/plans/2026-06/2026-06-26/sub-conversation-delegation-design.md`（架构 / 工具家族 / 数据流）
- 全局决策：复用 `conversation.parentConversationId`，不新加字段；bridge 内存状态不持久化；outputPath claim 仅内存进程级
- 当前 `conversation-service.create(workspaceId, groupId, title, modelSelection)` 在 conversation-service.ts:238，hard-code `role:'main'`、`parentConversationId:null`、`cachePolicy:'5m'`，需要扩展
- 当前 `AppSettings` 在 `electron/main/services/settings-types.ts`，含 `ai.{defaultModelSelection,permissionMode,...}` 等

## 计划改动

### 1. `electron/main/services/settings-types.ts`
- 加 `subAgent` 字段到 `AppSettings`：
  ```ts
  subAgent: {
    modelSelection?: ModelSelection;
    permissionMode?: AppSettings['ai']['permissionMode'];  // 复用同枚举
    timeoutMinutes: number;  // 默认 30
  };
  ```
- 在 `DEFAULT_SETTINGS` 加 `subAgent: { permissionMode: 'bypassPermissions', timeoutMinutes: 30 }`
- 不加 modelSelection 的默认值（缺省时走 ai.defaultModelSelection 兜底）
- `deepMerge` 已能自动处理嵌套对象，无需特殊适配

### 2. `electron/main/services/conversation-service.ts`
- `create()` 函数签名扩展为可选 `options`：
  ```ts
  export async function create(
    workspaceId: string,
    groupId: string,
    title: string = '新对话',
    modelSelection: ModelSelection | null = null,
    options?: { role?: 'main' | 'sub'; parentConversationId?: string; cachePolicy?: '5m' | '1h' },
  ): Promise<string>
  ```
- 内部写入时：`role: options?.role ?? 'main'`，`parentConversationId: options?.parentConversationId ?? null`，`cachePolicy: options?.cachePolicy ?? '5m'`
- 现有调用方（tipc/conversations.ts 等）不动，缺省走原路径
- `ConversationCompat.parentConversationId` 已存在，确认 `toCompat()` 透传 role 字段（已有）

### 3. `electron/main/services/group-shared-service.ts`
- 模块顶层加进程级内存表：
  ```ts
  // key = `${workspaceId}:${groupId}:${relPath}`, value = childId
  const pathClaims = new Map<string, string>();
  ```
- 导出 4 个函数：
  - `claimOutputPath(workspaceId, groupId, relPath, childId): { ok: true } | { ok: false; reason: 'file_exists' | 'claimed_by_other'; holderChildId?: string }`
    - 检查共享区文件已存在（fs.access）→ `file_exists`
    - 检查 pathClaims 已被别的 childId 占用 → `claimed_by_other`
    - 否则写入 map，返回 ok
  - `releaseOutputPath(workspaceId, groupId, relPath, childId): void`（终止/完成时清，校验 holder 才清，避免误清）
  - `releaseAllByChild(childId): void`（bridge cleanup 用）
  - `isClaimed(workspaceId, groupId, relPath): boolean`（diagnostic 用）
- 注意：fs 检查用 fs.promises.access，try/catch 捕获 ENOENT

### 4. `types/delegation.ts`（新文件）
- 全部类型定义集中在这里，主进程和前端都能 import：
  ```ts
  export type ChildStatus = 'running' | 'done' | 'failed' | 'timeout' | 'cancelled' | 'no_delivery';

  export interface DelegateSpec {
    task: string;
    outputPath: string;
    title?: string;
  }

  export interface DeliveryResult {
    childId: string;
    status: ChildStatus;
    outputPath: string;
    title: string;
    summary?: string;        // SubmitDelivery 时设
    errorMessage?: string;   // failed / timeout 时设
    startedAt: number;
    finishedAt?: number;
  }

  export interface ChildStateSnapshot {
    childId: string;
    parentConversationId: string;
    groupId: string;
    outputPath: string;
    title: string;
    status: ChildStatus;
    startedAt: number;
    finishedAt?: number;
    summary?: string;
    errorMessage?: string;
  }
  ```
- 主进程镜像：`electron/main/types.ts` 末尾 re-export（按现有约定，主进程不直接 import 前端 types/）

### 5. `electron/main/types.ts`
- re-export delegation 类型（mirror）：
  ```ts
  export type {
    ChildStatus, DelegateSpec, DeliveryResult, ChildStateSnapshot,
  } from '../../types/delegation.js';  // 按当前 mirror 风格调整
  ```
- （查现有 mirror 怎么做的，照搬）

## 验证

- `bun run build:electron` 通过
- `bun run lint` 通过（零新增 warning）
- 手测：临时在 main 进程加日志，调用 `conversationService.create(ws, group, 'sub-test', null, { role:'sub', parentConversationId: 'parent-id' })`，看 conversations.json 写入字段正确。验证完删除日志
- 手测：在 group-shared-service 里临时调 `claimOutputPath(ws, group, 'foo.md', 'child1')` 两次第二次应返回 `claimed_by_other`；然后 `releaseOutputPath` 后再 claim 应成功

## 实施回填（做完后填）

### 实际改动
- 与计划差异：step doc 说主进程 mirror 用 re-export，任务 prompt 明确要求平行定义（不 re-export），按 prompt 执行。
- 改动文件清单：
  - `electron/main/services/settings-types.ts`（line 48 permissionMode 扩展，line 82-88 subAgent 字段，line 115 DEFAULT_SETTINGS.subAgent）
  - `electron/main/services/conversation-service.ts`（line 238-265 create() 签名 + 内部写入）
  - `types/delegation.ts`（新建，44 行）
  - `electron/main/types.ts`（末尾追加 ChildStatus / DelegateSpec / DeliveryResult / ChildStateSnapshot 平行定义）
  - `electron/main/services/group-shared-service.ts`（末尾追加 pathClaims + 4 函数）

### 给下一步的接力棒
- `AppSettings.subAgent` 字段确认形状：
  ```ts
  subAgent: {
    modelSelection?: ModelSelection;
    permissionMode?: 'default' | 'acceptEdits' | 'plan' | 'dontAsk' | 'bypassPermissions';
    timeoutMinutes: number;
  };
  // DEFAULT_SETTINGS: { permissionMode: 'bypassPermissions', timeoutMinutes: 30 }
  ```
- `conversation-service.create()` 最终签名：
  ```ts
  export async function create(
    workspaceId: string,
    groupId: string,
    title: string = '新对话',
    modelSelection: ModelSelection | null = null,
    options?: { role?: 'main' | 'sub'; parentConversationId?: string; cachePolicy?: '5m' | '1h' },
  ): Promise<string>
  ```
- `group-shared-service` 导出的 claim 函数完整签名：
  ```ts
  export type ClaimResult = { ok: true } | { ok: false; reason: 'file_exists' | 'claimed_by_other'; holderChildId?: string };
  export async function claimOutputPath(workspaceId: string, groupId: string, relPath: string, childId: string): Promise<ClaimResult>
  export function releaseOutputPath(workspaceId: string, groupId: string, relPath: string, childId: string): void
  export function releaseAllByChild(childId: string): void
  export function isClaimed(workspaceId: string, groupId: string, relPath: string): boolean
  ```
- `types/delegation.ts` 导出列表：`ChildStatus`（type）/ `DelegateSpec` / `DeliveryResult` / `ChildStateSnapshot`；主进程 mirror 路径：`electron/main/types.ts` 末尾平行定义（非 re-export）
- 已知坑 / 待办：`types/settings.ts`（前端类型）暂未加 `subAgent` 字段，Step 8 做设置 UI 时再加。
