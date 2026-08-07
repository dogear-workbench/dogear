---
step: 1
title: 重写注册中心
status: done
---

## 目标
重写 `tool-registry.ts`，用 ToolGroupRegistration 替换旧的 ToolMeta + registerTools + SDK_BUILTIN_TOOLS。

## 计划改动

### `electron/main/agents/tools/tool-registry.ts`（全文重写）

旧结构（删除）：
- `ToolMeta` 接口（name/description/server/category）
- `ToolGroup` 接口（server/label/tools[]）
- `SDK_BUILTIN_TOOLS` 静态数组
- `SERVER_LABELS` 映射
- `registerTools()` / `getCustomTools()` / `getAllTools()`

新结构：
```ts
import type { ToolDef } from '../pi/tool-adapter.js';

/** 工具展示元数据（给设置页用，从 ToolDef 提取） */
interface ToolInfo {
  name: string;
  description: string;
}

/** 按分类分组后的工具列表（给设置页用） */
interface ToolGroupInfo {
  server: string;
  label: string;
  tools: ToolInfo[];
}

/** 注册条目：分类标识 + 中文名 + 工厂引用 */
interface ToolGroupRegistration {
  server: string;
  label: string;
  create: (...args: never[]) => ToolDef[];
}

const registrations: ToolGroupRegistration[] = [];

/** 注册一个工具组（在各工具文件末尾调用） */
function registerToolGroup(group: ToolGroupRegistration): void {
  // 防止重复注册（同 server 只保留第一个）
  if (!registrations.some(g => g.server === group.server)) {
    registrations.push(group);
  }
}

/** 获取所有已注册的工具组元数据（给设置页用） */
function getAllToolGroups(): ToolGroupInfo[] {
  return registrations.map(({ server, label }) => ({
    server,
    label,
    tools: [],  // 延迟到 IPC 层调工厂填充
  }));
}
```

注意事项：
- `getAllToolGroups` 只返回 server + label，tools 留空——因为带参数的工厂不能在注册中心层无参调用。IPC 层负责安全调工厂提取 name/description。
- 导出 `registerToolGroup` + `ToolGroupRegistration` 给工具文件 import。
- 导出 `registrations` 数组（或 `getRegistrations()`）给 IPC 层遍历。

### 不改的文件
- `pi/tool-adapter.ts` — Step 2 才删 toSdkServer
- 所有工具文件 — Step 2 才改

## 实施回填

### 实际改动
- `tool-registry.ts` 全文重写：删除 ToolMeta / ToolGroup / SDK_BUILTIN_TOOLS / SERVER_LABELS / registerTools / getCustomTools / getAllTools
- 新增 ToolGroupRegistration（含 placeholder 字段）/ ToolInfo / ToolGroupInfo
- 新增 registerToolGroup / getRegistrations / getAllToolGroups（内置安全调工厂逻辑）

### 给下一步的接力棒
- 导出 API：`registerToolGroup(group)` / `getRegistrations()` / `getAllToolGroups()`
- 工具文件需 import：`import { registerToolGroup } from './tool-registry.js'`
- placeholder 方案已内置在 getAllToolGroups 里，Step 3 的 IPC 层只需 `return getAllToolGroups()`
