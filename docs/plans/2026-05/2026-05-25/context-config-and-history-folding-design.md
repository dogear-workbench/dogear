# 模型上下文配置 + 历史折叠性能优化 设计文档

> 日期：2026-05-25
> 涉及：方案 3（1M 长上下文勾选）、方案 4C（compact_boundary 折叠真实释放 DOM）
> 状态：设计稿，待执行

---

## 一、背景与目标

### 问题来源

1. **自动压缩触发过早** —— SDK 默认压缩窗口偏小，长会话还没说几轮就被压缩，浪费了 Opus 4.7 / Sonnet 4.6 原生 1M 上下文能力
2. **长会话页面卡顿** —— Vibe coding 时单轮可能产生上百条工具块/代码块，DOM 全量挂载时滚动/输入明显延迟
3. **现有"折叠历史"形同虚设** —— `AgentChat.tsx:309-345` 已实现 compact_boundary 折叠 UI，但折叠态只是 `opacity-70` 包了一层 div，**DOM 完全没卸载**，无任何性能收益

### 目标

| 目标 | 衡量标准 |
|---|---|
| 模型可启用 1M 压缩阈值 | 每个 ModelProfile 一个勾选；勾选后压缩阈值 = 900K token |
| 长会话不卡 | 折叠历史段后 DOM 节点数显著下降，滚动 60fps |
| 折叠机制智能化 | 用户继续对话时自动重新折叠旧段；搜索命中折叠段能自动展开 |
| 不破坏现有特性 | sticky 用户消息、Ctrl+F 搜索高亮、Minimap 跳转、compact 边界视觉分隔继续工作 |

---

## 二、调研结论

### 2.1 1M 上下文窗口已原生支持，beta 已退役

证据：`claude_code_doc_md/sdk-^0.2.119/Agent SDK 参考 - TypeScript.md:2342`

> The `context-1m-2025-08-07` beta is retired as of April 30, 2026. Passing this value with Claude Sonnet 4.5 or Sonnet 4 has no effect... To use a 1M-token context window, migrate to **Claude Sonnet 4.6, Claude Opus 4.6, or Claude Opus 4.7**, which include 1M context at standard pricing with **no beta header required**.

含义（今天 2026-05-25，距退役 25 天）：
- Opus 4.7 / Opus 4.6 / Sonnet 4.6 → **原生 1M，无需任何 beta header / `[1m]` 后缀**
- Sonnet 4.5 / Sonnet 4 → 卡死 200K，无升级路径
- `[1m]` 后缀是 Claude Code CLI 针对 Bedrock/Vertex/Foundry 第三方部署的 ID 后缀约定，与 Agent SDK 无关；本项目直连 API 不需要

**结论**：只需控制"什么时候触发自动压缩"，上下文大小完全由 model 字段决定，不需要任何额外注入。

### 2.2 Agent SDK 暴露的压缩相关入参

证据：`node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts`

| 字段 | 行号 | 类型 | 说明 |
|---|---|---|---|
| `autoCompactEnabled` | 5346 | `boolean` | 是否启用自动压缩 |
| `autoCompactWindow` | 5156 | `number` | 自动压缩窗口（token 数）|
| `betas` | 1375 | `SdkBeta[]` | 仅 `'context-1m-2025-08-07'`，已退役 |

Messages API 的 `compact_20260112` / `trigger` / `pause_after_compaction` / `instructions` 是**服务端压缩**，Agent SDK 未暴露，本次不做。

### 2.3 ModelProfile 当前结构

证据：`types/settings.ts:10-22`

```typescript
export interface ModelProfile {
  id: string;
  name: string;
  apiKey: string;
  baseUrl: string;
  haikuModel: string;
  sonnetModel: string;
  opusModel: string;
  apiTimeoutMs: number;
  disableNonessentialTraffic: boolean;
}
```

### 2.4 queryOptions 接线点

证据：`electron/main/agents/query-based-session.ts:210-260`

queryOptions 构造目前已注入：`systemPrompt / env / effort / thinking / permissionMode / excludeDynamicSections / promptSuggestions / maxTurns / allowedTools / mcpServers / plugins / cwd / settingSources`

**未注入**：`autoCompactEnabled / autoCompactWindow`

### 2.5 现有折叠机制现状

证据：

- **状态 Store**：`stores/compact-collapse-store.ts` —— per-conversation 折叠状态，默认折叠
- **渲染**：`AgentChat.tsx:288-350` —— 找最后一个 boundary，切片成 `beforeCompact + boundary + afterCompact`
- **折叠态实现**：第 333 行 `<div className="opacity-70">{beforeCompact.map(renderMessage)}</div>` —— **DOM 全挂载，无性能收益**
- **Minimap 联动**：`MessageMinimap.tsx:38-93` 折叠时跳过隐藏区
- **搜索现状**：`useMessageSearch.ts:50` 跳过 `isCompactBoundary` 自身，但**不跳过 boundary 之前的消息**——折叠后 DOM 不存在，命中后 `scrollToMessage` 找不到 `data-message-id` 元素，跳转失败

