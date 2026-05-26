# 模型上下文配置 + 历史折叠性能优化 实施计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 在 ModelProfile 加入 1M 长上下文模式开关并改造 compact_boundary 折叠机制让 DOM 真正卸载

**Architecture:** 方案 3：单 checkbox 控制 `autoCompactWindow=900_000` 注入 queryOptions。方案 4C：折叠态完全不渲染 beforeCompact 子树，发新消息自动折叠，搜索命中折叠段自动展开。两个方案独立可串行执行。

**Tech Stack:** Electron + React 19 + Vite + Zustand 5 + @anthropic-ai/claude-agent-sdk + Tailwind CSS 4 + lucide-react

**设计文档：** `docs/plans/2026-05/2026-05-25/context-config-and-history-folding-design.md`

**关键背景（避免重新踩坑）：**
- `context-1m-2025-08-07` beta 已于 2026-04-30 退役。Opus 4.7 / 4.6 / Sonnet 4.6 原生 1M，**不需要 `betas` 注入或 `[1m]` 后缀**
- Agent SDK 暴露的压缩入参只有 `autoCompactEnabled` / `autoCompactWindow`，服务端压缩参数（`compact_20260112`）SDK 未暴露
- 项目不跑前端 unit test，验证靠 `bun run lint` + `bun run build:electron` + `bun run dev` 手动测

**项目规范提醒：**
- 中文回答；改动有 95% 把握再下手
- 不写大段注释；只在 WHY 非显而易见时一行
- 不留 `// TODO` 或空 stub；不做兼容代码（不保留废弃字段）
- 包管理器是 `bun`，不用 npm
- 主进程改动必须 `bun run build:electron` 才会生效

---

## Task 1: 给 ModelProfile 加 `enable1MContext` 字段

**Files:**
- Modify: `types/settings.ts:10-22`

**Step 1: 在 ModelProfile 接口末尾追加字段**

打开 `types/settings.ts`，找到第 22 行 `disableNonessentialTraffic: boolean;` 后面，把整个 interface 改成：

```typescript
export interface ModelProfile {
  id: string;
  name: string;
  apiKey: string;
  baseUrl: string;
  // 模型映射（对应 SDK 环境变量）
  haikuModel: string;    // ANTHROPIC_DEFAULT_HAIKU_MODEL
  sonnetModel: string;   // ANTHROPIC_DEFAULT_SONNET_MODEL
  opusModel: string;     // ANTHROPIC_DEFAULT_OPUS_MODEL
  // 高级配置
  apiTimeoutMs: number;                // API_TIMEOUT_MS，默认 3000000
  disableNonessentialTraffic: boolean; // CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC，默认 true
  /** 启用 1M 长上下文模式：自动压缩阈值设为 900K token。默认 false */
  enable1MContext?: boolean;
}
```

不动 `DEFAULT_SETTINGS.profiles.default`（保持没有这个字段，读时推断为 false）。

**Step 2: 类型检查**

```bash
rtk tsc --noEmit
```

Expected: 通过，没有新错误。

**Step 3: 不 commit（与 Task 2/3 合并 commit）**

---

## Task 2: 设置页 profile 编辑器加 toggle

**Files:**
- Modify: `app/settings/page.tsx:579-596`（"禁用非必要流量" toggle 之后追加新的 toggle）

**Step 1: 阅读已有 toggle 风格**

`app/settings/page.tsx:579-596` 是 `disableNonessentialTraffic` 的 toggle 实现。**必须用同样的 toggle 风格**（手写的 `inline-flex h-6 w-11` 圆形开关，不是 shadcn Switch）。

**Step 2: 在 596 行 `</button>` 关闭后、`</div>` 之前插入新的 toggle 块**

定位到第 596 行后的位置（即第 596 行 `</div>` 之前是 toggle button 的 closing tag）。在 `</div>` 之后、`{/* 底部操作 */}` 之前（约 597 行空行处），追加：

