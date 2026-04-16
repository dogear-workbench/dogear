# 思考参数/权限同步/UI 改进设计

> 日期：2026-03-06

## 需求概览

1. **思考多级控制** — UI 从开/关改为 关闭/低/中/高 四级，通过 `setMaxThinkingTokens` 映射不同值
2. **思考/权限状态同步** — UI 和后端双向一致
3. **权限 UI 双向同步** — 后端变更推送到 UI，初始状态一致
4. **思考块 UI 改进** — 灰色淡雅风格、字体调大、历史加载支持
5. **历史加载一致性** — 思考块和工具块在历史/运行时表现一致

> **注意**：当前使用 `setMaxThinkingTokens` 实现多级控制。等 SDK 未来出 `setEffort` 运行时 API 后，替换底层实现，UI 不用变。

---

## 1. 思考多级控制

### 现状

- 当前：大脑图标开/关，硬编码 `setMaxThinkingTokens(2000/0)`
- SDK 已弃用此 API，但运行时仍可用，是目前唯一的运行时 setter

### 设计

**Token 映射表**：

| UI 等级 | `maxThinkingTokens` | 说明 |
|---------|---------------------|------|
| 关闭 | `0` | 禁用思考 |
| 低 | `2000` | 快速回复 |
| 中 | `6000` | 适度思考 |
| 高 | `10000` | 深度推理（默认） |

**queryOptions 初始化**（会话创建时）：

```typescript
// query-based-session.ts - start() 中
queryOptions.thinking = { type: 'adaptive' };
// 不设 effort，由 setMaxThinkingTokens 在运行时控制思考深度
```

运行时用已有的 `setMaxThinkingTokens` IPC 接口，无需新增。

---

## 2. 思考控制 UI

### 设计

大脑图标改为下拉菜单按钮，四个等级：

```
[🧠 ▼]  ←  点击弹出下拉
├─ 关闭
├─ 低
├─ 中
└─ 高 ✓  ← 默认
```

**交互**：
- 选择后立即调用 `client.setMaxThinkingTokens({ sessionId, maxThinkingTokens: value })`
- 按钮颜色随等级变化：关闭=灰色，低/中/高=蓝色（深浅区分）
- 会话未创建时也可选择，创建时传初始值

---

## 3. 权限 UI 双向同步

### 现状问题

1. UI 初始值硬编码，不从后端读取 → 与 `queryOptions.permissionMode: 'default'` 不一致
2. 后端权限变更（SDK hook 等）不通知前端

### 设计

**3.1 初始状态同步**

创建会话时，后端返回实际的 permissionMode：

```typescript
// tipc/agent.ts createQueryBasedSession 返回值增加
return {
  sessionId,
  permissionMode: 'default',  // 新增：返回初始权限模式
};

// AgentChat.tsx 创建会话后
const result = await client.createQueryBasedSession({ ... });
setPermissionMode(result.permissionMode);
```

**3.2 运行时双向同步**

新增 renderer event：`permissionModeChanged`

```typescript
// renderer-handlers.ts 增加
permissionModeChanged: (payload: { sessionId: string; mode: PermissionMode }) => void;
```

后端 `setPermissionMode` 成功后发射事件：

```typescript
// query-based-session.ts
async setPermissionMode(mode: PermissionMode): Promise<void> {
  await this.query.setPermissionMode(mode);
  this.emit('permissionModeChanged', { mode });  // 新增
}
```

IPC 层监听并转发到 renderer：

```typescript
// tipc/agent.ts - 创建 session 后注册监听
session.on('permissionModeChanged', ({ mode }) => {
  emitToRenderer('permissionModeChanged', { sessionId, mode });
});
```

前端监听：

```typescript
// AgentChat.tsx
useEffect(() => {
  return client.on('permissionModeChanged', ({ sessionId: sid, mode }) => {
    if (sid === sessionId) {
      setPermissionMode(mode);
    }
  });
}, [sessionId]);
```

---

## 4. 思考块 UI 改进