### 2.6 多个 compact_boundary 的处理

当前只关注**最后一个** boundary（`reduce` 累计），中间 boundary 之间的消息不会被分段。

> **决策**：保持只看"最后一个 boundary 之前"作为折叠点，YAGNI——长会话压缩多次的场景少见。日后真有需求再扩展。

---

## 三、方案 3 设计：1M 长上下文勾选

### 3.1 数据模型

**`types/settings.ts:ModelProfile`** 追加一个可选字段：

```typescript
export interface ModelProfile {
  // ...现有字段

  /** 启用 1M 长上下文模式：自动压缩阈值设为 900K token。默认 false。 */
  enable1MContext?: boolean;
}
```

**为什么不暴露 `autoCompactEnabled` 开关**：关掉自动压缩会让长会话直接爆窗报错，没人会想关，UI 上不出现这个选项。

**为什么阈值写死 900K**：1M 总上下文 - 900K 压缩触发 = 100K 缓冲，留给最后几轮 messages 完成压缩，避免用户发个长 message 直接撞顶。这是工程经验值，不暴露给用户调（YAGNI）。

### 3.2 UI（settings page profile 编辑器）

在 `app/settings/page.tsx` 当前 profile 表单（约 504-580 行）的"API 超时时间"字段下方新增一行：

```
☑ 启用 1M 长上下文模式
   仅 Claude Opus 4.6+ / Sonnet 4.6 原生支持 1M 上下文，其他模型勾选可能撞模型上限报错
```

**交互**：
- 单个 checkbox，无额外输入框
- 下方小灰字提示（`text-xs text-muted-foreground`）说明适用范围

### 3.3 主进程接线

在 `query-based-session.ts:210-260` 的 queryOptions 构造里追加：

```typescript
const profile = baseConfig.activeProfile;
queryOptions.autoCompactEnabled = true;
if (profile.enable1MContext) {
  queryOptions.autoCompactWindow = 900_000;
}
```

就 4 行。不勾选时 `autoCompactWindow` 完全不传，让 SDK 走默认。

### 3.4 兼容性

老 settings.json 没有 `enable1MContext` 字段 → 推断为 `false`，走 SDK 默认。读时推断，不做迁移。

### 3.5 风险

| 风险 | 缓解 |
|---|---|
| 用户在 Sonnet 4.5 等老模型上勾选 1M | 模型撞 200K 上限报错，用户自行排查；小灰字已提示 |
| 用户改了勾选但当前会话已在跑 | 不热生效；下次新对话或重启会话生效（与现有 model 切换逻辑一致） |

---

## 四、方案 4C 设计：compact_boundary 折叠真实释放 DOM

### 4.1 核心思路

**当前折叠 = 视觉折叠 + DOM 不动**
**目标折叠 = DOM 真正不挂载（性能收益）+ 智能展开（搜索/跳转命中）+ 自动重新折叠（发新消息时）**

### 4.2 渲染改造

#### 4.2.1 折叠态：不渲染 beforeCompact 子树

`AgentChat.tsx:309-345` 改造：

```tsx
if (lastCompactIdx > 0) {
  const beforeCompact = messages.slice(0, lastCompactIdx);
  const compactBoundary = messages[lastCompactIdx];
  const afterCompact = messages.slice(lastCompactIdx + 1);
  return (
    <>
      {isHistoryCollapsed ? (
        // 折叠态：仅渲染按钮，beforeCompact 完全不进 React tree
        <CollapsedHistoryBanner
          count={beforeCompact.length}
          onExpand={() => conversationId && toggleCollapse(conversationId)}
        />
      ) : (
        <>
          <CollapseControlBar
            count={beforeCompact.length}
            onCollapse={() => conversationId && toggleCollapse(conversationId)}
          />
          {beforeCompact.map((msg, i) => renderMessage(msg, i))}
        </>
      )}
      {renderMessage(compactBoundary, lastCompactIdx)}
      {afterCompact.map((msg, i) => renderMessage(msg, lastCompactIdx + 1 + i))}
    </>
  );
}
```

**关键差异**：折叠态时**不再调用 `beforeCompact.map(renderMessage)`**，整段子树不挂载。

#### 4.2.2 拆分小组件

新增 `components/agent-chat/CollapsedHistoryBanner.tsx`（折叠 banner）和 `CollapseControlBar.tsx`（展开后的"再次折叠"控制条）——纯展示组件，避免 AgentChat.tsx 增重。

### 4.3 发新消息时自动收起

在 `useSendMessage.ts` 的 send 实现里，**发送成功后**调用：

```typescript
import { useCompactCollapseStore } from '@/stores/compact-collapse-store';

// 在 send 函数里：
const setCollapsed = useCompactCollapseStore.getState().setCollapsed;
if (conversationId) setCollapsed(conversationId, true);
```

