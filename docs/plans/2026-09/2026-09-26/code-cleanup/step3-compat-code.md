---
step: 3
title: 兼容/迁移代码删除与数据清理
status: done
---

## 目标
删除 19 项 marker 守卫的一次性迁移代码（数据实况已核验全部完成）、state-card 旧格式解析（用户拍板不迁移直接删）、纯数据死键。

## 依赖上下文（接力棒输入）
- 调研报告：共享区 `20260926-compat-code-report.md` 第一节（19 项，每项含 file:line 与数据证据）+ 第二节 1/4/5/6
- 用户拍板：state-card 旧格式**不回写直接删**（接受 107 个旧格式话题卡不再解析、状态重新积累）
- 迁移 marker 文件（.dogear 下 *-done.json / *.migrated）**保留不删**（防误重跑哨兵，见全局决策）

## 计划改动

### A. 整文件删除（一次性迁移模块）
- [ ] `electron/main/services/memory/review-skill-service.ts`（no-op 死模块）
- [ ] `electron/main/services/migration-session-id.ts`（224 行，marker 已在 2026-08-05）
- [ ] `electron/main/services/migration-workspace-config.ts`
- [ ] `electron/main/services/migrate-notes-memory.ts` + `migrate-notes-todos.ts`（+ 其 .test.ts）
- [ ] `electron/main/services/browser/embedded/migrate-legacy-partitions.ts`

### B. main-app.ts 启动链瘦身（删对应调用块，行号为调研时快照，执行时以内容定位）
- [ ] review-skill 调用块（原 :646-652）、session-id 迁移（:678-683）、workspace-config（:685-691）、browser-playbook（:693-701）、legacy-partitions（:703-711）、conversations 旧版迁移两处（:654-663）、orphan groupId 回填（:664-677）、tier 迁移（:724-731）、topic-lifecycle 迁移入口（:733-750）、delegation-state 清理（:793-798）、notes 迁移（:808-815）

### C. 点状删除（同报告一节编号）
- [ ] 一.5 topic-lifecycle：`topic-lifecycle-service.ts:215-258` runTopicLifecycleMigration + `:37-51` removeLegacyHistory；`deleteConversationInternal`/`cleanupEmptyTopics` **保留**（话题删除流共用）
- [ ] 一.6 browser-playbook：`browser-playbook-service.ts` 的 migrateBrowserPlaybookIntoMemory(:83-113) / ensureDefaultPlaybook(:43-52) / readBrowserPlaybook 旧文件回退(:55-61) + DEFAULT_PLAYBOOK 模板；`pi-session.ts:583` 读卡处改为直接走全局记忆主题路径
- [ ] 一.8/9/10/11 conversation-service：LegacyConversationsFile 段(:111-144) + migrateFromLegacy(:759-796) + migrateOrphanConversations(:798-821) + migrateLegacyModelSelections(:564-610)；`settings-service.ts:142` LEGACY_MODEL_TIERS + migratePiProfiles tier 映射(:174-195) 与旧 SDK 字段清理分支(:151-176)
- [ ] 一.12 delegation-bridge：cleanupLegacyStateFile(:124-133)
- [ ] 一.13 article-parser-skills-service：旧目录回退(:36-42) + migrateLegacyDirs(:44-72) 及调用(:79)
- [ ] 一.14 plan-store：migrateLegacyPlans(:33-92) + `Array.isArray(raw)` 分支
- [ ] 一.15 state-card：appendPlainEntries(:289-303)
- [ ] 一.16 tipc/agent.ts：getSdkSessions 死路由(:425-456) + :18 导入；连带 `session-paths.ts` 的 getSdkSessionsDir/getSessionJsonlPath（removeLegacyHistory 删除后失去最后调用方，一并清）
- [ ] 一.17 settings-service normalize 陈旧清理分支：LEGACY_BROWSER_PARSE_DESCRIPTIONS/LEGACY_DEFAULT_DESCRIPTIONS(:30-52 及 :331,:344)、OLD_AUTO_MODES(:197-203)、permissionRules(:225-227)、staleAiFields(:265-273)、subAgent 陈旧字段+groupFiles 键(:283-292)。**保留** normalizePiModels 归一化与内置 Profile 补缺失能力键(:326-352)
- [ ] 一.18 notes-store：todos frontmatter 特判(:100-105)
- [ ] 一.19 AgentChat shim：`components/AgentChat.tsx` 删再导出，`app/page.tsx:3` 与 `app/debug/page.tsx:4` 改 import `@/components/agent-chat`
- [ ] 二.6 `app/debug/page.tsx` 旧调试页整删 + `src/App.tsx:25` /debug 路由（preload API 已移除，页面已失效）

### D. state-card 旧格式解析直接删（用户拍板）
- [ ] `state-card.ts:67-79` LegacyBackground、`:184-232` legacySectionItems/parseLegacyBackgroundFields/convertLegacyBackground/parseTopicStateCard 旧格式分支
- [ ] `group-context-builder.ts:38-48` legacy 来源标注
- [ ] `components/TopicStateCardSection.tsx:54`「早期记录」标签分支
- [ ] 删后确认 parseTopicStateCard 对无 sourcesSeenJson 的卡返回 null 的路径行为（新代码当作无卡处理，不抛错）

### E. 纯数据清理
- [ ] settings.json 删 `personas` / `smartCategory` / `rtkEnabled` 三键；各工作区删 `smart-categories.json`
- [ ] plans.json 删 4 条 `kind:'builtin'` 存量 → 然后删 `plan-store.ts:95-99` isRetiredBuiltinTask + tipc/scheduler listTasks 过滤 + deleteTask 拒删分支（删前 grep worker 侧确认无 builtin handler 引用，报告二.4 标注待核）

### F. 收尾验证
- [ ] lint + 双侧 tsc + bun test（settings-normalize.test.ts 会受 E 项影响，同步修测试用例）
- [ ] 启动冒烟：话题状态卡正常显示（新格式卡）、设置页保存正常、调度器列表正常

## 实施回填（2026-09-26 完成）

- 19 项全部处置：A 节删 7 文件（含 migrate-notes-todos.test.ts）；B 节 main-app 11 个迁移调用块全删（登录观测器为运行时功能保留）；C 节 14 项点状删净，session-paths.ts 三导出全失调用方整文件删，agent.ts 连带清 PROJECT_ROOT/fs 导入与 getClaudeConfigDir 再导出；D 节 state-card 旧格式删净，无 sourcesSeenJson 显式返 null（空卡重建，符合拍板）；E 节数据侧 settings -3 键 / plans 5→1（-4 builtin）/ 3 工作区 smart-categories.json 删，isRetiredBuiltinTask 过滤链删净（删前已确认 worker 侧零 builtin handler 引用）
- 连带：topic-lifecycle 的 workspacePath 死参数/assertSafeSessionId、plan-store 的 copyTriggers、settings-normalize.test.ts 删 14 个失效用例；保留 normalizePiModels、内置 Profile 补缺失能力键、browser/extension/web 非布尔守卫
- 验证：lint 0 errors（70 warnings 存量）、双侧 tsc 零错误、bun test 319 pass/0 fail/1 skip（基线 339 = 删 6+14 用例，零意外失败）、build + vite build 通过、dist 清 7 旧产物
- 遗留：①GUI 冒烟待用户（话题卡/设置页/调度器）；②main-app 调试窗口基础设施成死链（createDebugWindow/getDebugWindow 零调用、sendToDebugWindow 被 tipc/agent.ts 调用但前端无接收方 no-op 无害），建议后续评估整链删除；③107 个旧格式话题卡留磁盘不回写（拍板）；④migration marker 全保留