```tsx
                    <div className="flex items-center justify-between">
                      <div>
                        <label className="text-sm font-medium">启用 1M 长上下文模式</label>
                        <p className="text-xs text-muted-foreground">
                          仅 Claude Opus 4.6+ / Sonnet 4.6 原生支持 1M 上下文，其他模型勾选可能撞模型上限报错
                        </p>
                      </div>
                      <button type="button"
                        className={cn(
                          "relative inline-flex h-6 w-11 items-center rounded-full transition-colors",
                          profile.enable1MContext ? "bg-primary" : "bg-muted"
                        )}
                        onClick={() => updateProfileField(id, { enable1MContext: !profile.enable1MContext })}
                      >
                        <span className={cn(
                          "inline-block h-4 w-4 transform rounded-full bg-white transition-transform",
                          profile.enable1MContext ? "translate-x-6" : "translate-x-1"
                        )} />
                      </button>
                    </div>
```

**Step 3: 类型检查**

```bash
rtk tsc --noEmit
```

Expected: 通过，没有新错误。

**Step 4: 不 commit（与 Task 1/3 合并 commit）**

---

## Task 3: 主进程注入 autoCompactWindow

**Files:**
- Modify: `electron/main/agents/query-based-session.ts:210-260`（queryOptions 构造区）

**Step 1: 定位 queryOptions 构造代码块**

打开 `electron/main/agents/query-based-session.ts`，找到第 235-237 行 `if (appSettings.ai.promptSuggestionsEnabled !== false) { queryOptions.promptSuggestions = true; }` 之后的位置。

**Step 2: 在 promptSuggestions 注入之后、`this.currentActiveProfile = baseConfig.activeProfile;` (大约 240 行) 之前插入**

```typescript
      // 自动压缩：永远启用（关闭会爆窗），1M 模式下阈值设为 900K（留 100K 缓冲给最后几轮 messages）
      queryOptions.autoCompactEnabled = true;
      if (baseConfig.activeProfile.enable1MContext) {
        queryOptions.autoCompactWindow = 900_000;
        this.logger.info('已启用 1M 长上下文模式 (autoCompactWindow=900000)');
      }
```

**Step 3: 检查 `baseConfig.activeProfile` 类型链是否能访问到 `enable1MContext`**

由于 `types/settings.ts` 已加字段（Task 1），且主进程通过 `electron/main/types.ts` 镜像（项目约定），检查这个镜像文件：

```bash
rtk grep "enable1MContext\|ModelProfile" electron/main/types.ts
```

如果 `electron/main/types.ts` 有 ModelProfile 的镜像定义，**同步加上 `enable1MContext?: boolean` 字段**。如果它是 re-export 自 `types/settings.ts`，则无需改动。

**Step 4: 编译主进程**

```bash
rtk bun run build:electron
```

Expected: 编译成功，没有 TS 报错。

**Step 5: 合并 commit Task 1/2/3**

```bash
rtk git add types/settings.ts app/settings/page.tsx electron/main/agents/query-based-session.ts electron/main/types.ts
rtk git commit -m "$(cat <<'EOF'
feat(settings): 添加 1M 长上下文模式开关

每个 ModelProfile 新增 enable1MContext 字段，勾选后向 SDK 注入
autoCompactWindow=900000，让 Opus 4.6+ / Sonnet 4.6 原生 1M 上下文
模型充分利用窗口。autoCompactEnabled 永久开启，避免长会话爆窗。

Co-Authored-By: Claude Opus 4 <noreply@anthropic.com>
EOF
)"
```

**Step 6: 手动验证**

```bash
rtk bun run dev
```

操作：
1. 打开设置页 → 选一个 profile → 看到「启用 1M 长上下文模式」toggle
2. 切换 toggle → 保存 → 重新打开设置页 → 状态保留
3. 不勾选时：开启一个会话，检查 dev 控制台**不**出现 `已启用 1M 长上下文模式`
4. 勾选后：新开会话，看到 `已启用 1M 长上下文模式 (autoCompactWindow=900000)` 日志

Expected: 全部通过。**方案 3 完成。**

---

## Task 4: 新建 CollapsedHistoryBanner 组件

**Files:**
- Create: `components/agent-chat/CollapsedHistoryBanner.tsx`

**Step 1: 写组件**

```tsx
import { Archive } from 'lucide-react';

interface CollapsedHistoryBannerProps {
  count: number;
  onExpand: () => void;
}

export function CollapsedHistoryBanner({ count, onExpand }: CollapsedHistoryBannerProps) {
  return (
    <button
      onClick={onExpand}
      className="flex items-center gap-2 w-full px-3 py-2 my-2 rounded-lg bg-gray-50 border border-gray-200 text-xs text-gray-500 hover:bg-gray-100 hover:text-gray-700 transition-colors cursor-pointer"
    >
      <Archive size={14} />
      <span>查看 {count} 条历史消息</span>
    </button>
  );
}
```

