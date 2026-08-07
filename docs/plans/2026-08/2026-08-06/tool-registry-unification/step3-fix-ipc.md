---
step: 3
title: 改 IPC + 设置页数据流
status: pending
---

## 目标
`getRegisteredTools` IPC 改为遍历注册中心，调工厂提取元数据，返回完整的工具分组列表。

## 依赖上下文（接力棒输入）
- Step 1 产出：`tool-registry.ts` 导出 `registrations` 数组（或 `getRegistrations()`），每条含 `{ server, label, create }`
- Step 2 产出：所有工具文件已注册到注册中心，`registerToolGroup` 在模块加载时执行

## 计划改动

### `electron/main/tipc/agent.ts` — getRegisteredTools（约 505 行）

旧实现引用了已删除的 `getAllTools()`，当前编译不通过：
```ts
getRegisteredTools: t.procedure.action(async () => {
  await import('../agents/tools/article-tools.js').catch(() => {});
  await import('../agents/tools/stock-tools.js').catch(() => {});
  await import('../agents/tools/stock-analysis-tools.js').catch(() => {});
  return getAllTools();  // ❌ 已删除
});
```

新实现——直接用 `getAllToolGroups()`（Step 1 已内置 placeholder 调工厂逻辑）：
```ts
getRegisteredTools: t.procedure.action(async () => {
  // 触发所有工具文件的模块加载（registerToolGroup 执行）
  await Promise.all([
    import('../agents/tools/memory-tools.js'),
    import('../agents/tools/article-tools.js'),
    import('../agents/tools/stock-tools.js'),
    import('../agents/tools/stock-analysis-tools.js'),
    import('../agents/tools/stock-announcement-tools.js'),
    import('../agents/tools/stock-picking-tools.js'),
    import('../agents/tools/group-tools.js'),
    import('../agents/tools/delegation-tools.js'),
    import('../agents/tools/reference-tools.js'),
    import('../agents/tools/review-tools.js'),
    import('../agents/tools/digest-tools.js'),
    import('../agents/tools/group-digest-tools.js'),
    import('../agents/tools/category-tools.js'),
  ]);
  const { getAllToolGroups } = await import('../agents/tools/tool-registry.js');
  return getAllToolGroups();
});
```

同时修正文件顶部的 import：
```diff
- import { getAllTools } from '../agents/tools/tool-registry.js';
```
删除这一行（改为函数内部动态 import）。

`getAllToolGroups()` 已在 Step 1 内置了 placeholder 调工厂 + try-catch 兜底逻辑，IPC 层不需要再写 `extractToolInfo`。

### 设置页兼容
`ToolsAndPermissionsTab.tsx` 不需要改——它收的 `ToolGroup` 接口 `{ server, label, tools: ToolInfo[] }` 结构不变。只是 tools 数据从空变成完整了。

## 实施回填

### 实际改动
（做完后填）

### 给下一步的接力棒
（做完后填）
