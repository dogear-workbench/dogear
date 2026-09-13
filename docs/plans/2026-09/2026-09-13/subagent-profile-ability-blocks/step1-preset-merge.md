---
step: 1
title: 数据层预设合并与术语替换
status: done
---

## 目标

内置「浏览器解析」预设并入文章能力；全库「细闸/总闸」术语替换为「子开关/总开关」。

## 依赖上下文（接力棒输入）

- 无前置 step。设计依据：../subagent-profile-ability-blocks-design.md §③④
- `electron/main/services/settings-types.ts:253` `createBrowserParseSubAgentProfile()`：normalize 保底工厂，deepMerge 语义 = target 已有字段保留、缺失字段从 source 补（存量用户会自动获得 `article: true`，显式 false 保留）
- 「浏览器解析」名字在 8 处 agent 文案硬引用（session-append-templates.ts / browser-tools.ts / web-mcp-tools.ts / site-policy.ts 等），**name 与 id 均不改**

## 计划改动

- [x] `electron/main/services/settings-types.ts:253` `createBrowserParseSubAgentProfile`：`enabledAbilities` 加 `article: true`；description 重写——涵盖「浏览器与扩展双通道调研 + 工作区文章读取与解析（article-parser skill 随 article 开关直通）」，保留扩展通道独占/串行派遣提示
- [x] 术语替换（用户可见）：`app/settings/SubAgentTab.tsx:200`「此处为子会话侧细闸」段改用「子开关」表述（顺带把「工作区能力包开关」统一为「工作区能力包总开关」）
- [x] 术语替换（reason 字符串）：`electron/main/tipc/ability.ts:340`「不受 Profile 细闸约束」→「不受 Profile 子开关约束」
- [x] 术语替换（注释/测试名，顺手同义）：`app/settings/AbilityTab.tsx:98,108-109`、`electron/main/agents/ability-registry.ts:36,169-170`、`electron/main/agents/pi-session/pi-session.ts`（17 处注释）、`electron/main/agents/ability-registry.test.ts` 测试名 + 补漏 `tool-registration-smoke.test.ts` / `tool-packs.ts`（全库替换覆盖）
- [x] `bun run build:electron` 编译通过

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
  - 计划外加 3 处配套：`settings-service.ts` LEGACY_BROWSER_PARSE_DESCRIPTIONS 加旧描述（既有迁移模式，保证存量 normalize 自动刷写）；`types/settings.ts` 渲染层镜像工厂同步（原镜像缺 web、description 落后两版）；`resources/browser-eval/profile-migration-smoke.mjs` LEGACY 加第 6 项 + 修复既有 FAIL 用例（上任务模板加 web 键后补键必 changed，基线即红；改传模板克隆回归本意）
  - 术语补漏 2 文件：`tool-registration-smoke.test.ts`（测试名 6 处）、`tool-packs.ts`（注释），按「全库替换」覆盖
- 改动文件清单：settings-types.ts / settings-service.ts / types/settings.ts / profile-migration-smoke.mjs / SubAgentTab.tsx / AbilityTab.tsx / ability.ts / ability-registry.ts / pi-session.ts / ability-registry.test.ts / tool-registration-smoke.test.ts / tool-packs.ts / docs/codebase-map/agent-core.md

### 给下一步的接力棒
- 关键签名 / 数据结构：`createBrowserParseSubAgentProfile().enabledAbilities = { web: true, browser: true, extension: true, article: true }`；normalize 补键循环按模板全集自动补缺失键（显式 false 保留）——step2 矩阵「子会话·各 Profile」行数据源即此机制
- 下个 step 该从哪里继续：`electron/main/tipc/ability.ts` 加 scheduler kind + 三条固定行；reason 风格基线「常驻基础设施不受 Profile 子开关约束」（ability.ts:340）
- 待办或已知限制：LEGACY_BROWSER_PARSE_DESCRIPTIONS 已累积 6 个旧值（纯历史包袱，保留迁移能力）；SubAgentTab `countAbilityDomains` 数布尔键，article 并入后 browser-parse 显示计数 +1（预期）；完整交付见共享区 subagent-profile-ability-blocks/step1-delivery.md