**说明**：复制了 AgentChat.tsx:317-323 原折叠按钮的样式 1:1，保持视觉一致。

**Step 2: 类型检查**

```bash
rtk tsc --noEmit
```

Expected: 通过。

**Step 3: 不 commit（与 Task 5/6 合并）**

---

## Task 5: 新建 CollapseControlBar 组件

**Files:**
- Create: `components/agent-chat/CollapseControlBar.tsx`

**Step 1: 写组件**

```tsx
import { Archive } from 'lucide-react';

interface CollapseControlBarProps {
  count: number;
  onCollapse: () => void;
}

export function CollapseControlBar({ count, onCollapse }: CollapseControlBarProps) {
  return (
    <button
      onClick={onCollapse}
      className="flex items-center gap-2 w-full px-3 py-2 my-2 rounded-lg bg-gray-50 border border-gray-200 text-xs text-gray-500 hover:bg-gray-100 hover:text-gray-700 transition-colors cursor-pointer"
    >
      <Archive size={14} />
      <span>折叠 {count} 条历史消息</span>
    </button>
  );
}
```

**说明**：与 CollapsedHistoryBanner 文案差异为 "查看" → "折叠"，其余完全一致。两个组件分开因语义不同——一个用于展开操作，一个用于折叠操作。

**Step 2: 类型检查**

```bash
rtk tsc --noEmit
```

Expected: 通过。

**Step 3: 不 commit（与 Task 4/6 合并）**

---

## Task 6: AgentChat.tsx 改造折叠分支

**Files:**
- Modify: `components/agent-chat/AgentChat.tsx:309-345`

**Step 1: 加 import**

在 `AgentChat.tsx` 顶部 imports 区（约 1-30 行），找到 `import { useCompactCollapseStore }` 那行之后加：

```tsx
import { CollapsedHistoryBanner } from './CollapsedHistoryBanner';
import { CollapseControlBar } from './CollapseControlBar';
```

**Step 2: 移除不再需要的 Archive 图标 import（如果只在折叠区用过）**

```bash
rtk grep "Archive" C:/dogear/components/agent-chat/AgentChat.tsx
```

如果 `Archive` 只在 309-345 行折叠区被引用，把它从 lucide-react import 列表中删除。如果别处还在用，**保留**。

**Step 3: 替换 309-345 行折叠分支**

打开 `AgentChat.tsx`，定位第 309-345 行，把整个 `if (lastCompactIdx > 0)` 分支替换为：

```tsx
          if (lastCompactIdx > 0) {
            const beforeCompact = messages.slice(0, lastCompactIdx);
            const compactBoundary = messages[lastCompactIdx];
            const afterCompact = messages.slice(lastCompactIdx + 1);
            return (
              <>
                {isHistoryCollapsed ? (
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

**关键差异**：
- 折叠态时 **完全不调用 `beforeCompact.map(renderMessage)`**，旧消息 DOM 真正不挂载
- 展开态时去掉了原来的 `<div className="opacity-70">` 包裹（不需要灰显，因为是用户主动展开的）

**Step 4: 类型检查 + lint**

```bash
rtk tsc --noEmit && rtk bun run lint
```

Expected: 全部通过。

**Step 5: 合并 commit Task 4/5/6**

```bash
rtk git add components/agent-chat/CollapsedHistoryBanner.tsx components/agent-chat/CollapseControlBar.tsx components/agent-chat/AgentChat.tsx
rtk git commit -m "$(cat <<'EOF'
perf(agent-chat): 折叠 compact_boundary 历史时真正卸载 DOM

折叠态原本只是 opacity-70 包了一层 div，DOM 全挂载没有性能收益。
改为折叠时不渲染 beforeCompact 子树，长会话压缩后 DOM 节点数显著
下降。拆出 CollapsedHistoryBanner / CollapseControlBar 两个小组件
避免 AgentChat.tsx 继续膨胀。

