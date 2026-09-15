# 应用数据目录段固定注入（撤 app-data 包）设计

**背景**：app-data-layout 计划 Step 4 把「应用数据目录」认知段做成了可开关的 `app-data` prompt-only 能力包。用户指出语义错位：该段描述的挂载边界（`computeBasePaths`）与禁写区（`buildWriteExcludedPaths`）本来就无条件生效，提示词只是告知机制——可关的包是个假开关（关掉只让模型失去认知，机制仍在）。且段文案末句讲的是**工作区** `.dogear/articles`，与应用数据目录无关，属错位内容（Glob/Grep 工具描述已覆盖该信息，不丢）。

**目标**：①段改为固定注入，归「系统行为」（不可关闭、不归能力包管）；②删段文案中文章库句；③设置页展示归入系统行为详情页（复用 `systemBehaviors` 空通道）。

**架构**：撤包 + 无条件注入 + `systemBehaviors` 通道回填展示。排除的选项：a) 保留包但 UI 锁开关——能力包体系里放不可关的包，语义拧巴；b) 只删句不动包结构——不解决假开关问题。

**模块边界**：

| 文件 | 改动 |
|------|------|
| `electron/main/agents/ability-registry.ts` | 删 `app-data` 包（ABILITY_PACKS 13→12；残留 override 静默忽略，无迁移） |
| `electron/main/agents/pi-session/pi-session.ts` | personaParts 组装处去掉 `activeAbilities.has('app-data')` 条件，无条件 push（后台 headless 装配不走此路径，维持不注入） |
| `electron/main/agents/session-append-templates.ts` | `buildAppDataGuidance` 删文章句；`getSystemPromptSegments()` 保留 `app-data-guidance` 注册（供系统行为页展示模板）；triggerDescription 改为固定注入口径 |
| `electron/main/tipc/ability.ts` | 删 `sceneReason` 两处 `case 'app-data'`；`getAbilityPacks` 的 `systemBehaviors` 空数组回填一条（segment 从 segmentMap 取，复用 `AbilitySystemBehaviorView` 现成结构） |
| `app/settings/ability/SystemBehaviorDetail.tsx` | 新增「固定提示词段」区块，渲染 `behaviors`（label + triggerDescription + 模板），不进挂载矩阵 |
| `docs/codebase-map/agent-core.md` | 13→12 包、app-data 描述改为固定注入、系统行为页描述同步 |

**数据流**：段模板仍由 `getSystemPromptSegments()` 单一来源提供 → pi-session 无条件注入系统提示词；设置页 `getAbilityPacks` → `systemBehaviors[0].segment` → 系统行为详情页只读展示。

**错误处理 / 边界情况**：工作区 config 里已存的 `app-data` override 由 `resolveAbilities` 的「残留下线 key 静默忽略」规则兜底；挂载矩阵不再渲染该包行（包已删）；`tool-registration-smoke` 的 ALL_OFF 动态构造自动适配。

**未决问题**：无。

**不分步骤理由**：单一原子改动（撤包、改注入、清引用、UI 展示、文档同步是同一整体拆不开），无阶段性验收点、无需跨会话续做。
