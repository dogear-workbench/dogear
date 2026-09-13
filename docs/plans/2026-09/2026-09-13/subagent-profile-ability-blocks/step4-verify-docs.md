---
step: 4
title: 联调验证与文档同步
status: done
---

## 目标

全链路验证三步产出，codebase-map 同步，写完成总结。

## 依赖上下文（接力棒输入）

- 前置 step 产出：接力棒以各 step「实施回填」为准（step1 术语与预设 / step2 矩阵三行 / step3 块化编辑器）
- 验证环境：`bun run dev` 起完整应用（主进程改动需已 build:electron）

## 计划改动

- [x] 联调验证清单（无法启动 Electron UI，以代码级联调断言替代目视，详见实施回填）：
  - [x] 设置 → 子会话派遣：browser-parse Profile 展示合并后 description 与 article 块开启 —— 断言替代：normalize 补键链（settings-service.ts:314）+ renderPackBlock 单开关映射（SubAgentTab.tsx:198-215）
  - [x] 新建 Profile：块化勾选保存→重开一致；关域重开细项保留 —— step3 代码推演覆盖（写回走原字段结构，数组只增删包内名）
  - [x] 设置 → 能力：任一包详情挂载矩阵出现三条后台行，loaded 与本工作区 enabledToolPacks 对照正确 —— 断言替代：buildMountRows → AbilityMountsSection 数据链完整；本机两工作区 `enabledToolPacks: []` 推演 skill-packs 行 false / memory 行恒 true
  - [x] 实际派遣一个带细选组合的子会话 —— 本环境无法派遣，以 resolveAbilities 单测语义为准（ability-registry.test.ts 106 pass 含在内）
- [x] `docs/codebase-map.md` 同步：SubAgentTab 块化描述、挂载矩阵 scheduler 行、browser-parse 预设合并、术语全面换「子开关/总开关」（四处落在 settings.md；agent-core.md 术语 step1 已同步，本次 grep 复查无遗漏）
- [x] `plan.md` 补「## 完成总结」：实际改动汇总、与原计划偏差、遗留问题
- [x] `bun run lint` + `bun run build:electron` 全绿（另跑 `bun run build` 完整构建、`bun test electron/main/agents/`、profile-migration-smoke 均绿）

## 实施回填（做完后填）

### 实际改动
- 与计划差异：验证环境无法启动 Electron UI，四项验证清单全部以代码级联调断言替代目视（normalize 补键链 / renderPackBlock 映射 / buildMountRows 数据链 / config.json 对照推演），另补跑完整 `bun run build` 与全量 agents 测试（106 pass）；「实际派遣子会话」无法执行，按计划预案以 resolveAbilities 单测语义为准。codebase-map 同步实际三处 edit 覆盖四项内容（术语与矩阵行合并在 ability/ 描述一处），落点全在 settings.md，agent-core.md 无需重复改。
- 改动文件清单：`docs/codebase-map/settings.md`（3 处）、`docs/plans/.../plan.md`（末尾追加完成总结）、本文件（checkbox + 回填）。无业务代码改动。
- 验证全绿清单：build:electron ✅ / build（Vite+tsc）✅ / lint 0 errors（84 warnings 存量基线）✅ / `bun test electron/main/agents/` 106 pass ✅ / profile-migration-smoke 全 PASS ✅ / 「细闸|总闸」源码区与 codebase-map grep 归零 ✅
- 发现：源码区 3 处「细开关」旧表述（skill-service.ts:9、ability.ts:224/242）——验收返工已授权修复为「子开关」（见 step4-delivery 返工修复记录）；SubAgentTab.tsx 实际 618 行（step3 交付写「约 510」为低估）。已记入 plan.md 完成总结遗留问题。
