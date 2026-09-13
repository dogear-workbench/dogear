---
step: 1
title: 主进程类型与注册表
status: done
---

## 目标
`enabledAbilities.web` 字段全链路落地（类型 + 内置模板 + normalize 迁移 + resolveAbilities 细闸），web-mcp 包去掉 mainOnly。

## 依赖上下文（接力棒输入）
- 设计文档：[design.md](./design.md) 第一节
- 当前关键文件状态：
  - `electron/main/services/settings-types.ts:62` `SubAgentEnabledAbilities` 现有键 memory/stock/article/skills/customSkills/browser/extension
  - `electron/main/services/settings-types.ts:245` default 模板 `enabledAbilities: {}`；`:261` browser-parse 模板 `enabledAbilities: { browser: true, extension: true }`
  - `electron/main/services/settings-service.ts:295-316` normalize 已有 browser/extension 非布尔剔除 + browser-parse 缺键补齐（builtinAb 键遍历）
  - `electron/main/agents/ability-registry.ts` web-mcp 包定义在 ABILITY_PACKS（`mainOnly: true` 待删）；resolveAbilities 中 sub 分支现有 `if (pack.key === 'browser' && ab.browser !== true) continue;` 模式
- 关键决策回顾：web-mcp 细闸对齐 browser 模式（显式 opt-in），default 与 browser-parse 两个内置 Profile 预勾

## 计划改动
- [x] `electron/main/services/settings-types.ts` — SubAgentEnabledAbilities 加 `web?: boolean`；`createDefaultSubAgentProfile()` 模板 enabledAbilities 改 `{ web: true }`；`createBrowserParseSubAgentProfile()` 模板加 `web: true`
- [x] `electron/main/services/settings-service.ts` — normalize：web 非布尔剔除（对齐 :298 extension 写法）；缺键补齐扩展——default Profile 复用 browser-parse 的内置补齐模式（`id === 'default'` 且 `web` 缺失补 `true`）
- [x] `electron/main/agents/ability-registry.ts` — web-mcp 包删 `mainOnly: true`（AbilityPack 类型的 mainOnly 字段保留）；resolveAbilities 加 `if (pack.key === 'web-mcp' && opts.role === 'sub' && opts.profile && opts.profile.enabledAbilities.web !== true) continue;`
- [x] `electron/main/agents/ability-registry.test.ts` — 补用例：sub + profile.web=true → web-mcp 在集合；web 缺失/false → 不在；main 不受影响

## 实施回填（做完后填）

### 实际改动
- 与计划差异：计划只列 ability-registry.test.ts，但删 web-mcp `mainOnly` + 模板加 `web: true` 导致另两个测试文件的既有断言过时，已同步修复：
  - `tool-registration-smoke.test.ts:176`：「mainOnly：子会话场景包不生效」改写为「web-mcp 子会话细闸：default Profile 预勾生效，web 未勾不生效」（新行为正是本步目标）
  - `settings-normalize.test.ts:207/252/266`：归一化断言同步 default/browser-parse 模板新增的 `web: true`
- 改动文件清单：
  - `electron/main/services/settings-types.ts:68` `SubAgentEnabledAbilities` 加 `web?: boolean`；`:244` default 模板 `{ web: true }`；`:260` browser-parse 模板 `{ web: true, browser: true, extension: true }`
  - `electron/main/services/settings-service.ts:302` web 非布尔剔除（对齐 extension 写法）；`:321` `id === 'default'` 缺键补齐（复用 builtinAb 遍历模式，显式 false 尊重）
  - `electron/main/agents/ability-registry.ts:191` web-mcp 子会话细闸 `ab.web !== true → continue`；web-mcp 包定义删 `mainOnly: true`；`:29` 类型字段保留，注释去掉失效示例；`:184` 运行时 mainOnly 判断保留（供未来包）
  - `electron/main/agents/ability-registry.test.ts`：新增 web-mcp 细闸用例（web=true 在 / 缺失与 false 不在 / main 不受约束）
- 验证：lint 0 errors（84 warnings 均为 app/ 存量，electron 在 ignore 列表）；build:electron 全绿；全量 `bun test` 309 pass / 1 fail（`pty-service.test.ts` buffer 截断超时，node-pty Windows AttachConsole 环境噪音，与本次无关）；目标测试 11 pass

### 给下一步的接力棒
- 关键签名 / 数据结构：
  - `enabledAbilities.web?: boolean` 已全链路落地；web-mcp 包现可被子会话解析（双闸：总闸 abilityOverrides + profile.web）
  - `resolveAbilities` 后子会话 web-mcp 生效条件：`abilityOverrides['web-mcp'] !== false`（默认 false 需显式开）且 `profile.enabledAbilities.web === true`
- 下个 step 该从哪里继续：step2 pi-session 子会话挂载——`buildSubAgentToolDefs` 加 `if (activeAbilities.has('web-mcp')) registerPack('web-mcp', createWebMcpToolDefs({ fallbackHint: ... }))`；fallbackHint 三态按 design.md 第二节，主会话 `activeAbilities.has('browser') && enabledToolPacks.includes('browser')`，子会话 `activeAbilities.has('browser')`，定时任务 `enabledPacks.has('browser')`
- 待办或已知限制：web-mcp 主会话挂载仍走 `OPTIONAL_TOOL_PACKS × enabledToolPacks` 双闸不变；pty 测试为既有环境噪音非本步引入
