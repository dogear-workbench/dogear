# 联网与浏览器能力激活 实施计划

**目标**：让三套联网能力真正可用——子会话获得 web-mcp 快档（Profile 细闸）、主会话获得分工引导、工具描述不再死链、定时任务可选 browser/web-mcp、能力页总开关联动细闸。

**架构思路**：web-mcp 从 mainOnly 改为 Profile 细闸（`enabledAbilities.web`，与 stock/article/browser 对称）；提示词按「本会话实际挂载的工具」动态生成 fallback 指引（三态枚举）；前端只改总开关 handler 补细闸，运行时三闸结构不动。详细设计见 [design.md](./design.md)。

**涉及模块**：settings-types / settings-service(normalize) / ability-registry / pi-session / web-mcp-tools / session-append-templates / scheduler(plan-validate + custom-agent-tools) / types/settings / SubAgentTab / AbilityTab

## 步骤索引

- [x] [Step 1: 主进程类型与注册表](./step1-types-registry.md) — `enabledAbilities.web` 类型 + 模板 + normalize 迁移 + ability-registry 细闸 + 单测
- [x] [Step 2: 工具与提示词层](./step2-tools-prompts.md) — web-mcp-tools 三态描述 + 分工引导段 + pi-session 挂载与拼装
- [x] [Step 3: 定时任务补齐](./step3-scheduler.md) — KNOWN_TOOL_PACKS 白名单 + custom-agent-tools web-mcp 分支
- [ ] [Step 4: 前端能力页](./step4-frontend.md) — SubAgentTab 能力域勾选框 + 类型镜像 + AbilityTab 总开关联动
- [ ] [Step 5: 整体验证与文档同步](./step5-verify.md) — lint/build + 手动动线 + codebase-map 同步

## 全局决策

- **fallbackHint 三态**：`'browser-tools'`（本会话有 dogear__browser__*，保留现有指引）/ `'browser-subagent'`（主会话无 browser 工具，指引派 browser-parse 子会话）/ `'none'`（子会话无 browser 工具且不能派单，不提浏览器）
- **主会话 hasBrowser 判定必须与实际挂载一致**：`activeAbilities.has('browser') && enabledToolPacks.includes('browser')`——只判总闸会复现「开总闸没开细闸」死链；子会话侧 `activeAbilities.has('browser')` 即可（Profile 级独立挂载）
- **总开关联动语义**：enable=true 补 `enabledSkills` + `enabledToolPacks`（只补不删）；enable=false 只写 `abilityOverrides`；无 skill 包现有联动不变
- **normalize 迁移模式**：复用 settings-service.ts:302 既有「内置 Profile 缺键补齐」——default 与 browser-parse 两个内置 id 缺 `web` 键补 `true`，显式 `false` 尊重；非布尔剔除对齐 extension 写法
- **分工段**：主版含派遣动线（webSearch/webReader 直查 → 派浏览器解析 → 本地调研派普通子会话）；子版两行精简（快档优先 + browser 工具备选），子会话不出现「派子会话」指引
- 不写注释（项目规范）；不新增单测文件，仅更新 ability-registry.test.ts 既有用例