Co-Authored-By: Claude Opus 4 <noreply@anthropic.com>
EOF
)"
```

**Step 6: 手动验证**

```bash
rtk bun run dev
```

操作：
1. 打开一个**已被压缩过**的旧会话（标志：消息列表中部有 `compact_boundary` 分隔块）
2. 默认是折叠态，看到「查看 N 条历史消息」按钮
3. 打开 DevTools → Elements，搜索任意旧消息的关键词，应**找不到** DOM 节点
4. 点击按钮展开，看到「折叠 N 条历史消息」按钮 + 完整旧消息列表
5. Elements 中能找到旧消息节点
6. 点击「折叠」按钮，旧消息 DOM 再次消失

Expected: 全部通过。

---

## Task 7: 发新消息时自动折叠

**Files:**
- Modify: `components/agent-chat/hooks/useSendMessage.ts`

**Step 1: 阅读 useSendMessage 当前结构**

```bash
rtk read C:/dogear/components/agent-chat/hooks/useSendMessage.ts
```

定位 `const handleSend = async () => {` 函数（约 302 行）。**注意 `handleFork` 和 `editMessage` 不在这次改动范围内**——按设计稿决策，编辑重发 / 分叉**不自动折叠**。

**Step 2: 加 import**

在 useSendMessage.ts 顶部 imports 区追加：

```tsx
import { useCompactCollapseStore } from '@/stores/compact-collapse-store';
```

**Step 3: 在 handleSend 内部消息发送成功后插入折叠逻辑**

定位 handleSend 函数中**消息已成功提交到 query stream 的位置**（即调用 `messageStream.next(...)` 或类似 await 之后）。在该位置插入：

```tsx
    // 发送成功后强制折叠历史，让旧 DOM 立刻卸载
    if (params.conversationId) {
      useCompactCollapseStore.getState().setCollapsed(params.conversationId, true);
    }
```

**关键点**：
- 用 `useCompactCollapseStore.getState()` 而不是 hook 调用，避免在普通函数里用 hook 触发 re-render
- 必须用 `params.conversationId`（hook 参数），不是闭包外的变量
- **不在 `handleFork` / `editMessage` 里加同样代码**

**Step 4: 类型检查**

```bash
rtk tsc --noEmit
```

Expected: 通过。

**Step 5: commit**

```bash
rtk git add components/agent-chat/hooks/useSendMessage.ts
rtk git commit -m "$(cat <<'EOF'
feat(agent-chat): 发送新消息时自动折叠 compact 历史段

发送一刻强制 collapse，让旧 DOM 立即卸载，新对话开始渲染时
页面处于最干净状态。编辑重发 / 分叉操作保留展开状态，方便
用户对照旧消息。

Co-Authored-By: Claude Opus 4 <noreply@anthropic.com>
EOF
)"
```

**Step 6: 手动验证**

```bash
rtk bun run dev
```

操作：
1. 打开已压缩的旧会话，展开历史段
2. 输入新消息发送
3. 历史段应自动折叠成 banner
4. 改用「编辑重发」按钮重发某条用户消息 → 历史段**不**应自动折叠
5. 改用分叉按钮分叉某条 assistant 消息 → 跳到新会话，**不**应自动折叠

Expected: 全部通过。

---

## Task 8: 搜索命中折叠段时自动展开

**Files:**
- Modify: `components/agent-chat/AgentChat.tsx`

**Step 1: 找到合适的插入点**

定位 AgentChat.tsx 中已有的 useEffect 列表（约 130-200 行间），找一个搜索相关的 effect 或 sessionEvents 后面。

**Step 2: 在 `useChatScroll` 解构之后、`useSessionEvents` 之前插入新 effect**

```tsx
  // 搜索命中折叠段时自动展开 + 跳转
  useEffect(() => {
    if (!search.activeMatch || !conversationId) return;
    const lastBoundaryIdx = messages.reduce(
      (acc, m, i) => m.isCompactBoundary ? i : acc, -1
    );
    if (lastBoundaryIdx > 0 && search.activeMatch.messageIndex < lastBoundaryIdx && isHistoryCollapsed) {
      useCompactCollapseStore.getState().setCollapsed(conversationId, false);
      const targetIdx = search.activeMatch.messageIndex;
      requestAnimationFrame(() => {
        scrollToMessage(targetIdx, { align: 'top', flash: true });
      });
    }
  }, [search.activeMatch, conversationId, isHistoryCollapsed, messages, scrollToMessage]);
