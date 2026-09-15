---
step: 4
title: 认知注入
status: done
---

## 目标

新动态段（应用数据目录定位 + 禁写区说明 + articles 搜索指引）注入系统提示并注册到设置页；Glob/Grep 工具描述补充 `.dogear` 跳过行为。

## 依赖上下文（接力棒输入）

- 前置 step 产出：[step3-mounting.md] basePaths 已含 configDir、禁写机制生效（待回填：禁写清单最终形态）
- 现状锚点：`session-append-templates.ts` 段定义 + `getSystemPromptSegments()` 注册模式；`pi-session.ts` personaParts 注入处（main/sub 分支）；`search-tools.ts` Glob/Grep 的 defineTool description
- 设计约束：约 3 行，不做目录导览；路径运行时注入绝对路径

## 计划改动

- [ ] `session-append-templates.ts` 新增 `buildAppDataGuidance(configDir, workspaceId)` 动态段：①应用数据目录绝对路径已挂载 ②settings.json（子会话预设/能力开关）、定时任务、`workspaces/{id}/config.json` 位置 ③笔记/记忆/任务等由应用工具管理、文件只读 ④工作区 `.dogear/articles` 为文章库，默认搜索跳过 `.dogear`、需显式 path 指入
- [ ] 注入条件：main 与 sub 均注入（含 executor，成本低）；跟随现有 ability 开关还是常驻，对照 `workspace-rules` 包模式决定并记录
- [ ] `getSystemPromptSegments()` 注册（key、label、triggerDescription，isDynamic: true）
- [ ] Glob/Grep description 各加一句：「`.dogear` 数据目录默认跳过以防数据文件淹没结果；需搜索其中内容（如文章库）时把 path 显式指到对应子目录」
- [ ] 验证：新会话系统提示含该段（实际发起会话查看首屏提示或日志）；设置页系统提示构成出现新段
- [ ] `bun run build:electron`

## 实施回填（做完后填）

### 实际改动
- 注入条件决策：**跟随 ability 开关**，新建 prompt-only 包 `app-data`（defaultEnabled: true）承载段；理由：设置页段展示唯一通道是 pack.segmentKeys（SYSTEM_BEHAVIORS 已退役），跟随开关后展示/注入/开关三者一致，对齐 memory/notes/group-context 现有模式；对照 workspace-rules（同型 prompt-only 包）语义一致。默认开启时 main/sub/executor 全覆盖，成本约 3 行；后台定时任务走 agent-worker headless 装配（buildCustomToolSet，不经 personaParts），天然不注入，矩阵 default 分支文案「后台任务不加载该能力包」已准确无需特判。
- 与计划差异：计划原定「对照 workspace-rules 决定跟随开关或常驻」——选了跟随开关（新建包）而非常驻，因常驻无设置页展示通道，与「设置页系统提示构成可见」要求冲突。
- 改动文件清单：
  - `electron/main/agents/session-append-templates.ts`：SystemPromptSegmentKey 加 'app-data-guidance'；新增 buildAppDataGuidance(configDir, workspaceId)；getSystemPromptSegments() 注册（category 'reference'，isDynamic: true）
  - `electron/main/agents/ability-registry.ts`：ABILITY_PACKS 新增 app-data 包（prompt-only，defaultEnabled: true，segmentKeys 指向新段）
  - `electron/main/agents/pi-session/pi-session.ts`：main/sub 共同路径（browserPlaybook 之后、角色分支之前）按 activeAbilities.has('app-data') 注入
  - `electron/main/tipc/ability.ts`：sceneReason 两个 switch 补 app-data 场景说明（main/executor：注入每个会话；sub：随包开关注入子会话）
  - `electron/main/agents/pi-session/search-tools.ts`：Glob/Grep description 各加 `.dogear` 跳过说明一句
- 验证：临时脚本断言段内容四要素/注册元数据/包挂载/resolveAbilities 三场景注入与可关/工具描述，全部通过（脚本已删）；bun run build:electron 通过；bun test 326 pass / 0 fail；lint 0 errors

### 给下一步的接力棒
- 关键签名：`buildAppDataGuidance(configDir: string, workspaceId: string): string`；包 key = 'app-data'，段 key = 'app-data-guidance'
- 下个 step 该从哪里继续：设置页能力包详情页自动渲染新段（pack.segments 通道），前端零改动；若后续要调整段文案，改 buildAppDataGuidance 即可
- 待办或已知限制：禁写区是写路径硬拦截，用户关闭 app-data 包时段不注入但机制仍在，模型靠写失败错误反馈自纠；段文案里的 plans.json 同时是定时任务存储，与工作区 docs/plans 计划文档不同域，文案已用「定时任务存 plans.json」消歧
