# 系统提示词预览面板 实施计划

**目标**：在设置页新增一个只读 Tab「系统提示词」，展示 dogear 会往 agent 灌的所有「隐形系统契约段」的完整模板 + 触发条件说明，解决"用户不知道 agent 被灌了什么"的透明度问题。

**架构思路**：
- **只模板不拉运行时**——不抓当前活跃会话的实际拼接结果，避免新增 IPC 依赖会话状态。展示每段的模板全文 + "什么条件下会注入"文字说明。
- **模板同源**——把散在 `query-based-session.ts` 里硬编码的 append 段（_notes/ 引导 / 子会话交付契约）抽到 `session-append-templates.ts` 统一维护，后端注入和前端展示读同一处，避免漂移。
- **不动已可编辑的段**（defaultSystemPrompt / persona / coreProfile）——那些已有各自设置入口，这里只补"用户看不见的那些"。

**涉及模块**：
- 后端：`electron/main/agents/session-append-templates.ts`（扩充）/ `electron/main/agents/query-based-session.ts`（引用抽出的模板）/ `electron/main/agents/tool-pack-guide.ts`（暴露"生成规则"文字）/ 新建 `electron/main/tipc/system-prompt.ts`
- 前端：新建 `app/settings/SystemPromptPreviewTab.tsx` / 改 `app/settings/page.tsx` 挂 Tab
- 文档：`.claude/rules/codebase-map.md`

## 步骤索引

- [x] [Step 1: 后端模板抽取 + IPC](./step1-backend.md) — 抽 `query-based-session.ts` 里硬编码的 append 段到 session-append-templates.ts；新增 tipc 路由 `getSystemPromptSegments()` 返回结构化清单
- [ ] [Step 2: 前端 Tab + 挂载 + 文档](./step2-frontend.md) — 新建 SystemPromptPreviewTab 组件；挂到设置页；更新 codebase-map

## 全局决策

### 展示段清单（本次要覆盖的"隐形段"）

| key | 展示名 | 来源 | 类别 |
|---|---|---|---|
| `tool-pack-guide` | 可用工具类目导览 | `tool-pack-guide.ts::buildToolPackGuide` | tool-guide |
| `group-context` | 会话组上下文（模板说明） | `group-context-builder.ts::buildGroupContextPrompt` | group |
| `reference-append` | 引用历史会话提示 | `session-append-templates.ts::REFERENCE_APPEND` | reference |
| `group-append` | 组背景提示（组内非首个） | `session-append-templates.ts::groupAppendFor` | group |
| `notes-guidance` | 共享区阶段总结引导 | 抽自 `query-based-session.ts:1707-1712` | notes |
| `sub-agent-contract` | 子会话交付契约 | 抽自 `query-based-session.ts:1715-1725` | sub-agent |

**本次不做**（超出 scope）：
- `DELEGATION_APPEND`（还没实现，是另一个待决方向）
- 用户段（defaultSystemPrompt / persona / tempPrompt / coreProfile）的只读镜像

### 数据结构

```ts
// types/system-prompt.ts（新文件，同时在 electron/main/types.ts 镜像）
export interface SystemPromptSegment {
  key: string;                    // 唯一 ID，稳定不变（前端 key 用）
  label: string;                  // 展示名（中文）
  category: 'reference' | 'group' | 'notes' | 'sub-agent' | 'tool-guide';
  template: string;               // 完整模板正文（含占位符如 ${groupName}）
  triggerDescription: string;     // 什么条件下会被注入（中文，1-3 句话）
  isDynamic: boolean;             // template 里是否含运行时占位（前端展示时提示"实际值会替换"）
}
```

### 命名 & 位置约定

- 抽模板统一放 `session-append-templates.ts`（已有文件，直接扩充；不新建）
- 收集函数 `getSystemPromptSegments()` 定义在 `session-append-templates.ts` 末尾（就近维护）
- tipc 路由新建 `electron/main/tipc/system-prompt.ts`（跟 agent CRUD 无关，独立文件）
- 前端 Tab 组件 `app/settings/SystemPromptPreviewTab.tsx`（跟 PersonaTab / SubAgentTab 同级）
- Tab 在设置页导航里的位置：放在「派遣」Tab 后面（都是 agent 行为相关）

### 展示样式约定

- 每段一个 Card：标题（label）+ 类别徽章 + 触发条件说明 + 模板正文（等宽字体 `<pre>`）
- 动态段（isDynamic=true）在标题旁加一个 "动态" 徽章
- 顶部一句总说明："以下是 dogear 会自动附加到系统提示词的段落。..."
- 只读，不可编辑（本次 scope）

### 通用纪律

- 抽模板时**行为不变**——把字符串常量搬家，不改内容、不改拼装顺序
- 前后端类型定义要镜像（`types/system-prompt.ts` ↔ `electron/main/types.ts`）
- 每 step 完成后按 staged-execution 走 commit（feat/refactor/docs 类型按实际改动分辨）
