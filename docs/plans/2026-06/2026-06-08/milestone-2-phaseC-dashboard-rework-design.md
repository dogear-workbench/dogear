# 首页工作台重构设计（milestone 2 · phase C 迭代）

> 状态：设计已与用户对齐，待拆实现计划
> 背景：phase C 落地的「仪表盘（复盘参谋 + 速记板）」上线后，用户反馈四类信号复盘卡价值低、误判多、场景不合理。本文记录重构后的目标模型。

## 1. 反馈与问题

现状（phase C）：
- 仪表盘仅在「无聚焦对话 tab」时出现（`app/page.tsx:313` 兜底渲染）。
- 复盘参谋区展示结构化「复盘卡」：四类信号（悬而未决 / 未闭环 / 反复出现 / 已否决），每条挂源会话 refs，`AdvisorSection` 分组渲染。
- 速记板：工作区级自由文本。

用户反馈：
1. 希望仪表盘是**固定入口（tab）**，而不是空态兜底。
2. 四类信号**抓错重点**：把"测过但没回复确认"误判成未决；作为主动对话的 agent，用户极少显式说"某功能成功了"，很多功能要长期使用才知好坏。这类内容像被硬捞出来的总结，价值低。
3. 首页应更**发散、前瞻**：做了哪些、哪些中断、提建议、沉淀总结。

## 2. 核心理念

**首页 = 用户与 agent 的共享工作台，目的是拉齐双方信息差。**

底层只有一个**记忆池**，写入有两个入口：
- 用户显式标记（"这段记下来" / "1m 成功了" / "thinking 继续做"）
- agent 自主沉淀（会话里判断值得留的结论 —— 延续既有偏好「价值判断交给 agent」）

**关键判断标准不是"重不重要"，而是"靠谁、在什么时机被触发"**：
- 靠**用户眼睛**触发的待办与回顾 → 进**报告**（看得见，否则永远等不到被提起）
- 靠 **recall** 触发、影响 agent 未来行为的沉淀 → 进**记忆**

报告与记忆**不是同一份内容的两种形态**，而是按触发时机分流的两类东西。

## 3. 数据模型

### 记忆（详细全集，给 agent 用）
- 落地：复用现有工作区主题记忆（`mcp__dogear-memory`：SaveMemory / RecallMemory / ForgetMemory）。
- 内容：需主动处理项（**详细版**，含链条 / refs / 状态）、沉淀、注意事项、有价值结论。
- 作用：未来会话中靠 recall 浮现，甚至让模型据此调整策略。

### 报告（简述，给用户看）
- 落地：每工作区一个 `dashboard.md`，落 `<configDir>/workspaces/<wsId>/`（替代旧 `review.md` 的结构化卡）。
- 渲染：首页直接用现成 `MarkdownRenderer.tsx`（GFM + 高亮），**零结构耦合**，agent 写啥显示啥（不同工作区可长得不一样）。
- 纯净语句、**无链条/refs**（细节在记忆里，用户不看链子）。
- 参考结构（**不强制**）：

  ```markdown
  > 一段话总结当前状态

  ## 做了哪些（近 5 天）
  ## 需主动处理 / 中断 / 搁置
  ## 建议
  ## 沉淀（最新少量几条）
  ```

### 内容分流表

| 内容 | 报告（简述） | 记忆（详细全集） |
|------|:---:|:---:|
| 总结段 | ✓ | |
| 做了哪些（近 5 天） | ✓ | |
| 需主动处理 / 中断 / 搁置 | ✓ 简述 | ✓ 详细 + 链条 + 状态 |
| 建议 | ✓ | |
| 沉淀 / 有价值结论 / 注意事项 | 最新少量几条 | ✓ 全集 |
| 链条 / refs / 细节 | ✗ | ✓ |

## 4. 生成流程（增量）

**触发**：
- 关会话后（挂在现有 digest 扫描链上，digest 先跑，报告 agent 后跑）
- 首页「手动刷新」按钮

**新内容判定（复用现有两级时间戳逻辑，已查证）**：
- digest 级：`digest-scanner.ts` `isDirty` —— JSONL mtime ≠ 摘要卡 sourceMtime → 重新提炼该会话摘要。**不变。**
- 报告级：摘要卡 `createdAt` 与报告 `updatedAt`（旧 `reviewedAt` 改名）比 —— **createdAt 晚于 updatedAt 的都是新卡，不管几张全处理；没有更新的就不动。**

**一遍过逻辑**：

