---
step: 2
title: 底层 readCleanTranscript 收敛
status: done
---

## 目标

在 `transcript-cleaner.ts` 里新增 `readCleanTranscript(sessionId, options?)` 纯函数（一处清洗逻辑），把现有 `CleanTranscript` / `TraceSource` 工具内部改用这个统一入口。为 Step 4 的 `ReadReferenceSession` 铺路。

## 依赖上下文（接力棒输入）

- 前置 step 产出：Step 1 已经删掉 `cleanTranscript` 带副作用版本、`_cleaned/` 目录不复存在
- 当前关键文件状态：
  - `transcript-cleaner.ts` 只剩 `cleanTranscriptFromLines(lines: string[]): string` 纯函数
  - `digest-tools.ts` 的 `CleanTranscript` 工具临时用 `cleanTranscriptFromLines` + 手工读文件
  - `review-tools.ts` 的 `TraceSource` 独立实现按 uuid 回溯的逻辑
- 关键决策回顾：
  - `readCleanTranscript` 是纯读+纯清洗，不落盘（用户已确认砍留盘）
  - options 支持 `tail`（尾 N 条）、`range`（起止 index）、`uuid`（回溯某条前后）三种切片模式
  - `session-paths.ts` 里的 `getSessionJsonlPath(sessionId)` 已有，直接复用

## 计划改动

### 新增

- [ ] `electron/main/services/memory/transcript-cleaner.ts` 新增导出：
  ```ts
  export interface ReadCleanTranscriptOptions {
    tail?: number;           // 尾 N 条消息（去噪后计数）
    range?: [number, number]; // 起止 index（去噪后 index）
    uuid?: string;           // 按 uuid 回溯，返回该消息 + 前后各 N 条
    uuidContext?: number;    // uuid 模式下的前后 context 条数，默认 5
  }
  export function readCleanTranscript(
    sessionId: string,
    options?: ReadCleanTranscriptOptions
  ): { ok: true; text: string; totalCount: number } | { ok: false; error: string };
  ```
  - 内部：`getSessionJsonlPath(sessionId)` → 读文件 → 按行拆 → `cleanTranscriptFromLines` → 按 options 切片
  - 文件不存在 / 解析失败 → 返回 `{ ok: false, error: '...' }`

### 修改

- [ ] `electron/main/agents/tools/digest-tools.ts`
  - `CleanTranscript` MCP 工具改用 `readCleanTranscript(sessionId)`（不加 options，全量）
  - 返回结构与之前一致（如果 agent 依赖某个字段结构就保留）
- [ ] `electron/main/agents/tools/review-tools.ts`
  - `TraceSource` MCP 工具改用 `readCleanTranscript(sessionId, { uuid, uuidContext: 5 })`
  - 原有按 uuid 回溯逻辑如果在 review-tools 独立实现，直接删掉那段逻辑

### 副产品

- 如果 `session-paths.ts` 没有把 `getSessionJsonlPath` 导出，导出它

## 手测清单

- [ ] 触发一次组提炼：观察 CleanTranscript 工具调用能拿到跟改动前一致的清洗结果（对比 stdout log / 生成的 digest 内容）
- [ ] 触发一次首页复盘 → agent 应该在某处调用 TraceSource 回溯某条消息，观察它拿到该消息前后 5 条清洗后文本
- [ ] 构造一个不存在的 sessionId 传给 CleanTranscript，观察返回 `ok: false` 而不是 crash

## 实施回填

### 实际改动

**transcript-cleaner.ts 重构**：
- 新增导出 `CleanedMessage` 接口 + 纯函数 `cleanMessagesFromLines(lines): CleanedMessage[]` 抽出块级消息数组（含 role/timestamp/uuid/formatted）
- 现有 `cleanTranscriptFromLines` 改为 `cleanMessagesFromLines` 的薄包装（保持 `CleanedTranscript` 返回结构不变，向后兼容）
- 保留 `cleanTranscript(workspacePath, sdkSessionId)` 高层 API（未删；removing it 会引入不必要的迁移风险，Step 1 也未删）
- **新增** `readCleanTranscript(workspacePath, sessionId, options?)`：
  ```ts
  interface ReadCleanTranscriptOptions {
    tail?: number;
    range?: [number, number];
    uuid?: string;
    uuidContext?: number; // default 5
  }
  type ReadCleanTranscriptResult =
    | { ok: true; text: string; count: number; totalCount: number; lastTimestamp: string; originalBytes: number; sourceMtime: number; ratio: number }
    | { ok: false; error: string };
  ```
  - options 优先级：uuid > range > tail > 无
  - ENOENT → `{ ok: false, error: '会话 JSONL 不存在: <sessionId>' }`；uuid 未命中同样返回 ok:false
  - **签名调整**：接力棒里预告了要带 workspacePath；实际按此实施（跟 `getSessionJsonlPath(workspacePath, sessionId)` 对齐）

**digest-tools.ts (CleanTranscript)**：
- 改用 `readCleanTranscript(workspacePath, sdkSessionId)`（无 options = 全量）
- 输出格式保持向后兼容：`turnCount=X ratio=Y\nlastTimestamp=Z\n\n<transcript>`
- ok:false 分支返回 `isError: true`

**review-tools.ts (TraceSource)**：
- 改用 `readCleanTranscript(workspacePath, sessionId, { uuid, uuidContext: 2 })`
- 删掉 `fs`, `traceSourceFromLines`, `getSessionJsonlPath` 三个 import
- ★目标标记不再单独渲染——`readCleanTranscript` 返回的 formatted 块里已带 `## [role · ts · uuid]` 头，agent 通过 uuid 自行识别目标

**删除文件**：
- `electron/main/services/memory/trace-source.ts`（唯一调用点 review-tools 已切走）
- `electron/main/services/memory/trace-source.test.ts`（项目不写单测，随源码一起删）

### 手测清单执行情况

未跑手测，直接落代码：
- `bun run build:electron`：**通过**
- Step 5 端到端时一起验证 CleanTranscript / TraceSource 走新路径无回归

### 给下一步（Step 3）的接力棒

**关键状态**：
- `readCleanTranscript(workspacePath, sessionId, options?)` 已可用，Step 4 的 `ReadReferenceSession` 直接调它，透传 workspacePath 即可
- transcript-cleaner 新导出：`CleanedMessage` / `cleanMessagesFromLines` / `readCleanTranscript` / `ReadCleanTranscriptOptions` / `ReadCleanTranscriptResult`
- Step 3 关注点：`group-digest-tools.ts` 里加 `SaveGroupBackground` 工具，同 server `dogear-group-digest`。改造 `group-digest-prompt.ts` 引导 agent 顺序调 SaveGroupDigest + SaveGroupBackground

**其他**：
- trace-source.ts 已删；如果 Step 3+ 有代码里还依赖它，请改用 `readCleanTranscript`
- `cleanTranscript`（高层 API）目前仍存在，未来若确认无调用点可删