```

**关键点**：
- 用 `search.activeMatch.messageIndex` 判断命中位置（已确认该字段存在于 `useMessageSearch.ts:7`）
- 检查 `lastBoundaryIdx > 0` 避免 `< -1` 误判
- 用 `requestAnimationFrame` 等 React 完成 commit 让 DOM 挂载后再 scroll
- `scrollToMessage` 已在 `useChatScroll` 解构里取到（line 127）

**Step 3: 类型检查**

```bash
rtk tsc --noEmit
```

Expected: 通过。

**Step 4: commit**

```bash
rtk git add components/agent-chat/AgentChat.tsx
rtk git commit -m "$(cat <<'EOF'
feat(agent-chat): 搜索命中折叠段时自动展开并跳转

useMessageSearch 仍搜全量 messages，但折叠态 DOM 不挂载导致
跳转目标找不到。新增 effect：activeMatch 命中折叠段时自动
setCollapsed(false)，等下一帧 DOM 挂载后再 scrollToMessage
+ flash 高亮。

Co-Authored-By: Claude Opus 4 <noreply@anthropic.com>
EOF
)"
```

**Step 5: 手动验证**

```bash
rtk bun run dev
```

操作：
1. 打开已压缩的旧会话，保持折叠态
2. `Ctrl+F` 打开搜索栏，输入一个**只在折叠段里**出现的关键词
3. 按 Enter 跳到第一个匹配项 → 历史段应自动展开
4. 命中消息应滚到视口顶部 + 黄色 flash 高亮
5. 继续按 Enter 在折叠段内多个匹配间跳转应正常工作

Expected: 全部通过。

---

## Task 9: 整体回归验证

**Files:** 无改动，仅验证。

**Step 1: 全量编译 + lint**

```bash
rtk tsc --noEmit && rtk bun run lint && rtk bun run build:electron
```

Expected: 全部通过。

**Step 2: 启动 dev 跑回归脚本**

```bash
rtk bun run dev
```

回归清单：
- [ ] 设置页 → profile 编辑器「启用 1M 长上下文模式」toggle 可见、可切换、保存后保留
- [ ] 不勾选 1M：新会话日志无 `已启用 1M 长上下文模式`
- [ ] 勾选 1M：新会话日志含 `已启用 1M 长上下文模式 (autoCompactWindow=900000)`
- [ ] 没有 compact_boundary 的会话：消息正常渲染，无折叠 banner
- [ ] 有 compact_boundary 的会话：默认折叠，banner 文案「查看 N 条历史消息」
- [ ] 点开折叠 → 看到「折叠 N 条历史消息」+ 旧消息列表（无 opacity-70 灰显）
- [ ] DevTools Elements：折叠态找不到旧消息 DOM 节点；展开态可见
- [ ] 发新消息（非编辑非分叉）→ 历史自动折叠
- [ ] 编辑重发 → 历史**不**折叠
- [ ] 分叉 → 历史**不**折叠（新会话独立判断）
- [ ] Ctrl+F 搜索折叠段关键词 → 自动展开 + 跳转 + flash
- [ ] sticky 用户消息、Minimap 跳转、compact 分隔线视觉表现不变

**Step 3: 全部通过则收尾，无新增 commit**

实施计划完成。

---

## 已知限制 / 未来扩展（不在本计划范围）

| 场景 | 现状 | 何时做 |
|---|---|---|
| 多个 compact_boundary（一次会话压缩 2+ 次）| 中间段一直挂载 | 长会话极少触发，等真正出现性能问题再做 |
| 折叠段在 Minimap 中显示 ghost 段头 | 不显示 | 用户实际使用后看是否有这个需求 |
| 未压缩段的渲染性能（4A memo + 4B IntersectionObserver） | 不做 | 4C 上线后看实际效果再决定 |

---

## 执行预估

| Task | 改动量 | 预计时长 |
|---|---|---|
| 1-3（方案 3） | ~25 行 | 30 分钟 |
| 4-6（4C 折叠 DOM） | ~80 行 + 2 新文件 | 45 分钟 |
| 7（自动折叠） | ~5 行 | 15 分钟 |
| 8（搜索展开） | ~15 行 | 20 分钟 |
| 9（回归） | 0 | 20 分钟 |

总计：约 2 小时。
