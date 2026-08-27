---
step: 1
title: 主进程数据层——skill 目录全局化 + 死链路清理
status: done
---

## 目标

自定义 skill 扫描目录从每工作区副本改为全局 `.dogear/skills/`；article-parser 运行时目录搬家并清死遗留；删除已被调度器 review 任务替代的 cross-session-review 模板及特判。

## 依赖上下文（接力棒输入）

- 前置：无（第一步）。
- 设计依据：[design.md](./design.md) 第 5/6/7 节。
- 当前关键文件状态：
  - `electron/main/services/skill-service.ts:118` — `customSkillsDir = path.join(getConfigDir(), 'workspaces', workspaceId, 'skills')`
  - `electron/main/agents/pi-session/pi-session.ts:394` — 同样的 customSkillsDir 拼法；`pi-session.ts:126-148` — `filterSkillsForSubAgent` 内 `pi-session.ts:145` 有 `if (entry.name === 'cross-session-review') return ab.memory === true` 特判及上方注释提及
  - `electron/main/services/article-parser-skills-service.ts:32` — `getArticleParserSkillsDir()` 返回 `getConfigDir()/skills/article-parser`；`ensureSkillsInitialized()` 目前只初始化 wechat.py + history.jsonl（幂等）
  - 生产环境实际数据：`.dogear/skills/` 下只有 `article-parser/`（活跃：SKILL.md、common.md、history.jsonl、platforms/wechat.py）和 `review/`（死遗留）；所有 `workspaces/*/` 下无 skills 目录
- 关键决策回顾：工作区下旧 skills 目录不迁移不扫描（生产无存量）；review/stock-analysis 死遗留直接删；cross-session-review 的功能由调度器 `review` 内置任务承载（`electron/main/services/memory/review-prompt.ts`），skill 版是重复文本。

## 计划改动

- [x] `electron/main/services/skill-service.ts`
  - `listSkills` 里 custom 扫描目录改为 `path.join(getConfigDir(), 'skills')`（不再拼 workspaceId）；enabled 标注仍用传入 workspaceId 的 config
  - 顶部注释块的来源说明同步更新（custom：`.dogear/skills/<name>/SKILL.md` 全局目录）
  - 顺带去掉了原来包住 custom 扫描的 `if (workspaceId)`（目录不再依赖 workspaceId，无条件扫描；enabled 仍按 workspaceId 标注）
- [x] `electron/main/agents/pi-session/pi-session.ts`
  - `customSkillsDir` 改为 `path.join(getConfigDir(), 'skills')`
  - `filterSkillsForSubAgent` 删除 cross-session-review 特判行；注释里「cross-session-review 仅当 memory===true」字样删掉
- [x] `electron/main/services/article-parser-skills-service.ts`
  - `getArticleParserSkillsDir()` 返回 `getConfigDir()/article-parser`，同步签名保留（fs.existsSync 回退：新存在→新，旧存在→旧，都不存在→新）
  - `ensureSkillsInitialized()` 开头 `migrateLegacyDirs()`：旧目录存在且新目录不存在 → rename（前置 mkdir 父目录）；顺带删 `.dogear/skills/review/` 和 `.dogear/skills/stock-analysis/`（后者是依赖上下文段「review/stock-analysis 死遗留直接删」决策的补齐，目录全局化后会被扫描不能留）；try/catch 失败仅 mainLogger.warn
- [x] `electron/main/agents/pi-session/skill-loader.ts:82`
  - describe 示例文案改为 `article-parser / brainstorming`
- [x] 删除 `resources/skill-templates/cross-session-review/` 整个目录
- [x] 全局搜索确认：electron/ 主进程源码零残余；前端 `AbilityTab.tsx` 的 `MEMORY_SKILL_NAMES` 留给 Step 3；dist/ 编译产物随 build:electron 更新已无引用。另清理两处注释级失实：`review-skill-service.ts` 顶部注释（原提及已删模板路径）、`task-types.ts` ParseArticlePayload.skillsDir 注释（目录搬家）

## 验证

- `bun run build:electron` 通过
- 开发环境启动后检查：`.dogear/skills/article-parser` 被迁到 `.dogear/article-parser`（开发目录若有）；`.dogear/skills/review` 被清
- 启动一个会话确认 skill 索引正常（无 cross-session-review；已有挂载的 stock-analysis / 代码工作流 skill 仍出现在 `<available_skills>`）

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
  1. `skill-service.ts` 去掉了包住 custom 扫描的 `if (workspaceId)`（全局目录不依赖 workspaceId，无条件扫描语义更正确）
  2. 死遗留清理补上 `.dogear/skills/stock-analysis/`（依据本文「依赖上下文」关键决策；目录全局化后会被扫描，不删会变成活链路污染）
  3. 注释级同步：`review-skill-service.ts` 顶部注释、`task-types.ts` ParseArticlePayload.skillsDir 注释（均为失实文案修正，无行为变化）
- 改动文件清单：`electron/main/services/skill-service.ts`、`electron/main/agents/pi-session/pi-session.ts`、`electron/main/services/article-parser-skills-service.ts`、`electron/main/agents/pi-session/skill-loader.ts`、`electron/main/services/memory/review-skill-service.ts`（注释）、`electron/main/agents/task-types.ts`（注释）、删除 `resources/skill-templates/cross-session-review/`

### 给下一步的接力棒
- 关键签名 / 数据结构：`listSkills(workspaceId)` 签名不变；`getArticleParserSkillsDir(): string` 同步签名不变（内部存在性回退）；`filterSkillsForSubAgent` 无 cross-session-review 特判；builtin 模板现为 9 个（cross-session-review 已删）
- 下个 step 该从哪里继续：`step2-layout.md`（设置页布局骨架）
- 待办或已知限制：前端 `AbilityTab.tsx:54` `MEMORY_SKILL_NAMES = ['cross-session-review']` 与 `SubAgentTab.tsx` 相关引用留 Step 3；`review-skill-service.ts` 整文件为 no-op 遗留（index.ts:484 仍调用 `ensureReviewSkillInitialized`），何时删待定；`.dogear/skills/` 现为空目录，作为全局 custom skill 目录保留
