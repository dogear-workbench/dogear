# Issue 标题：[Proposal] 全局 Skill 库 + 项目级启用配置：消除多项目间的 Skill 重复维护

> 贴到 proma-ai/Proma 的 issue 区。正文如下，可按需删减。

---

## TL;DR

建议引入一个**用户级全局 Skill 库**：同一份 Skill 只维护一份，各项目通过配置选择启用哪些。提案分两阶段落地，**存量项目完全零感知、零迁移**，且加载层（Pi Agent Runtime）**一行都不用改**——改动全部集中在 Proma 自己的 Skill 管理面。

## 现状与痛点

当前每个项目（workspace）创建时会将 17 个默认 Skill 整包复制到 `agent-workspaces/{slug}/skills/`（`copyDefaultSkills`），此后 Skill 的所有权就绑定在单个项目上。带来的问题：

1. **磁盘与升级冗余**：同一份内容最多存在 N+2 份（app bundle → `~/.proma/default-skills/` → N 个项目副本）。bundled Skill 升级时，`upgradeDefaultSkillsInWorkspaces` 需要对每个项目 × 每个 Skill 逐个做 version 比对和 rm+cp 全量替换。
2. **跨项目同步靠手工**：多个项目用到同一个 Skill（如 pptx、skill-creator 很常见）时，改一处需要到其他项目逐个手动「从源更新」——现有的 `.source.json` / `hasUpdate` / `updateSkillFromSource` 本质上是一套手工同步机制，源更新一次要拉取 N 次。
3. **升级覆盖风险**：version-only 比较没有用户修改检测，用户改过项目副本但未 bump version 时，下次 bundled 升级会无提示覆盖用户修改。

## 一个重要前提：Pi 的加载层已经完全支持这个方向

调研后确认，这不是一个需要"绕开框架硬掰"的提案，而是沿着 Pi Agent Runtime 已提供的能力自然延伸：

- Proma 已经通过 `DefaultResourceLoader({ noSkills: true, additionalSkillPaths, skillsOverride })` 全权托管 Skill 注入（`pi-agent-adapter.ts`）。`noSkills: true` 关掉了 SDK 的环境扫描，Skill 从哪里加载完全由 Proma 决定；
- **`additionalSkillPaths` 本来就接受任意路径列表**。底层 pi-agent-core 的 `loadSkills(env, dirs)` 会对每个目录递归扫描 `SKILL.md`。今天传 `[项目 skills 目录]`，改成 `[项目 skills 目录, 全局库目录]` 就是多一个数组元素，SDK 侧零改动；
- `skillsOverride`（`createPromaSkillsOverride`）已经在做"路径前缀 + realpath 归一化"的过滤，把它扩展为"按项目 enabledSkills 白名单选择 Skill"是同型逻辑的自然延伸；
- system prompt 里的 `<available_skills>` 索引和 read 懒加载与 Skill 的目录归属完全解耦——Skill 住在哪个目录，对模型是透明的。

也就是说：**卡点从来不在加载层，全在管理面**（启用/禁用语义、编辑、升级、迁移）。

## 提案

### 阶段一：全局库 + 项目级启用配置（本 issue 主要对齐的范围）

- 新增用户级全局库目录（如 `~/.proma/skill-library/`，命名和位置听维护者意见）；
- 项目 `config.json` 新增 `enabledSkills` 字段，控制该项目启用全局库中的哪些 Skill。现有"目录移动（skills/ ↔ skills-inactive/）"的启停语义保持不变，只用于项目本地 Skill——两套并存、逻辑独立；
- `additionalSkillPaths` 改为 `[项目 skills 目录, 全局库目录]`，全局库 Skill 经 `skillsOverride` 按 `enabledSkills` 过滤后注入；
- **新建项目不再复制 bundled Skill**，改为"全局库 + 默认启用清单"。bundled 升级只需对全局库做一次，启动时的逐项目升级循环对新项目自然消失；
- **同名冲突时项目本地副本优先**——这是向后兼容的关键，保证存量项目行为 100% 不变；
- 提供「提升到全局库」操作：把某个项目本地 Skill 移入全局库（含同名冲突检测），单 Skill 粒度、可预览、出错只影响该 Skill。

### 阶段二（后续单独提案）：存量副本的渐进接管

- 启动时对"内容与全局库一致"的项目副本自动标记接管（软迁移，删除冗余副本）；
- 前置依赖：先补齐内容 hash / 用户修改检测（这本身也修复了上面痛点 3 的覆盖风险）。

### 顺带的改善

- 「AI 分组整理」等 frontmatter 元数据维护只需在全局库做一次；
- 现有跨项目导入五件套（`getOtherWorkspaceSkills` / import / batch-import / `hasUpdate` / `updateSkillFromSource`）在全局化后可逐步退役，UI 简化为"从全局库启用"。

## 兼容性承诺

- 存量项目：本地副本不动、加载行为不变（本地优先），升级本提案版本后**零感知**；
- 回滚：不修改存量目录结构；`config.json` 新增字段对旧版本是惰性数据。唯一注意点是"新建项目/新提升的 Skill"依赖新版本读取（新数据本来就不存在于旧版本中，不构成回归）；
- 文件写入遵循 `safe-file.ts` 原子写约定；watcher / `proma-file://` 预览 / SkillActivation 定位等锚定"项目 skills 目录"的逻辑，会把全局库路径纳入白名单，不改动现有路径的语义。

## 建议的 PR 拆分

1. **PR1**：全局库基建（目录 + `enabledSkills` 配置 + 新建项目不复制 + 双路径加载与过滤）+ BDD 测试；
2. **PR2**：「提升到全局库」手动迁移（冲突检测 + UI）+ 测试；
3. **PR3**：内容一致副本的自动接管 + 内容 hash / dirty 检测。

顺带为 `agent-workspace-manager.ts` 补充测试覆盖（注意到 #1512 重构后该文件目前没有对应测试文件，后续 PR 会逐步补）。

## 想对齐的问题

1. 这个方向是否与内部的 Skill 演进计划冲突？
2. 全局库的目录位置与命名偏好？（`~/.proma/skill-library/` 只是占位）
3. 阶段一的 scope 是否合适？或者你们更希望一步到位做自动迁移 / 更保守地只做只读共享？
4. `enabledSkills` 写进项目 `config.json` 还是 `agent-workspaces.json` 索引里，有没有既定的偏好？

---

## 贴出前的检查项（不贴进 issue）

- [ ] 在 proma-ai/Proma 的 issue 区搜索关键词：全局 skill / skill 共享 / skill library / cross-workspace，确认没有重复提案
- [ ] 确认 issue 语言与仓库 issue 区主流语言一致（本稿为中文，如需英文版可再翻译）
- [ ] 行号类引用已改为函数名（行号会随上游漂移），贴前无需修改
