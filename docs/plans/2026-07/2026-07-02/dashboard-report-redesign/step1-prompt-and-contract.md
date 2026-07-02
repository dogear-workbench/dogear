---
step: 1
title: 提示词与报告契约同步重写
status: done
---

## 目标

把 `DEFAULT_REVIEW_PROMPT` 与 `WriteReport` 工具描述同时对齐到新四段结构，去掉"最新沉淀"段、把"追加保留"契约改成"每次主动裁剪合并"、明确告知复盘 agent 沉淀走 SaveMemory / core-profile 走 GetCoreProfile+UpdateCoreProfile（工具虽然要 Step 2/3 才通电，但提示词先写好不会出错——工具不在时 agent 会自然跳过）。

## 依赖上下文

- 现有 `DEFAULT_REVIEW_PROMPT`（`review-prompt.ts:4-38`）鼓励"按天罗列 + 最新沉淀 + 增量保留"，这是要被完全替换的旧模板。
- 现有 `WriteReport` 描述（`review-tools.ts:140-143`）写"增量更新：没变的段落原样保留"，同样要改。
- `review-store.ts` 的 `saveReport` 会自动给 `dashboard.md` 写 `updatedAt` frontmatter，提示词只需写正文，不需要 agent 自己写 frontmatter。
- 设计文档 §新报告结构 + §报告维护契约 + §记忆分流契约（`../dashboard-report-redesign-design.md:36-59`）是主要来源。

## 计划改动

- [ ] `electron/main/services/memory/review-prompt.ts:4-38` 整体替换 `DEFAULT_REVIEW_PROMPT`：
  - 步骤序号里明确"如果只有一张组卡也要处理，只要有新增就跑分流"
  - 分流契约按设计文档三级：沉淀（决策/偏好 + 踩过的坑）走 SaveMemory；需处理/搁置的简述进报告，已解决的直接删；core-profile 门槛苛刻（稳定+跨会话反复验证），写前先 GetCoreProfile 全量合并
  - 新报告结构块（一句话总结 + 最近做了什么 / 需要你处理 / 持续观察 / 建议）
  - 明确告知："SaveMemory 描述里『仅用户明确要求』这句是给交互式聊天用的，不适用于复盘任务，判断标准以本提示词为准"
  - 保留"保真契约"（拿不准 TraceSource 查证，宁可不写不可瞎造）
  - 保留结尾"简述这次更新了哪几条再结束"
- [ ] `electron/main/agents/tools/review-tools.ts:139-156` 改写 `WriteReport` 的 description 字符串：
  - 结构描述改为四段（对齐新提示词）
  - 契约改为"报告是当前状态快照，每次重写主动裁剪：已解决的待办整条删除、已归档的观察项直接删除、语义重复的合并、过期条目不留"
  - 保留"不放链条/refs/sessionId"
  - 去掉"增量更新：没变的段落原样保留"
- [ ] `electron/main/agents/tools/review-tools.ts:17-23` 检查 `registerTools()` 元数据里 `WriteReport` 的 description 是否需要同步微调（当前是"覆盖写入首页报告（纯净 markdown，给用户看）"，够简可以不动）

## 实施回填

### 实际改动
- 与计划差异：无。按计划完全替换 DEFAULT_REVIEW_PROMPT 与 WriteReport 描述。
- 改动文件清单：
  - `electron/main/services/memory/review-prompt.ts:4-88`（整段常量重写）
  - `electron/main/agents/tools/review-tools.ts:140-149`（WriteReport 描述串）

### 给下一步的接力棒
- 新提示词里出现的工具名（Step 2 必须精确匹配这两个名字）：`GetCoreProfile` / `UpdateCoreProfile`
- 新提示词对这两个工具的契约要点（Step 2 工具描述要呼应）：
  - GetCoreProfile 空返回是**正常状态**，工具文本要显式说明"空≠不该写，只是没有稳定信号"
  - UpdateCoreProfile 是**全量覆盖**，工具描述必须强调"先 Get 再合并再全量传，否则丢失已有内容"
  - 门槛苛刻——"稳定 + 跨会话反复验证为真"，工具描述要说"大多数复盘不该调用"
- SaveMemory 在 autonomous 模式下的新契约核心（Step 2 描述串要包含）：
  - 明确"仅用户明确要求"那句是给交互式聊天场景，本任务判断标准以调用方提示词为准
  - 保真契约仍适用：拿不准就 TraceSource 查证，宁可不写不可瞎造
- 待办或已知限制：磁盘上已有 `review-prompt.md` 的工作区不会自动更新，靠用户在 ReviewPanel 点"恢复默认"（设计文档已确认不写迁移）
