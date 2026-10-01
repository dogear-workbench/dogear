---
step: 2
title: 编辑页扩展矩阵
status: done
---

## 目标
定时任务编辑页扩展区换成场景同款矩阵：四包跟随/固化开关 + code-workflow 开关与 6 skill 细则。

## 依赖上下文
- 现状：`TaskEditorPage.tsx:200-206` 挂 CustomToolPacksSection（workspaceId gate 内）+ CustomSkillsSection（gate 外）
- 四包清单与跟随态显示：`client.listToolPacks({ workspaceId })`（既有路由，ToolPackOption 带 name/label/description/enabled）
- code-workflow 的 6 skill 清单：ability tipc 包视图（`AbilityPackView`，ABILITY_PACKS 注册表）——实施时确认最便捷的取数路由（getAbilityOverview 或专用路由），拿 code-workflow 包的 skills 清单（name+description）
- 数据：开关固化写 `draft.toolPacksOverride`（四包）/ `draft.skillsOverride`（code-workflow 勾选名单）；恢复跟随 = override 置 undefined

## 计划改动
- [x] 新组件 `app/data-center/scheduler/CustomAbilityMatrix.tsx`：
  - 四包（article/browser/web-mcp/stock 或 listToolPacks 返回的扩展域包）两态开关：override 未固化时显示绑定工作区当前状态 + 「跟随工作区」徽标；拨动写 override 名单（开=含该包，关=不含）；提供「恢复跟随」操作（override → undefined）
  - code-workflow 格子：开关 + 可展开 6 skill 勾选；关 = skillsOverride undefined；开 = 勾选名单（首次开启默认全 6）
  - 文案按 §7 直白基调（如「跟随工作区」「恢复跟随」「勾选的 skill 会在任务执行时按需加载」）
- [x] `TaskEditorPage.tsx`：撤两组件挂载换 CustomAbilityMatrix；workspaceId gate 保持（矩阵需要工作区上下文显示跟随态）
- [x] 删除 `CustomToolPacksSection.tsx`、`CustomSkillsSection.tsx`（删前 grep 确认无其他消费方）
- [x] 验证：`npx tsc --noEmit -p tsconfig.json`；目验清单列进交付文档

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
  ① code-workflow skill 清单取数定案：`client.getAbilityPacks()`（ability tipc 包视图）取 extension 五包元数据 + code-workflow 的 skillMetas（name/title/description），四包跟随态并行取 `client.listToolPacks({ workspaceId })`；未新增路由，主进程零改动
  ② 四包→toolPacksOverride 语言映射：`pack.toolGroups ∩ listToolPacks 返回的 name 集合`（动态滤掉 dogear-extension 这类 server 名），不硬编码工具包名映射；stock 包固化开/关齐动 4 个 stock 工具包名（stock-quote/analysis/announcement/picking）
  ③ code-workflow 开关显示态由 `skillsOverride 勾中包内 skill 数 > 0` 派生；开=并入全 6 名（保留残留其他域名），关=skillsOverride → undefined；chip 全取消归一 undefined（开关随之回关，与 sanitize 归一口径一致）
  ④ 五包行说明不直接用注册表 description（含「子会话 Profile 独立生效」等主/子会话语境尾巴），组件内 PACK_NOTES 按任务语境直白化硬编码；新增一句「基础文件与搜索工具恒装，无需配置」说明（替代老组件的基础工具格子）
  ⑤ 恢复跟随按钮无 confirm（草稿随保存落库，与老组件「重置为跟随工作区」同口径）
- 改动文件清单：
  - `app/data-center/scheduler/CustomAbilityMatrix.tsx`（新，~245 行）
  - `app/data-center/scheduler/TaskEditorPage.tsx`（import 与挂载点替换，CustomSkillsSection 原在 gate 外恒显示，收进 workspaceId gate 内——矩阵需要工作区上下文；validation 本就强制必须选工作区）
  - `app/data-center/scheduler/CustomToolPacksSection.tsx`、`CustomSkillsSection.tsx`（删除）
  - `docs/codebase-map/data-center.md`（scheduler/ 条目同步：两组件→CustomAbilityMatrix）

### 给下一步的接力棒
- 关键签名 / 数据结构：`CustomAbilityMatrix({ workspaceId, toolPacksOverride, skillsOverride, onChange })`，onChange 收 `{ toolPacksOverride?: string[]; skillsOverride?: string[] }`（undefined = 恢复跟随/不挂载）；写入值均落 KNOWN_TOOL_PACKS 与 skill 索引白名单，sanitizeToolPacksOverride/sanitizeSkillsOverride（plan-validate.ts）既有不动
- 下个 step 该从哪里继续：Step 1 装配侧（custom-agent-task 弃 buildMountedSkillsSection 改 formatSkillIndexForPrompt + createSkillTool）；本步 UI 写入的 skillsOverride 名单全部在装配侧可懒加载
- 待办或已知限制：五包清单来自注册表 extension 类别（当前恰为五包）；包级说明文案硬编码在 PACK_NOTES，注册表描述改写时不同步（语境本就不同，可接受）；「跟随工作区」徽标只表 toolPacks 维度，skillsOverride 无跟随语义（设计拍板）
