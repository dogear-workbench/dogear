# 设置域（settings）

设置页（全屏 overlay）、能力包 UI、模型方案、子会话 Profile、工作区管理与规则、模型选择链路。能力包注册表真源见 agent-core.md。

## 设置页（app/settings/）

- `page.tsx` — 设置页（ui-store settingsOpen 驱动的全屏 overlay，非路由；dirty 三按钮 confirm；顶栏保存/取消/保存并重启会话；下划线式 Tabs：基础/能力/模型方案/工作区管理/子会话派遣/关于）
- `ExtensionStatusLine.tsx` — 受控浏览器小节的扩展状态行（连接状态/正文预览/授权域名只读 chip；ExtensionStatus 类型源在 browser.md）
- `AbilityTab.tsx` — 能力标签页编排：列表态（工作区 Select+合并规则卡+能力包卡+系统行为卡）/详情态按 selectedKey 路由；包开关联动 enabledSkills+enabledToolPacks
- `ability/` — 能力页两级结构组件：RulesPackCard/RulesPackDetailPage（工作区+全局规则合并卡与双编辑器）、AbilityPackCard/AbilityPackDetailPage（skill 型包 chips 切换+SKILL.md 渲染+细开关；段型包 SegmentBlock/CoreProfileView）、AbilityPackSidebar（总开关+工具组+挂载情况）、SystemBehaviorDetail、BasicToolsSection
- `WorkspaceManagementTab.tsx` — 工作区管理（列表/删除/孤儿恢复/环境依赖检查）
- `SubAgentTab.tsx` — 子会话派遣标签页：Profile 列表（非 default 启用 Switch）+ ProfileEditor（名称/模型/超时/基础工具/能力域/Skill）
- `pi-model-row.tsx` — 模型清单行：ID 行内编辑、窗口徽标手填（parseContextInput 解析 1M/200K 写法）
- `FetchModelsDialog.tsx` — 上游模型拉取弹窗（探测兼容端点模型列表，勾选后合并入清单）

## 工作区相关组件

- `components/WorkspaceSwitcherPopover.tsx` — 顶栏工作区切换器（选择/添加）
- `components/WelcomeFirstRun.tsx` — 零工作区首次启动引导
- `components/WorkspaceRuleDialog.tsx` — 工作区规则 Dialog（agent.md 编辑器）
- `components/ModelSelector.tsx` — 通用模型选择下拉（按 Profile 分组、按 modelId 去重、可选「不指定」）

## Store 与 lib

- `stores/settings-store.ts` — 应用设置加载/保存（整体 save 模式）
- `stores/ui-store.ts` 中的 settingsOpen — overlay 开关（ui-store 整体见 infra.md）
- `lib/setup-settings-sync.ts` — 监听 settingsChanged 热更（主题/字号即时生效）
- `lib/model-selection.ts` — 模型选择纯函数（dedupeProfileTiers/sameSelection/resolveModelLabel，ModelSelector 与设置页共用）

## 服务与类型

- `services/settings-service.ts` — 设置 JSON 存储（`.dogear/settings.json`）+ normalizeSettings 幂等迁移（含 failover 链维护、SubAgent 能力域缺键补齐、旧浏览器解析 Profile 描述识别迁移）
- `services/workspace-json-service.ts` — 工作区 JSON 存储（`.dogear/workspaces.json`），增删触发 workspace-watcher 起停
- `services/workspace-service.ts` — 获取默认工作区（thin wrapper）
- `types/settings.ts` — AppSettings/ModelProfile/ModelTier/SubAgentProfile/permissionMode 等与 DEFAULT_SETTINGS

## 注意

- 能力元数据唯一来源 `getAbilityPacks()`（前端零硬编码，residentToolGroups 同接口下传）
- 设置保存为主进程按 diff 分层生效：快照域标脏受影响 PiSession，无整体重启链路
- 包开关联动：有 Skill 的包总开关联动补齐包内 skill 与工具包（只补不删），无 Skill 纯工具包开关直接写 enabledToolPacks；applySkillToggles 原子双写
- 子会话能力实际生效 = Profile 勾选 ∩ 工作区能力包开关（交集语义）；SubAgentProfile.enabled 仅非 default 有意义（停用后系统提示词不列出、startChild 拒绝）
- failover 链（AppSettings.failover）由 normalizeFailoverChain 在 normalize 尾部维护：新供应商追加链尾、删供应商移出、tier 失效回退、piModels 为空不进链
- 设置保存联动走 updateSettings → broadcastSettingsChanged → setup-settings-sync（同窗口自收自发）

## 数据流

- 模型选择：对话创建时 tipc 注入 settings.ai.defaultModelSelection 浅拷贝 → ChatInputArea 的 ModelSelector 切换 → conversation-store.setConversationModelSelection 写库 → useSendMessage 发送前 reconcile（null 拦截；同 profile 换 tier 走快速路径，跨 profile 返回 needsRestart 触发会话重启）；插话路径跳过 reconcile 沿用会话原模型
