# 里程碑 2 · Phase C：首页仪表盘 + 后台复盘流水线 设计

> 创建日期：2026-06-07
> 状态：设计已定，待实现
> 前置：Phase A（会话摘要卡 digest）已完成；Phase B B1（对话内复盘 skill + review-store + review-tools）已完成并实测通过
> 总规划：`../../2026-06-02/milestone-2-memory-copilot.md`（本文是其中 Phase C「首页仪表盘」的细化，并补一条 Phase B 未覆盖的「后台复盘流水线」）

---

## 一、目标与定位

Phase B 让用户在对话里说"帮我复盘"，agent 综合摘要卡产出一张「复盘卡」。但那是**为了观察复盘逻辑实际效果**而做的对话内 skill。Phase C 要做两件事：

1. **后台复盘流水线**：复盘升级为和 digest 一样的**独立后台 agent**——流程固定、headless 运行、按触发点自动跑，不必每次手动在对话里唤起。
2. **首页仪表盘**：升级 `EmptyFocusState`，开软件 / 无聚焦对话时呈现「参谋区（复盘卡）+ 我的区（速记板）」，把记忆参谋的产物"开机即见"。

对话内的复盘 skill（Phase B）**保留**，作为观察 / 手动验证手段，与后台流水线并存。

### 第一版边界（YAGNI）

- 参谋区按复盘卡的四类信号**原样渲染**，不重映射成"最近完成/下一步建议"（卡里没有的不造，守保真契约）。
- refs **不做跳原会话**（需 sessionId→conversationId 反查），v1 仅作来源计数徽章。
- 速记板是**自由 markdown**，不做结构化便签卡。
- 不接 git、不做想法状态推断（留 Phase D）。

---

## 二、核心设计决策（本轮讨论拍定）

1. **复盘 = 后台独立 agent，镜像 digest 流水线。** 流程固定、judgment 由提示词引导 agent，代码只做薄 IO + 编排。对话内 skill 是观察手段，生产路径走后台。

2. **复盘跟在 digest 后面跑。** 复盘吃的是摘要卡，必须等 digest 扫描提炼 idle 后再触发，避免吃到旧摘要。

3. **触发点三个：启动后（digest 之后）/ 夜间定时（digest 之后）/ 仪表盘手动按钮。** 手动按钮只复盘当前工作区，不必等全局 digest。

4. **复盘用独立模型档，默认强（sonnet）。** 复盘聚合全部摘要卡、判断重、有保真契约（要调 TraceSource 查证），质量优先。独立于 digest 的 haiku 默认。

5. **参谋区四类原样分组，按行动价值排序。** 悬而未决 → 未闭环 → 反复出现 → 已否决。

6. **复盘卡 / 速记板每工作区独立。** 沿用 `<configDir>/workspaces/<wsId>/`，与 digests/ 平级。

7. **复盘提示词抽公共常量，SKILL.md 与后台共用，设置页可编辑。** 消除重复，与 digest 提示词一致。

---

## 三、架构与编排

```
触发点（启动后延迟 / 夜间 03:xx / 仪表盘手动按钮）
        │
   ① digest 扫描提炼（现有，串行队列跑完）
        │  ← 复盘等 digest idle（whenDigestIdle）保证吃到最新摘要卡
        ▼
   ② review 扫描：逐工作区脏检查（review-scanner）
        │  脏条件：无复盘卡 || 最新摘要卡 createdAt > 复盘卡 reviewedAt
        ▼
   ③ review-trigger 串行队列（并发=1，去重 key=workspaceId）→ REVIEW_SESSION 任务
        ▼
   ④ worker headless query（复用 review prompt + dogear-memory-review 5 工具）
        │  模型走独立 reviewProfileId/reviewModelTier（默认 sonnet）
        ▼
   ⑤ 落 review.md（SaveReviewCard 自动写 reviewedAt/coveredCount）
        ▼
   ⑥ 首页仪表盘读卡渲染（参谋区）
```

**编排接法**：digest-trigger 的 `pump()` 当前 fire-and-forget。加 `whenDigestIdle(): Promise<void>`（队列空 + 无在跑时 resolve）。启动 / 夜间触发改为链式：

```
triggerScanAll()           // digest 入队
  .then(() => whenDigestIdle())
  .then(() => triggerReviewScan())   // review 全量脏检查入队
```

手动按钮：直接 `triggerReview(wsId, wsPath)`，不等全局 digest。

**为什么不复用 digest 队列**：payload 粒度不同（review 工作区级、digest 会话级）。按模块化约定单独建 `review-scanner.ts` + `review-trigger.ts`，与 digest 对称。

