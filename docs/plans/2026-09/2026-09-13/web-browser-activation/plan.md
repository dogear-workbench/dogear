# 联网与浏览器能力激活 实施计划

**目标**：让三套联网能力真正可用——子会话获得 web-mcp 快档（Profile 细闸）、主会话获得分工引导、工具描述不再死链、定时任务可选 browser/web-mcp、能力页总开关联动细闸。

**架构思路**：web-mcp 从 mainOnly 改为 Profile 细闸（`enabledAbilities.web`，与 stock/article/browser 对称）；提示词按「本会话实际挂载的工具」动态生成 fallback 指引（三态枚举）；前端只改总开关 handler 补细闸，运行时三闸结构不动。详细设计见 [design.md](./design.md)。

**涉及模块**：settings-types / settings-service(normalize) / ability-registry / pi-session / web-mcp-tools / session-append-templates / scheduler(plan-validate + custom-agent-tools) / types/settings / SubAgentTab / AbilityTab

## 步骤索引

- [x] [Step 1: 主进程类型与注册表](./step1-types-registry.md) — `enabledAbilities.web` 类型 + 模板 + normalize 迁移 + ability-registry 细闸 + 单测
- [x] [Step 2: 工具与提示词层](./step2-tools-prompts.md) — web-mcp-tools 三态描述 + 分工引导段 + pi-session 挂载与拼装
- [x] [Step 3: 定时任务补齐](./step3-scheduler.md) — KNOWN_TOOL_PACKS 白名单 + custom-agent-tools web-mcp 分支
- [x] [Step 4: 前端能力页](./step4-frontend.md) — SubAgentTab 能力域勾选框 + 类型镜像 + AbilityTab 总开关联动
- [x] [Step 5: 整体验证与文档同步](./step5-verify.md) — lint/build + 手动动线 + codebase-map 同步

## 全局决策

- **fallbackHint 三态**：`'browser-tools'`（本会话有 dogear__browser__*，保留现有指引）/ `'browser-subagent'`（主会话无 browser 工具，指引派 browser-parse 子会话）/ `'none'`（子会话无 browser 工具且不能派单，不提浏览器）
- **主会话 hasBrowser 判定必须与实际挂载一致**：`activeAbilities.has('browser') && enabledToolPacks.includes('browser')`——只判总闸会复现「开总闸没开细闸」死链；子会话侧 `activeAbilities.has('browser')` 即可（Profile 级独立挂载）
- **总开关联动语义**：enable=true 补 `enabledSkills` + `enabledToolPacks`（只补不删）；enable=false 只写 `abilityOverrides`；无 skill 包现有联动不变
- **normalize 迁移模式**：复用 settings-service.ts:302 既有「内置 Profile 缺键补齐」——default 与 browser-parse 两个内置 id 缺 `web` 键补 `true`，显式 `false` 尊重；非布尔剔除对齐 extension 写法
- **分工段**：主版含派遣动线（webSearch/webReader 直查 → 派浏览器解析 → 本地调研派普通子会话）；子版两行精简（快档优先 + browser 工具备选），子会话不出现「派子会话」指引
- 不写注释（项目规范）；不新增单测文件，仅更新 ability-registry.test.ts 既有用例

## 完成总结（2026-09-13）

五个 step 全部落地并逐 step commit（50bf44e4 / 72a68f2d / 9bdc3485 / d5d704e1 / 本 step）：

1. **web-mcp 子会话细闸**：`enabledAbilities.web` 全链路（类型 + default/浏览器解析模板预勾 + normalize 迁移 + resolveAbilities 细闸），web-mcp 去 mainOnly；连带修复两个测试文件的既有断言
2. **工具与提示词层**：createWebMcpToolDefs 按 fallbackHint 三态生成描述尾段（防死链）；web-research-guidance 分工段主/子两版；pi-session 子会话挂载 + 主会话 hasBrowser 双条件传参；补 registerToolGroup placeholder 防设置页空显示
3. **定时任务补齐**：KNOWN_TOOL_PACKS 白名单 + buildCustomToolSet web-mcp 分支，fallbackHint 二态传参，UI 零改动自动列出
4. **前端能力页**：镜像类型 + SubAgentTab「联网搜索」勾选框与计数 + AbilityTab 有 skill 包总开关 enable 一键补齐细闸（只补不删，关不动细闸）
5. **验证与文档**：lint/build:electron 全绿；全量测试 309 pass（唯一 fail 为 pty-service 既有环境噪音）；手动动线以代码级验证替代，UI 实操待用户抽验；codebase-map 八处条目同步

**执行期发现（与本计划无关）**：HEAD 既有 bug——SystemBehaviorDetail.tsx 值 import 主进程 tipc/ability 把 pty-service → @xterm/headless（上游 module 字段指向不存在文件）拉进浏览器构建，vite build:renderer 硬失败；修复（本地常量化）已在工作区未提交的模型管理改动中，本计划为隔离无关改动将其 stash，完成后恢复