### 4.1 样式调整（灰色淡雅风）

当前：`purple-200/50/100/500/700` + `text-xs`
改为：`gray-200/50/100/500/600` + `text-sm`

```tsx
function ThinkingBlock({ block }: { block: ContentBlock }) {
  const [isOpen, setIsOpen] = useState(false);
  const hasContent = !!block.content;

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <div className="rounded-lg border border-gray-200 bg-gray-50/50">
        <CollapsibleTrigger className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-gray-100 transition-colors cursor-pointer">
          <ChevronRight
            className={`w-3.5 h-3.5 text-gray-400 transition-transform duration-200 ${
              isOpen ? 'rotate-90' : ''
            }`}
          />
          {!hasContent ? (
            <div className="w-2 h-2 bg-gray-400 rounded-full animate-pulse" />
          ) : (
            <Brain size={14} className="text-gray-500" />
          )}
          <span className="text-sm text-gray-600">
            {hasContent ? '已思考' : '思考中...'}
          </span>
        </CollapsibleTrigger>

        <CollapsibleContent>
          {hasContent && (
            <div className="px-3 pb-3">
              <div className="border-t border-gray-200 pt-2">
                <div className="text-sm text-gray-600 whitespace-pre-wrap bg-gray-100/50 rounded p-3 max-h-80 overflow-y-auto">
                  {block.content}
                </div>
              </div>
            </div>
          )}
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}
```

**关键变化**：
- `text-xs` → `text-sm`（内容区字体调大）
- 标题 `text-sm`（与正文一致但颜色更浅）
- `max-h-60` → `max-h-80`（给更多空间）
- `p-2` → `p-3`（更宽松的内边距）
- 所有 `purple-*` → `gray-*`（灰色淡雅风）
- 文案："已深度思考" → "已思考"（更简洁）

### 4.2 历史加载时处理思考块

在 `AgentChat.tsx` 的 SDK 历史加载代码中（约 line 1082），增加 `thinking` 类型处理：

```typescript
// 在 block.type === 'tool_use' 的 else if 之后增加：
else if (block.type === 'thinking') {
  blocks.push({
    type: 'thinking',
    content: block.thinking || '',
    timestamp: Date.now()
  });
}
```

这样历史消息中的 thinking 块也会被渲染为 ThinkingBlock 组件。

### 4.3 工具块历史加载状态修正

当前问题：历史加载的工具块没有明确的完成状态标记，可能导致 ToolBlock 组件显示不正确的加载状态。

**解决方案**：历史加载时，有 `toolOutput` 的工具块标记为已完成：

```typescript
blocks.push({
  type: 'tool_use',
  toolName: block.name,
  toolInput: block.input,
  toolUseId: block.id,
  toolOutput: toolOutput,
  isError: toolResult?.isError || false,
  // 历史加载的工具块，有 output 说明已完成
  status: toolOutput !== undefined ? 'completed' : 'pending',
  timestamp: Date.now()
});
```

---

## 5. 改动文件清单

| 文件 | 改动 |
|------|------|
| `electron/main/agents/query-based-session.ts` | queryOptions 添加 `thinking: adaptive`，setPermissionMode 发射事件 |
| `electron/main/tipc/agent.ts` | createSession 返回 permissionMode，监听并转发 permissionModeChanged |
| `electron/main/tipc/renderer-handlers.ts` | 新增 permissionModeChanged 事件定义 |
| `components/AgentChat.tsx` | ThinkingBlock 样式重做、大脑图标改四级下拉、权限双向同步监听、历史加载增加 thinking 块处理、工具块 status 修正、初始权限同步 |

---

## 6. 不在此次范围内

- `effort` API 替换（等 SDK 出运行时 `setEffort` 后，替换 `setMaxThinkingTokens` 底层实现，UI 不变）
- 数据库历史的 thinking 块存储（当前只有 SDK session 历史支持）
- thinking 块内容的 Markdown 渲染（目前纯文本，后续可增加）