---

## 四、后端改动清单

| # | 文件 | 动作 |
|---|------|------|
| B1 | `electron/main/agents/task-types.ts` | 加 `TaskType.REVIEW_SESSION`；`ReviewSessionPayload { workspaceId, workspacePath, reviewModelTier? }` |
| B2 | `electron/main/services/memory/review-prompt.ts`（新） | 抽 `DEFAULT_REVIEW_PROMPT`（现 SKILL.md 正文步骤）+ `loadReviewPrompt/saveReviewPrompt`，播种 `<configDir>/review-prompt.md`。仿 `digest-prompt.ts` |
| B2' | `electron/main/services/memory/review-skill-service.ts` | SKILL.md 改为引用 `DEFAULT_REVIEW_PROMPT`，与后台共用一份提示词 |
| B3 | `electron/main/services/memory/review-scanner.ts`（新） | `isReviewStale(card, latestDigestCreatedAt)`（纯函数）+ `findStaleWorkspaces()` 遍历工作区比对 |
| B4 | `electron/main/services/memory/review-trigger.ts`（新） | 串行队列（并发=1）+ 去重（key=wsId）+ 活动采集；`triggerReviewScan()` / `triggerReview(wsId,wsPath)` / `getReviewActivity()`。镜像 `digest-trigger.ts` |
| B5 | `electron/main/services/memory/digest-trigger.ts` | 加 `whenDigestIdle(): Promise<void>` |
| B6 | `electron/main/agents/agent-worker.ts` | `handleReviewSessionTask`：复制 `handleDigestSessionTask` 骨架，按 `reviewProfileId`(缺省回退 activeProfile) 重建 env + `reviewModelTier`(默认 sonnet，非 haiku 才传 effort) + 挂 `createReviewMcpServer` + 五工具 allowedTools + `loadReviewPrompt`，AbortController 接 cancel。返回 `{ workspaceId, saved, tier, profileName }` |
| B6' | `electron/main/agents/tools/review-tools.ts` | `createReviewMcpServer` 加 `onSaved?: () => void` 回调参数，SaveReviewCard 成功时调用（仿 `createDigestTools` 的 saved 回调） |
| B7 | `electron/main/index.ts` | 启动 / 夜间触发点接 `whenDigestIdle → triggerReviewScan`（夜间复用现有 03:xx 定时器逻辑） |
| B8 | `electron/main/services/settings-types.ts` + `types/settings.ts` | 加 `ai.reviewProfileId?` + `ai.reviewModelTier?: 'haiku'\|'sonnet'\|'opus'`（默认 sonnet） |

---

## 五、IPC 与数据存储

### 复盘 IPC（新 `electron/main/tipc/review.ts`，镜像 digest.ts）

| 路由 | 作用 |
|------|------|
| `getReviewCard({ workspaceId })` | `readReview` → `{ card }`（可 null） |
| `triggerReview({ workspaceId, workspacePath })` | 手动入队 → `{ success }` |
| `getReviewActivity()` | 轮询在跑状态 → `{ activity }` |
| `getReviewPrompt() / setReviewPrompt({ prompt })` | 设置页编辑提示词 |
| `getReviewModelTier / setReviewModelTier` | 模型档位 |
| `getReviewProfileId / setReviewProfileId` | 模型方案 |

注册进 `tipc/index.ts`，返回类型同步 `types/electron-api.ts`。

### 速记板存储（C3「我的区」）

- 落 `<configDir>/workspaces/<wsId>/notes.md`（与 review.md 平级，复用 `getWorkspaceDataDir`）。
- 新 `electron/main/services/memory/notes-store.ts`：`readNotes(wsId)` / `saveNotes(wsId, content)`（纯 IO，自由 markdown，无结构）。
- 单独 `electron/main/tipc/notes.ts`：`getNotes({ workspaceId })` / `saveNotes({ workspaceId, content })`。速记与复盘是两条独立线，IPC 分开。

### 前端 store（新 `stores/dashboard-store.ts`）

- 复盘卡：`loadReview(wsId)` / `triggerReview()` / 轮询 activity（跑完刷新卡）。
- 速记：`loadNotes(wsId)` / `setNotesContent`（本地即时）/ 防抖 `flushNotes`（写盘）。
- UI 交互态（编辑中文本）用组件内 state，落盘走 store。

---

## 六、前端仪表盘

### 组件结构（升级 `EmptyFocusState` → 仪表盘）