```
触发
  源 = 比报告 updatedAt 新的摘要卡（≥0 张）+ 当前报告 + 相关记忆
  无新卡 → 直接结束，不动
  有新卡，agent 判断哪些变了：
    · 有该沉淀的 → 写进记忆；没有 → 不动记忆
    · 报告里该更新的段落 → 更新；没变的 → 保留原内容（增量合并，非全量重写）
    · 已解决的待办 → 从报告移除（必要时把解决经验转成一条记忆）
  产出：更新后的 dashboard.md（含新 updatedAt）
```

现有报告已把历史沉淀编码进去，不必重读全部 digest —— 省 token、快。

## 5. 能力归属（agent 分层）

三层各司其职，**不是一个 agent 包圆**：

| 层 | 职责 | 现状 |
|----|------|------|
| ① 实时沉淀 | 活跃会话里 auto-memory：用户显式标 + agent 当场沉淀进记忆 | 已有，不动 |
| ② 逐会话提炼 | digest 管线：关会话后把单次会话清洗成 `digest.md` 原料（带 refs） | 已有，保留 |
| ③ 跨会话报告 | 读 digests + 记忆 → **更新记忆 + 重写报告**，同一次 run 一遍过 | 旧 review 技能**改造**为此 |

报告 agent（③）同时承担"更新记忆"和"写报告"，因为读完原料后顺手两件事最自然，分开会重复读原料。但**不啃原始逐字稿**（那是 ② 的事），也**不做实时沉淀**（那是 ① 的事）。

## 6. UI

### 固定「首页」tab
- `WorkspaceTabBar` 最左侧钉常驻 tab：哨兵 id（如 `__home__`），不可关闭、不可弹出，始终最左。
- tab 栏不再"无会话时整条隐藏"，至少有首页一个。
- 应用启动默认停在首页（`activeTabId` 初始 = `__home__`）。
- `page.tsx` 内容区：`Dashboard` 与会话 `AgentChat` **都挂载、按 `activeTabId` 切 display**，切到首页不丢会话流式状态。

### Dashboard 布局
- 报告（`dashboard.md` 经 `MarkdownRenderer`）+ 速记板，**左右分栏**；宽度不够时**自动变上下堆叠**。
- 中间区宽度随左右面板折叠变化，用 **Tailwind 4 容器查询（`@container`）**按实际容器宽度切横/纵，不用视口断点。
- 报告区右上角保留「手动刷新」按钮（触发报告 agent 重生成）。
- 速记板（`ScratchpadSection`）保留：放临时问题/草稿，800ms 防抖落盘。

## 7. 删除项

- 结构化复盘卡数据模型：`ReviewItem`（kind/text/refs）、`ReviewCard`（`review-store.ts` 重写为 markdown 报告读写）。
- `AdvisorSection.tsx` 四类分组、`ReviewItemGroup.tsx`。
- `SaveReviewCard` 工具、`REVIEW_KINDS` 枚举。
- 旧 `review-prompt.ts` 四类归并提示词（重写为"维护记忆 + 产出报告"）。
- 回溯徽章（短链）方案：不做，报告无链条。

## 8. 实现要点概要（细节留给 plan）

- **存储**：`review.md`（结构化）→ `dashboard.md`（自由 markdown + frontmatter `updatedAt`）。
- **工具改造**（`review-tools.ts`）：
  - 移除 `SaveReviewCard`；新增 `ReadReport` / `WriteReport`（自由 markdown）。
  - `ReadReviewCard` → `ReadReport`（返回报告正文 + `updatedAt` 供增量判定）。
  - 保留 `ListDigests` / `ReadDigest` / `TraceSource`。
  - 报告 agent 工具集 = 记忆工具（`mcp__dogear-memory`）+ digest 读取工具 + 报告读写工具。
- **提示词**：`review-prompt.ts` 重写，明确分流契约（沉淀进记忆、待办进报告、增量合并、解决移除），延续「价值判断交给 agent」「保真不臆造」两条偏好，针对性减少误判/低价值。
- **记忆工具生命周期**：需支持"定位条目 → 标记解决 → 从报告移除 → 必要时转记忆"。`mcp__dogear-memory` 现有 Save(覆盖)/Forget 基本够用。
- **前端**：`dashboard-store` 的 `reviewCard`(结构化) → `reportMarkdown`(string)；`triggerReview`/`loadReview` → `triggerReport`/`loadReport`（活动轮询逻辑保留）。`session-store` 加 `__home__` 哨兵与默认聚焦。

## 9. 开放问题

- 报告 agent 任务类型：复用现有 `DIGEST_SESSION` 链路新增一种，还是改造现有 review 触发？（plan 阶段定）
- 关会话时 digest 与报告的串行编排细节（确保 digest 先落再跑报告）。
