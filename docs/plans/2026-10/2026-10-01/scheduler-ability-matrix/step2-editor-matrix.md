---
step: 2
title: 编辑页扩展矩阵
status: in_progress
---

## 目标
定时任务编辑页扩展区换成场景同款矩阵：四包跟随/固化开关 + code-workflow 开关与 6 skill 细则。

## 依赖上下文
- 现状：`TaskEditorPage.tsx:200-206` 挂 CustomToolPacksSection（workspaceId gate 内）+ CustomSkillsSection（gate 外）
- 四包清单与跟随态显示：`client.listToolPacks({ workspaceId })`（既有路由，ToolPackOption 带 name/label/description/enabled）
- code-workflow 的 6 skill 清单：ability tipc 包视图（`AbilityPackView`，ABILITY_PACKS 注册表）——实施时确认最便捷的取数路由（getAbilityOverview 或专用路由），拿 code-workflow 包的 skills 清单（name+description）
- 数据：开关固化写 `draft.toolPacksOverride`（四包）/ `draft.skillsOverride`（code-workflow 勾选名单）；恢复跟随 = override 置 undefined

## 计划改动
- [ ] 新组件 `app/data-center/scheduler/CustomAbilityMatrix.tsx`：
  - 四包（article/browser/web-mcp/stock 或 listToolPacks 返回的扩展域包）两态开关：override 未固化时显示绑定工作区当前状态 + 「跟随工作区」徽标；拨动写 override 名单（开=含该包，关=不含）；提供「恢复跟随」操作（override → undefined）
  - code-workflow 格子：开关 + 可展开 6 skill 勾选；关 = skillsOverride undefined；开 = 勾选名单（首次开启默认全 6）
  - 文案按 §7 直白基调（如「跟随工作区」「恢复跟随」「勾选的 skill 会在任务执行时按需加载」）
- [ ] `TaskEditorPage.tsx`：撤两组件挂载换 CustomAbilityMatrix；workspaceId gate 保持（矩阵需要工作区上下文显示跟随态）
- [ ] 删除 `CustomToolPacksSection.tsx`、`CustomSkillsSection.tsx`（删前 grep 确认无其他消费方）
- [ ] 验证：`npx tsc --noEmit -p tsconfig.json`；目验清单列进交付文档

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
