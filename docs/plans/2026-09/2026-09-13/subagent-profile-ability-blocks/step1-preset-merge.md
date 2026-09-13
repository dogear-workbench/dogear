---
step: 1
title: 数据层预设合并与术语替换
status: pending
---

## 目标

内置「浏览器解析」预设并入文章能力；全库「细闸/总闸」术语替换为「子开关/总开关」。

## 依赖上下文（接力棒输入）

- 无前置 step。设计依据：../subagent-profile-ability-blocks-design.md §③④
- `electron/main/services/settings-types.ts:253` `createBrowserParseSubAgentProfile()`：normalize 保底工厂，deepMerge 语义 = target 已有字段保留、缺失字段从 source 补（存量用户会自动获得 `article: true`，显式 false 保留）
- 「浏览器解析」名字在 8 处 agent 文案硬引用（session-append-templates.ts / browser-tools.ts / web-mcp-tools.ts / site-policy.ts 等），**name 与 id 均不改**

## 计划改动

- [ ] `electron/main/services/settings-types.ts:253` `createBrowserParseSubAgentProfile`：`enabledAbilities` 加 `article: true`；description 重写——涵盖「浏览器与扩展双通道调研 + 工作区文章读取与解析（article-parser skill 随 article 开关直通）」，保留扩展通道独占/串行派遣提示
- [ ] 术语替换（用户可见）：`app/settings/SubAgentTab.tsx:200`「此处为子会话侧细闸」段改用「子开关」表述（顺带把「工作区能力包开关」统一为「工作区能力包总开关」）
- [ ] 术语替换（reason 字符串）：`electron/main/tipc/ability.ts:340`「不受 Profile 细闸约束」→「不受 Profile 子开关约束」
- [ ] 术语替换（注释/测试名，顺手同义）：`app/settings/AbilityTab.tsx:98,108-109`、`electron/main/agents/ability-registry.ts:36,169-170`、`electron/main/agents/pi-session/pi-session.ts`（约 12 处注释）、`electron/main/agents/ability-registry.test.ts:22-23,52,123` 测试名
- [ ] `bun run build:electron` 编译通过

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