**时机**：用户调用 send 一刻就强制 collapse，让旧段 DOM 立刻卸载，让新输入/新回答开始渲染时页面是最干净的状态。

**例外**：编辑重发 / 分叉操作不强制收起（用户可能正在对照旧消息）—— 需要根据 `useSendMessage` 内具体函数判断。

### 4.4 搜索命中折叠段时自动展开

`useMessageSearch.ts` 当前搜索**全量 messages**（只跳过 isMeta/isCompactBoundary 自身），所以折叠段里的命中是会被找到的。问题在 `scrollToMessage` 找不到 DOM。

**改造**：`AgentChat.tsx` 把 `search.activeMatch` 跟折叠状态关联：

```typescript
useEffect(() => {
  if (!search.activeMatch || !conversationId) return;
  // 命中的消息在折叠段（早于最后一个 boundary）→ 自动展开
  const lastBoundaryIdx = findLastBoundaryIdx(messages);
  if (search.activeMatch.messageIndex < lastBoundaryIdx && isHistoryCollapsed) {
    useCompactCollapseStore.getState().setCollapsed(conversationId, false);
    // 等 DOM 挂载后再 scroll（下一个 effect 周期）
    requestAnimationFrame(() => {
      scrollToMessage(search.activeMatch!.messageIndex, { align: 'top-third', flash: true });
    });
  }
}, [search.activeMatch, conversationId, isHistoryCollapsed]);
```

### 4.5 Minimap 跳转命中折叠段时自动展开

`MessageMinimap.tsx:48-57` 当前折叠时直接跳过隐藏区的消息——用户在 minimap 里**看不到**折叠段。

**决策**：保持现状（折叠 = 不在 minimap 显示），让 minimap 成为"当前可见区域"的导航。

> 若用户认为"折叠区也应该在 minimap 浅色显示"，未来可加一个 ghosted 段头条目，点击展开。**本次不做。**

### 4.6 多 boundary 场景

保持当前"只看最后一个 boundary"。如果一次会话有 2+ boundary，中间段会一直挂载——这是已知限制。

**未来扩展（不在本次范围）**：每段 boundary 单独折叠状态，按段头按钮控制。

### 4.7 与 React.memo / 懒渲染（方案 4A/4B）的关系

本次 4C 改造**只解决"压缩边界之前"那段历史的 DOM 卸载**。

未压缩段（即 lastCompactIdx 之后，含未压缩的整个长会话）的性能问题**本方案不覆盖**，仍依赖未来的 4A（memo）+ 4B（IntersectionObserver 懒渲染）补完。

**对用户的体验差异**：

| 会话类型 | 4C 单独 | 4C + 4A/4B |
|---|---|---|
| 短会话（无压缩） | 无改善 | 显著改善 |
| 已压缩 1+ 次的长会话 | 压缩段消失 → 大幅改善 | 全程改善 |
| 单轮百条工具调用（vibe coding 中段） | 无改善 | 显著改善 |

> **建议执行顺序**：先做 4C（改造已有机制，工作量小），再视实际效果决定是否上 4A/4B。

### 4.8 边界细节

| 情况 | 行为 |
|---|---|
| 没有任何 boundary | `lastCompactIdx === -1` → 走原"全量渲染"分支，无折叠 |
| 只有 1 个 boundary，beforeCompact 为空 | `lastCompactIdx === 0` → 不触发折叠分支（`if (lastCompactIdx > 0)`） |
| 用户折叠后切换对话再回来 | store 按 conversationId 保留状态 |
| 应用重启 | store 内存态，重启后默认折叠（符合预期） |
| 搜索命中折叠段后再切换对话 | 切对话时 search.close() 清空（已有行为） |

---

## 五、待用户确认的设计细节

1. **方案 4C 边缘**：编辑重发 / 分叉操作发送时**不强制折叠**——这个约定 OK 吗？
2. **方案 4C 搜索体验**：搜索命中折叠段时**自动展开折叠**，跳转到目标 + flash 高亮——这交互是否符合预期？还是更倾向于先在折叠 banner 上显示一个"折叠区有 3 处匹配"角标让用户主动点开？

---

## 六、执行预估（不展开实现细节，留给后续计划文档）

| 任务 | 文件改动 | 工作量 |
|---|---|---|
| 3.1 字段 | `types/settings.ts` | 2 行 |
| 3.2 UI | `app/settings/page.tsx` | 约 15 行 |
| 3.3 接线 | `query-based-session.ts` | 4 行 |
| 4.2 渲染改造 | `AgentChat.tsx` + 新增 2 文件 | 约 80 行 |
| 4.3 发消息自动折叠 | `useSendMessage.ts` | 5 行 |
| 4.4 搜索自动展开 | `AgentChat.tsx` 新增 effect | 约 20 行 |

总计约 125 行净改动，新增 2 个小组件文件。