```
components/dashboard/
  Dashboard.tsx          — 容器：顶部栏(工作区名 + 新建对话) + 参谋区 + 我的区，可滚动
  AdvisorSection.tsx     — 参谋区（复盘卡渲染）
  ReviewItemGroup.tsx    — 单类信号分组（标题 + 计数 + 条目列表）
  ScratchpadSection.tsx  — 我的区（markdown 速记板）
```

`app/page.tsx` / `app/session-window/page.tsx` 中原渲染 `<EmptyFocusState>` 处换 `<Dashboard>`（保留"新建对话"入口，无聚焦对话时显示）。`EmptyFocusState.tsx` 可保留为 Dashboard 内部的"无对话"提示片段，或并入 Dashboard 顶部栏。

### 参谋区（AdvisorSection）

- **头部**：`上次复盘 X 天前`（reviewedAt 距今）+ `覆盖 N 张摘要卡` + **刷新复盘按钮**；轮询 `getReviewActivity`，在跑时按钮转 `StatusPulse`(橙) + 禁用。
- **主体**：四类分组，按行动价值排序：悬而未决 → 未闭环 → 反复出现 → 已否决。每组标题 + 计数，条目展示 `text`，`refs` 做成小徽章（来源数，hover 看 sessionId 短码）。
- **空态**：无卡 → "还没有复盘记录，点上方刷新生成"。

### 我的区（ScratchpadSection）

- 一块 markdown textarea，占位"随手记点什么…"，输入防抖 800ms 落盘；标题旁小字"已保存 / 保存中"。

### refs 点击行为（v1 取舍）

refs 的 sessionId 无现成 → 会话跳转映射。**v1 不做跳转**，refs 仅作来源计数徽章；后续迭代再加跳原会话（需 sessionId→conversationId 反查）。

---

## 七、设置页

复用现有「会话摘要」Tab 模式（digest 已有：模型档位/方案 + 提示词编辑 + 活动轮询），复盘对称加一块：

- 复盘模型方案 + 档位选择（reviewProfileId / reviewModelTier，默认 sonnet）
- 复盘提示词编辑（loadReviewPrompt / saveReviewPrompt）
- 可选：复盘活动展示（current / recent），与 digest 活动一致

放「会话摘要」Tab 内加分节，还是新开「复盘」分节——开工时看 Tab 现状定。

---

## 八、测试（TDD，沿用 memory 测试套路）

- `review-scanner.test.ts`：`isReviewStale` 三态（无卡 / 摘要更新 / 未更新）。
- `review-prompt.test.ts`：load 播种 + save 往返。
- `review-trigger.test.ts`：`classifyOutcome` + 串行去重。
- `digest-trigger`：`whenDigestIdle` resolve 时机。
- `notes-store.test.ts`：read/save 往返 + 空文件兜底。
- 端到端（人工）：启动后复盘跟在 digest 后跑 / 仪表盘渲染卡 / 手动刷新 / 换工作区切卡 + 切速记。

---

## 九、跨阶段约束

- 文件 IO 走 `fs.promises`；新文件 <300 行；不引新依赖；IPC 全走 tipc；事件走 `renderer-handlers.ts`。
- 对话内复盘 skill（Phase B）保留不动。
- 系统 B（SDK auto-memory）不依赖、不修改。

---

## 十、落地顺序建议

1. 后端流水线（B1–B8）+ 单测 → 可在日志验证复盘自动跟跑。
2. IPC（复盘 + 速记）+ 类型同步。
3. 前端 store + Dashboard 组件（C1–C2 参谋区 → C3 速记板）。
4. 设置页复盘分节。
5. 人工端到端验证。

---

## 十一、开放问题（实现时定）

1. 复盘提示词后台版是否需在末尾追加工作区上下文（仿 digest 追加 `目标会话 sessionId`）——B6 开工时按 query 是否需要工作区提示决定。
2. 设置页复盘分节的具体位置（并入「会话摘要」Tab vs 新分节）——开工看 Tab 现状。
3. `EmptyFocusState` 是整体并入 Dashboard 还是保留为子片段——D1 开工时定。
4. 复盘活动是否需要像 digest 那样的取消按钮（cancelReview）——按实际跑时长决定，可后补。

---

## 修订历史

- 2026-06-07：初版。Phase C 细化 + 补「后台复盘流水线」。确立"复盘升级为镜像 digest 的后台独立 agent（跟在 digest 后跑、独立 sonnet 档、提示词共用）+ 首页仪表盘（参谋区四类原样分组 + 自由 markdown 速记板，均按工作区独立）"形态，拍定 7 条核心决策。
