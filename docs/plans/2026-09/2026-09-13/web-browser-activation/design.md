# 联网与浏览器能力激活 设计

**日期**：2026-09-13
**背景**：项目已有三套联网能力——GLM 联网 MCP（`bigmodel__webSearch/webReader`）、内嵌浏览器（`dogear__browser__*` 15 工具）、浏览器扩展（`dogear__extension__*` 8 工具）——但实际会话中基本没被用起来。根因三层：
1. **开关层**：browser 包 `defaultEnabled: false` 且工作区未开（本次用户已开总闸，但主会话侧三闸门只开了一闸，处于「有扩展无内嵌浏览器」半吊子状态）
2. **架构层**：web-mcp `mainOnly: true` 把快档排除在子会话外——需要联网的调研子会话反而没网（2026-09-13 派出的 GLM 调研子会话实锤：思考里想用 webReader 但没有该工具）
3. **引导层**：主会话无联网/浏览器分工引导段；web-mcp 工具描述引导「改用 dogear__browser__*」在 browser 包未开时是死链；定时任务白名单 `KNOWN_TOOL_PACKS` 缺 browser/web-mcp

**目标**：
- 子会话（默认 Profile 与浏览器解析 Profile）可用 web-mcp 快档，Profile 细闸控制
- 主会话获得明确的「快档直查 / 深度网页派浏览器解析 / 本地调研派普通子会话」分工引导
- web-mcp 工具描述按本会话实际能力给出正确的 fallback 指引
- 定时任务可选 browser / web-mcp 工具包
- 能力页包总开关打开时自动补齐细闸，消除三闸门不联动坑

## 一、web-mcp 子会话细闸（`enabledAbilities.web`）

### settings-types.ts（主进程）
- `SubAgentEnabledAbilities` 加 `web?: boolean`
- `createBrowserParseSubAgentProfile()` 模板 enabledAbilities 加 `web: true`
- `createDefaultSubAgentProfile()` 模板 enabledAbilities 由 `{}` 改 `{ web: true }`

### settings-service.ts（normalize）
- 非布尔剔除：`if ('web' in ab && typeof ab.web !== 'boolean') { delete ab.web; changed = true; }`（对齐 browser/extension）
- 存量迁移：default Profile 复用 browser-parse 已有的「内置 Profile 缺键补齐」机制（settings-service.ts:302 注释的既有模式）——`id === 'default'` 且 `web` 缺失时补 `true`；显式 `false` 是用户关闭，不覆盖

### ability-registry.ts
- `ABILITY_PACKS` 的 web-mcp 包删 `mainOnly: true`（类型保留，供未来包使用）
- `resolveAbilities` 加子会话细闸：`if (pack.key === 'web-mcp' && opts.role === 'sub' && opts.profile && opts.profile.enabledAbilities.web !== true) continue;`（对齐 browser 分支模式）
- 同步更新 `ability-registry.test.ts`

### pi-session.ts（子会话挂载）
- `buildSubAgentToolDefs` 加：`if (activeAbilities.has('web-mcp')) registerPack('web-mcp', createWebMcpToolDefs({ fallbackHint: ... }))`
- 主会话挂载路径不变（仍走 `OPTIONAL_TOOL_PACKS` × `enabledToolPacks` 细闸循环）

### 前端
- `types/settings.ts` 镜像 `SubAgentEnabledAbilities` 加 `web?: boolean`
- `app/settings/SubAgentTab.tsx`：`BOOLEAN_ABILITIES` 加 `{ key: 'web', label: '联网搜索', desc: 'bigmodel__webSearch / bigmodel__webReader（GLM MCP 快档，API 直出）' }`；`countAbilityDomains` 加 `if (ab.web) n++`

## 二、提示词层

### web-mcp-tools.ts（工具描述动态化）
`createWebMcpToolDefs(opts: { fallbackHint: 'browser-tools' | 'browser-subagent' | 'none' })`：
- `browser-tools`（本会话有 browser 工具）：保留现有「改用 dogear__browser__*」文案
- `browser-subagent`（主会话、无 browser 工具）：改为「深度阅读/翻页/登录墙场景建议派『浏览器解析』子会话（profile: browser-parse）」
- `none`（子会话、无 browser 工具）：不提浏览器（子会话不能派单），只说明适合静态内容

调用方传参：
- 主会话（pi-session.ts）：`activeAbilities.has('browser') && enabledToolPacks.includes('browser')` ? `browser-tools` : `browser-subagent`——注意与实际挂载条件一致，避免「开总闸没开细闸」再产死链
- 子会话（pi-session.ts）：`activeAbilities.has('browser')` ? `browser-tools` : `none`
- 定时任务（custom-agent-tools.ts）：`enabledPacks.has('browser')` ? `browser-tools` : `none`

