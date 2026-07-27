---
step: 2
title: 工具定义中立化
status: pending
---

## 目标

把阶段一涉及的 22 个工具从「直接返回 `createSdkMcpServer`」改成「先产出中立 `ToolDef[]`，由适配器决定注册成什么」。**本步旧引擎继续走 `toSdkServer`，运行行为零变化**，是一个独立可交付、即使 pi 后续走不通也不需要回滚的改动。

## 依赖上下文（接力棒输入）

**来自 step1**：pi 版本号、`z.toJSONSchema()` 是否被 pi 接受（决定 `toPiTools` 里 schema 那段怎么写）、错误语义转换的确切写法。开工前读 step1 的「给下一步的接力棒」一节。

**现状**：每个工具文件的形状都一样（以 `tools/group-digest-tools.ts` 为例）：

```ts
registerTools([{ name, description, server, category }, ...]);   // 文件顶部，元数据注册，不动

export function createGroupDigestTools(workspaceId, workspacePath, groupId, dirtyConversations, onDigestSaved?, onBackgroundSaved?) {
  return createSdkMcpServer({
    name: 'dogear-group-digest',
    version: '1.0.0',
    tools: [ tool('ReadGroupDigest', '...', { groupId: z.string() }, async (args) => {...}), ... ],
  });
}
```

工厂函数带闭包参数（workspaceId / groupId / 回调等），中立化后这个闭包结构保持不变。

**本步涉及的 6 个文件 / 22 个工具**：

| 文件 | server 名 | 工具 | 主会话是否也在用 |
|---|---|---|---|
| `tools/group-digest-tools.ts:40` | `dogear-group-digest` | ReadGroupDigest / SaveGroupDigest / SaveGroupBackground | 否 |
| `tools/digest-tools.ts:27` | `dogear-memory-digest` | CleanTranscript | 否 |
| `tools/group-tools.ts:12` | `dogear-group` | ListGroupFiles / ReadGroupFile / WriteGroupFile | **是** ⚠️ |
| `tools/review-tools.ts` | `dogear-memory-review` | ListDigests / ReadDigest / TraceSource / ReadReport / WriteReport | 否 |
| `tools/memory-tools.ts:50` | `dogear-memory` | RecallMemory / SaveMemory / ForgetMemory / GetCoreProfile / UpdateCoreProfile | **是** ⚠️ |
| `tools/category-tools.ts:94` | `dogear-smart-category` | ListCategories / SaveCategoryJoin / SaveCategoryNew / SaveCategoryMerge / PruneCategoryTags | 否 |

⚠️ 标记的两个文件主会话也在用，`toSdkServer` 的产物必须与改造前**完全一致**。`createMemoryTools` 还带 `opts?: { autonomous?: boolean }`，会切换 SaveMemory 的 description 文案，注意保留。

## 计划改动

### 1. 新建 `electron/main/agents/pi/tool-adapter.ts`

```ts
export type ToolResult = { content: Array<{ type: 'text'; text: string }>; isError?: boolean };

export interface ToolDef<S extends z.ZodType = z.ZodType> {
  name: string;
  description: string;
  schema: S;
  handler: (args: z.infer<S>) => Promise<ToolResult>;
}

export function toSdkServer(name: string, version: string, defs: ToolDef[]): ReturnType<typeof createSdkMcpServer>;
export function toPiTools(defs: ToolDef[]): AgentTool[];
```

- `toSdkServer`：内部 `defs.map(d => tool(d.name, d.description, d.schema.shape ?? d.schema, d.handler))`。注意 SDK 的 `tool()` 第三参收的是 **zod shape 对象**（`{ groupId: z.string() }`）而不是 `z.object(...)`，中立化时 `ToolDef.schema` 统一用 `z.object({...})`，`toSdkServer` 负责取 `.shape` 还原。
- `toPiTools`：`parameters` 用 `z.toJSONSchema(d.schema)`（或 step1 核实后的兜底写法）；`execute` 包一层——调 `d.handler`，若返回 `isError: true` 则 `throw new Error(拼接的 content 文本)`，否则返回 pi 的 `{ content }`。

### 2. 逐个文件改造（每改一个就 build 一次）

顺序按风险从低到高，主会话共用的两个放最后：

- [ ] `tools/digest-tools.ts`（1 个工具，最简单，当模板）
- [ ] `tools/group-digest-tools.ts`（3 个）
- [ ] `tools/review-tools.ts`（5 个）
- [ ] `tools/category-tools.ts`（5 个）
- [ ] `tools/group-tools.ts`（3 个）⚠️ 主会话共用
- [ ] `tools/memory-tools.ts`（5 个）⚠️ 主会话共用

每个文件的改法：

```ts
// 新增：中立定义工厂
export function createXxxToolDefs(...原来的闭包参数): ToolDef[] {
  return [ { name, description, schema: z.object({...}), handler: async (args) => {...} }, ... ];
}

// 原工厂改为薄壳，签名和返回类型不变
export function createXxxTools(...同样的参数) {
  return toSdkServer('dogear-xxx', '1.0.0', createXxxToolDefs(...));
}
```

**handler 函数体一个字不改**，只是从 `tool()` 的第四参搬到 `ToolDef.handler`。

- [ ] 顶部的 `registerTools([...])` 元数据注册保持原样不动。

### 3. 更新规则文档

- [ ] `.claude/rules/agent-development.md`：「工具开发」一节补充 `ToolDef` 约定——新工具写成 `ToolDef`，错误仍返回 `isError: true`（适配器负责在 pi 侧翻转成 throw），schema 用 `z.object({...})`。

## 验收

- [ ] `bun run build:electron` + `bun run lint` 通过
- [ ] 手测 A（后台链路）：对一个真实脏组触发组提炼，组卡产出与改造前一致
- [ ] 手测 B（主会话回归，⚠️ 关键）：在主会话里实际调用 `RecallMemory` / `SaveMemory` 和 `ListGroupFiles` / `WriteGroupFile`，确认工具正常、描述文案未漂移
- [ ] 设置页的工具列表（走 `client.getRegisteredTools()`）显示正常，22 个工具都在

## 实施回填（做完后填）

### 实际改动

- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒

- `ToolDef` / `toSdkServer` / `toPiTools` 的最终签名：
- 各文件新导出的 `createXxxToolDefs` 签名清单（step3/step4 直接调这些）：
- schema 转换实际走的路径（`z.toJSONSchema` 还是兜底）：
- 改造中发现的与预期不符的地方：
