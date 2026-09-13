---
step: 4
title: 联调验证与文档同步
status: pending
---

## 目标

全链路验证三步产出，codebase-map 同步，写完成总结。

## 依赖上下文（接力棒输入）

- 前置 step 产出：接力棒以各 step「实施回填」为准（step1 术语与预设 / step2 矩阵三行 / step3 块化编辑器）
- 验证环境：`bun run dev` 起完整应用（主进程改动需已 build:electron）

## 计划改动

- [ ] 联调验证清单：
  - 设置 → 子会话派遣：browser-parse Profile 展示合并后 description 与 article 块开启
  - 新建 Profile：块化勾选（stock skill 细选、browser 双通道）保存→重开一致；关域重开细项保留
  - 设置 → 能力：任一包详情挂载矩阵出现三条后台行，loaded 与本工作区 enabledToolPacks 对照正确
  - 实际派遣一个带细选组合的子会话，确认工具挂载符合勾选（可选，时间紧则以 resolveAbilities 单测语义为准）
- [ ] `docs/codebase-map.md` 同步：SubAgentTab 块化描述、挂载矩阵 scheduler 行、browser-parse 预设合并、术语全面换「子开关/总开关」
- [ ] `plan.md` 补「## 完成总结」：实际改动汇总、与原计划偏差
- [ ] `bun run lint` + `bun run build:electron` 全绿

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：