### session-append-templates.ts（分工引导段）
- `SystemPromptSegmentKey` 加 `'web-research-guidance'`
- 新增两个常量：
  - `WEB_RESEARCH_GUIDANCE_MAIN_APPEND`（主会话版，含派遣指引）：快档检索/静态文章直接 `bigmodel__webSearch` / `bigmodel__webReader`（API 直出不派会话）→ 深度浏览/翻页拼接/登录态站点派「浏览器解析」子会话 → 纯本地代码调研派普通子会话（不占浏览器独占通道）
  - `WEB_RESEARCH_GUIDANCE_SUB_APPEND`（子会话版，精简两行）：快档优先 webSearch/webReader；需渲染/交互/登录态页面用 `dogear__browser__*`（本会话工具）
- `getSystemPromptSegments()` 登记主版（能力页展示用），拼装侧按 role 取用

### pi-session.ts（段拼装）
主会话：`(activeAbilities.has('web-mcp') || activeAbilities.has('browser'))` 时 push 主版；
子会话：同条件 push 子版。

## 三、定时任务补齐

- `plan-validate.ts`：`KNOWN_TOOL_PACKS` 加 `'browser'`、`'web-mcp'`
- `custom-agent-tools.ts`：加 web-mcp 分支（browser 分支已存在）；`KNOWN_TOOL_PACKS` 补 browser 后 override 路径自动可选
- UI 零改动：`listToolPacks` 走 `OPTIONAL_TOOL_PACKS`（browser/web-mcp 均已登记），任务编辑器 `CustomToolPacksSection` 自动列出

## 四、前端总开关联动（三闸门修复）

`app/settings/AbilityTab.tsx` `handleTogglePack`：
- enable = true 时（有 skill 的包）：自动补 `enabledSkills`（包内全部 `skillMetas[].name`）+ `enabledToolPacks`（包内 `toolGroupMetas` 中有 `pack` 归属的 `id`）——只补不删
- enable = false 时：只写 `abilityOverrides`，不动细闸（拍板语义：总闸 = 一键开，细闸 = 高级微调）
- 无 skill 包的现有联动逻辑（细闸跟随开关）保持不变
- Trade-off（已接受）：用户先关包内某 skill 细闸、再开关总闸会把细闸重新带上，需再手动关——「关总闸再开」低频，可接受

**边界情况**：
- 存量半开状态（browser 总闸开、细闸空）不做自动迁移——用户在能力页关→开总闸一次即触发联动补齐，或手动开包内 skill 细闸
- web-mcp 的 `browser-subagent` 指引在「浏览器解析 Profile 被停用」时仍指向该 profile——接受（派遣时工具会报错并给出可用 Profile 列表）

## 模块边界（涉及文件）

| 文件 | 改动 |
|------|------|
| `electron/main/services/settings-types.ts` | 类型 + 两个 Profile 模板 |
| `electron/main/services/settings-service.ts` | normalize 剔除 + default 缺键补齐 |
| `electron/main/agents/ability-registry.ts` | 删 mainOnly + resolveAbilities 细闸 |
| `electron/main/agents/ability-registry.test.ts` | 同步用例 |
| `electron/main/agents/pi-session/pi-session.ts` | 子会话挂载 + 描述传参 + 分工段拼装 |
| `electron/main/agents/tools/web-mcp-tools.ts` | fallbackHint 三态描述 |
| `electron/main/agents/session-append-templates.ts` | 两个分工段常量 + 登记 |
| `electron/main/services/scheduler/plan-validate.ts` | 白名单补 browser/web-mcp |
| `electron/main/services/scheduler/custom-agent-tools.ts` | web-mcp 分支 |
| `types/settings.ts` | 镜像类型 |
| `app/settings/SubAgentTab.tsx` | 能力域勾选框 + 计数 |
| `app/settings/AbilityTab.tsx` | 总开关联动 |

## 验证

- `bun run lint` + `bun run build:electron`
- 手动：设置页 Profile 编辑器出现「联网搜索」勾选框（default/浏览器解析默认勾）→ 新主会话工具列表与系统提示词含分工段 → 派默认 Profile 子会话确认有 webSearch/webReader → 定时任务编辑器可选 browser/web-mcp

## 未决问题

无（四个决策点均已在讨论中拍板：细闸方案 A / 分工段三档动线 / 白名单补齐 / 总开关联动 A）。
