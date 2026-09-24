# 子会话能力自治 + 注入消息双显修复 设计

**背景**：飞书配置核对场景暴露两个问题。① `browser-parse` Profile 子会话拿不到任何浏览器工具：能力生效要过三层闸（工作区 `abilityOverrides` 包开关 → 工作区 `enabledSkills` skill 开关 → Profile 子开关），用户工作区把 browser 包显式关闭后，Profile 子开关形同虚设，主会话误诊为「扩展没连上」浪费一轮派遣（工具挂载是静态的，与扩展连接状态无关）。② 注入消息（dispatch/delivery/终态等 `injectedTag`）在 run 进行中打开会话 UI 时渲染两条：`handleAgentEvent` 处理 user 落盘时先 push `message_id` 事件再 push injected 实体事件进 liveTurnMessages，快照重放时 reducer 的 `message_id(user)` 升级分支空转（实体未到），注入实体以 local-id 落 live，随后 `reinsertCutUsers` 从磁盘历史捞回同消息按磁盘 id 去重失配 → 插入第二条（已用纯函数测试复现）。

**目标**：
1. 四个带 Profile 子开关的能力包（browser / web-mcp / stock / article）子会话自治：**Profile 子开关是唯一裁决者**，工作区能力包开关退化为纯主会话开关。
2. 修复注入消息双显（用户拍板与①合并为一个任务）。

**架构**：

核心做法（四点）：

1. **`ability-registry.ts` 自治标记与解析**：`AbilityPack` 增加 `subAutonomous?: boolean`，browser / web-mcp / stock / article 四包置 true。`resolveAbilities` 循环开头：`role==='sub' && pack.subAutonomous` 时跳过工作区闸门（`abilityOverrides`/`defaultEnabled`），改由 Profile 子开关独裁——`opts.profile?.enabledAbilities` 对应开关 `=== true` 才入结果集，**profile 缺失则不生效**（无授权即无能力）。四包不带 mainOnly/groupId 等其他条件，互不干扰。

2. **`pi-session.ts` skill 装配绕过**（约 546-559 行）：子会话时，自治包的 skill（browser-exploration / article-parser / stock-analysis / stock-picking）不再过 `enabledSkillsSet` 与 `disabledPackSkills` 两层工作区过滤，直接进 `filterSkillsForSubAgent` 由 Profile 裁决；非自治 skill 过滤行为不变。

3. **`filterSkillsForSubAgent` 补 stock 特判**：stock-analysis / stock-picking 目前走 `ab.skills?.includes()` 泛匹配，Profile 未配 skills 字段时永远挂不上；改为与工具同条件 `ab.stock === true`（对齐 article-parser / browser-exploration 的既有特判模式）。

4. **注入消息双显修复**（`handleAgentEvent`，约 934-937 行）：user message_end 分支中 `tryFlushPendingInjected` 提前到 push/emit `message_id` 之前。重放顺序变为：injected 实体先落 live（local-id）→ `message_id` 到达升级为磁盘 id → `reinsertCutUsers` 按 id 去重命中。两步只依赖消息文本与 entryId 缓存，无相互依赖，交换安全；实时广播顺序同步交换，行为等价（注入实体额外获得稳定 id，无副作用）。

排除的选项：
- 只自治 browser——造成「browser 自治、web-mcp 等还要双开」的不一致（用户已否，选 B）。
- memory 也自治——工作区关 memory 的语义是「全局关记忆」，保留双闸（现状不动）。
- 前端 `reinsertCutUsers` 按 content 去重——内容相同的合法双消息会被误杀，且治标不治本；修数据源顺序更干净。

**模块边界**：
- `electron/main/agents/ability-registry.ts`：`subAutonomous` 标记 + `resolveAbilities` 自治分支 + 四包 description 补「子会话 Profile 独立生效，不受此开关约束」（设置页 AbilityPackCard/AbilityPackSidebar 直接消费 description，UI 不改）。
- `electron/main/agents/pi-session/pi-session.ts`：skill 装配绕过 + `filterSkillsForSubAgent` stock 特判 + `handleAgentEvent` 顺序调整。
- `components/agent-chat/hooks/useTranscriptState.test.ts`：注入消息 merge 回归用例（snapshot 顺序为 injected→message_id 时 live 恰一条）。
- 新增 `electron/main/agents/ability-registry.test.ts`：`resolveAbilities` 四象限（main/sub × 工作区关/Profile 开）纯函数用例。

**数据流**：子会话创建 → PiSession 装配 → `resolveAbilities(wsConfig, { role:'sub', profile })` → 自治包只看 Profile 子开关 → `activeAbilities` 驱动工具挂载（browser/extension/web-mcp/stock/art）、skill 装配、persona 段（browserPlaybook / 联网调研分工）全部自动跟随。主会话路径（`abilityOverrides` 闸门 + `enabledToolPacks` 残留双保险）完全不变。

**错误处理 / 边界情况**：
- sub 无 profile（failover/resume 兜底失败的边缘场景）：自治包全部不生效。
- 默认 / 探索 Profile 的 `browser:false` 不受影响，依然无浏览器能力。
- executor 会话（role=main 变体）、mainOnly 包（notes/shunt）、memory/workspace-git/group-context/agent-collab 行为不变。
- 主会话 web-mcp fallbackHint 处 `enabledToolPacks.includes('browser')`（pi-session.ts:722）是主会话侧逻辑，不动。

**未决问题**：无（自治范围 B 已拍板；症状 B 修复已并入）。

**验证路径**：`bun run build:electron` 重启后，保持工作区 browser 包关闭，派 browser-parse 子会话 → 工具清单含 `dogear__browser__*`/`dogear__extension__*`、skill 含 browser-exploration；run 进行中打开子会话 UI → dispatch 首条消息恰一条。主会话工具清单无浏览器工具。
