# 智能分类实施进度 · 接续指南

> **本会话于 Phase 9 后暂停**。下一会话从 Phase 10 开始，参考 plan 文件 + 本文件接续。

## 当前状态：9/18 Phase 完成（后端核心打通）

### 已完成（master 分支，commits ef9ba38..27a7b76）

| Phase | 内容 | 关键 commit |
|---|---|---|
| 1 | 类型 + 设置字段 | 27a7b76 |
| 2 | DigestCard 加 tags | 8466759, d22dd93 |
| 3 | DigestSession 提示词 + SaveDigest schema 加 tags | e40c241, d9e174d |
| 4 | smart-category-store 持久化（safeJsonWrite 并发安全） | 04df5f5, 0882273 |
| 5 | smart-category-engine 决策纯函数 | 60d6d1e, f29de60 |
| 6 | categorize-prompt 模板 | 9b9ad63, a041567 |
| 7 | dogear-smart-category MCP server（ListCategories / SaveCategory） | e82facb, be7aeee, 464af06 |
| 8 | CATEGORIZE_SESSION 任务类型 + agent-worker handler（incremental + full-rebuild） | b306683, e36def6 |
| 9 | category-trigger 编排 + 活动采集 + cancelCurrent | ef9ba38 |

### 剩余 9 个 Phase

| Phase | 内容 | 估算工作量 |
|---|---|---|
| 10 | DigestSession 成功后串联触发 CategorizeSession | 小 |
| 11 | 手动文件夹多引用语义 + 散落迁移脚本 | 中 |
| 12 | IPC 路由 tipc/category.ts | 中 |
| 13 | 前端 store + 事件接入 | 小 |
| 14 | ConversationList 拆四段子组件 | 大 |
| 15 | Tab 唯一性 + 双层高亮 | 中 |
| 16 | 右键菜单分流 + ⟂N 角标 | 中 |
| 17 | 设置页 UI 分节 | 中 |
| 18 | 文档同步 codebase-map | 小 |

---

## ⚠️ 接续会话必读

### 1. 本次执行流程

走的是 `superpowers:subagent-driven-development`：每 Phase 派 implementer → spec reviewer → code quality reviewer → fixer。每 Phase 完成 commit。**不要换流程**，否则质量基线会不稳。

### 2. 用户偏好（本次新增）

- **不再写测试文件**。用户说"测试文件太多了"。剩余 Phase 10-18 的 implementer prompt 中**移除所有"新建 .test.ts"步骤**，但 implementer 自己仍要在本地用 `bun run build:electron` 做编译验证 + 必要时手动验证一两个关键行为
- 实际改 plan：本目录的 `smart-conversation-categorization-plan.md` 仍保留原测试段（不动），但派 subagent 时**在 prompt 里覆盖**："忽略 plan 里所有 .test.ts 文件创建和 `bun test` 步骤"

### 3. Phase 1/3/4/8 留下的 forward note（在 TaskGet 里有 metadata）

- **Phase 8 metadata**（Phase 1 留的）：DEFAULT_SETTINGS 与 worker fallback 模式已在 Phase 8 处理（三层 fallback `payload ?? settings.ai ?? 'haiku'`，DEFAULT_SETTINGS 有 'haiku'，两层一致）✅
- **Phase 8 metadata**（Phase 3 留的）：card.tags === undefined 时记 'skip' 决策 — Phase 8 已实现 ✅
- **Phase 12 metadata**（Phase 1 留的）：settings 分两处读 — `ai.categorizeModelTier/ProfileId` + 顶层 `smartCategory.{enabled,threshold,maxCategories}`；`getSmartCategorySettings` IPC 要合并两边；setter 要 clamp threshold 到 [0,1]

### 4. Phase 9 没拿到 code quality reviewer 反馈（quota 中断）

类似 review-trigger 模式照搬，质量风险低。但 reviewer 在 prompt 里提的几个潜在点供下次会话参考：

- `cancelCurrent` 在没有 currentTaskId 时也 return true — 应改为 `return currentTaskId !== null`
- `recent` 是模块级数组（全工作区共享，cap=15），如果用户切工作区可能看不到旧记录——目前设计接受，但 Phase 17 设置页 UI 实现时可以按 workspaceId filter
- `classifyCategorizeOutcome` 对 full-rebuild 混合结果 `{match:5, error:1}` 返回 'match'，UI 看不出"部分错误"——若 Phase 17 要展示"部分错误"则需要额外字段

这些不阻塞 Phase 10-18，但可以在 Phase 12（IPC）或 Phase 17（UI）时一并处理。

### 5. 关键架构决策已固定

- 智能分类**只读**，agent 全权决策；用户要手动整理就去手动文件夹区
- 手动 + 智能/时间 视图切换，**默认智能、不记住**
- 同一会话可在手动文件夹 + 智能分类 + 时间分组**多处出现**，但 tab key=conversationId 保证唯一
- 归档不级联清引用，**渲染时统一过滤** `archived_at != null`
- 提炼时打标签（主+辅+适配度）→ Step A 阈值匹配（0 LLM）→ 无匹配上 LLM
- 分类上限默认 10，每工作区单层无嵌套
- 标签优先复用现有；归一化代码层做（中划线/斜杠/空格归并）

完整设计文档：`docs/plans/2026-06/2026-06-10/smart-conversation-categorization-design.md`

---

## 接续 prompt 建议

新会话开场可以这样：

```
继续 docs/plans/2026-06/2026-06-10/ 下的智能分类实施，从 Phase 10 开始。
当前进度和接续指南见 progress.md。用 superpowers:subagent-driven-development
流程，每 Phase 派 implementer + spec reviewer + code quality reviewer + fixer。
重要：不再写 .test.ts 文件（progress.md §2），implementer prompt 里覆盖掉
plan 中所有测试创建和 bun test 步骤。
```
