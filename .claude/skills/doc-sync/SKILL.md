---
name: doc-sync
description: 检查并同步项目文档（CLAUDE.md / .claude/rules/ / codebase-map.md），保持索引与代码一致。在以下场景自动唤起：完成一个独立功能/重构后、新增了 store/service/IPC 路由/Agent 工具/页面/技能后、移动或拆分了较大模块后、修改了 tipc 路由签名后。也可由用户主动调用 /doc-sync。
---

# Doc Sync

文档同步检查工作流。**只在改动达到"值得记录"门槛时才动手改**——大多数小修改不需要更新文档。

## 决策树

### Step 1 · 这次改动值得更新文档吗？

**值得更新**（继续 Step 2）：
- 新增了文件：page / component / store / service / tipc 路由 / Agent 工具 / skill
- 删除或重命名了已在 codebase-map.md / rules 中提及的文件
- 修改了**架构层面**的约定：存储路径、命名规则、模块边界、新的禁止事项
- 拆分或合并了大模块（影响代码地图的归类）
- 新增了一类需要规则约束的文件（比如新增 `python/` 目录但 rules 没覆盖）

**不值得更新**（直接结束）：
- bug 修复、样式调整、文案修改
- 在已有文件内添加函数/方法（不改变文件职责）
- 重构内部实现但对外接口不变
- 测试代码、临时调试代码

### Step 2 · 改哪一层？

| 改动类型 | 目标文件 |
|---------|---------|
| 新增了一类硬性规则 / 禁止事项 / 项目级偏好 | `c:/dogear/.claude/CLAUDE.md` |
| 新增了文件且属于已有模块 | `.claude/rules/codebase-map.md` 加一行 |
| 新增了一个新模块 / 新约定（比如新增 `python/` 目录、新的服务层模式） | 新增或扩充对应的 `.claude/rules/xxx.md`，并检查 `paths:` 覆盖 |
| 移动/重命名/删除文件 | 同步更新 codebase-map.md（对应行）+ 检查相关 rules 是否提到旧路径 |
| 现有 rules 的 `paths:` 没覆盖新增的目录 | 扩展对应 rules 的 paths frontmatter |

**优先级**：codebase-map.md 是索引（最可能漂移）→ rules 是规则（变化慢）→ CLAUDE.md 是准则（最稳定）。

### Step 3 · 检查清单（执行）

按顺序快速过：

1. **codebase-map.md** — 新文件是否需要加入索引？删除/重命名的文件是否清理？模块归类是否还准确？
2. **path-driven rules** — `frontend-components.md` / `agent-development.md` / `tipc-routes.md` / `message-references.md` / `session-runtime.md` 这五个 rules 的 `paths:` 是否覆盖新增目录？
3. **CLAUDE.md** — 是否新增了一类需要全局知晓的硬性约定？（罕见，慎加）

每改一处文件都要**精准编辑**——不要顺手重写整段，只动需要动的行。

### Step 4 · 不要做的事

- ❌ 不要为了"完整性"把每个新增文件都列入 codebase-map.md。只列**有结构意义**的文件（service / store / 主要组件 / 路由 handler），辅助 utility 不必。
- ❌ 不要在 CLAUDE.md 写实现细节——细节属于 rules。
- ❌ 不要新建 rules 文件除非确实有一类新的、path 可枚举的约束。临时性提示放在 memory 里。
- ❌ 不要在 codebase-map.md 加 `paths:` frontmatter——它就是按需 Read 的。
- ❌ 不要重复内容——CLAUDE.md 提到的就别在 rules 里再写一遍，rules 通过路径关联自动加载。

## 自检

完成后用一句话向用户汇报：改了哪些文档、哪些**故意没改**及原因。如果决定不更新任何文档，直接说"本次改动不触达文档层"，不要默默跳过。
