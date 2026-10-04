# 设置域（settings）

设置页（全屏 overlay）、能力/场景页、模型方案、子会话 Profile、工作区管理与规则、模型选择链路。能力包注册表真源见 agent-core.md。

## 设置页（app/settings/）

- `page.tsx` — 设置页骨架（ui-store settingsOpen 驱动的全屏 overlay，非路由；全实时保存：local 变更防抖 500ms 落盘+关闭时兜底写回，顶栏仅返回按钮）；受控 Tabs 八页分别组件化：BehaviorTab（基础设置）/AbilityTab/SceneTab/ProfilesTab/WorkspaceManagementTab/SubAgentTab/ShortcutsTab/AboutTab（受控以支持场景页跳转子会话派遣页）
- `BehaviorTab.tsx` — 基础设置 tab（含 WebAiSitesSection/ExtensionStatusLine/FailoverSection 等小节挂载）
- `ProfilesTab.tsx` — 模型方案 tab（Profile 清单 + pi-model-row + FetchModelsDialog 入口）
- `ShortcutsTab.tsx` — 快捷键清单 tab（从 hotkey-registry listHotkeys 自动渲染，只读；数据源见 infra.md hotkey-registry）
- `ExtensionStatusLine.tsx` — 受控浏览器小节的扩展状态行（连接状态/正文预览/授权域名只读 chip；ExtensionStatus 类型源在 browser.md）
- `WebAiSitesSection.tsx` — 网页 AI 站点列表编辑（增删改、URL 校验、至少保留一条；挂基础设置「浏览器」小节后，保存后网页 AI 切换器实时联动）
- `AbilityTab.tsx` — 能力标签页编排（只读展示，启停配置在场景页）：列表态按三大类分组（分组头数据取 getSceneOverview.categories，CATEGORY_FALLBACK 兜底；规则包卡+能力包卡+系统行为卡）/详情态按 selectedKey 路由
- `ability/` — 能力页组件（全部只读）：RulesPackCard/RulesPackDetailPage（工作区+全局规则合并卡与双编辑器，编辑器保留）、AbilityPackCard/AbilityPackDetailPage（skill 型包 chips 查看切换+SKILL.md 渲染+skill 明细启用徽标；段型包 SegmentBlock）、AbilityPackSidebar（包类型徽标+配套工具组+加载情况）、AbilityMountsSection（挂载矩阵行列表：主会话/子会话各 Profile/任务执行会话 + 三条后台任务行——定时自定义任务 memory/notes 按 sceneOverrides.scheduler 三级回退、可选包按工作区工具包命中，话题状态抽取/文章解析恒 false；行徽标「后台任务/子会话/系统预设」）、SystemBehaviorDetail、BasicToolsSection、config-mutations.ts（装配开关写回算法共享模块：applyPackToggle/applySkillToggles/applyScenePackToggle 纯函数+createConfigPersister 乐观更新工厂+buildSkillToPacks/packToggleLinksOf/EMPTY_CONFIG，消费方为场景页）、pack-meta.ts（PACK_TYPE_LABELS+CATEGORY_FALLBACK 分组兜底）
- `scene/` — 场景标签页（全部能力启停唯一入口，两层配置模型 v2）：SceneTab（七行侧栏：主会话/临时会话/子会话/任务执行会话/定时自定义任务五 matrix 行 + 话题状态抽取/文章解析两 summary 行；matrix 行按 ScenePackCell.state 三态渲染——switchable 开关/forced「强制」徽标/excluded 灰显排因，开关写回经 config-mutations 写底层真源：main=abilityOverrides、sub/executor/scheduler-custom=sceneOverrides 对应键（恢复默认=删整键回跟随工作区）、personal=personal config，写后重拉 overview；sub/scheduler 扩展组撤格子换 groupNotes 一句话+跳转按钮（派遣页/定时计划），executor 行附单段通用执行提示词模板与挂载说明，summary 行展示固定提示词；底部跳转子会话派遣页）、SceneAbilityRow（三态单格行：开关/强制/排除徽标+reason+右上状态徽标，展开子开关区仅 code-workflow 有）、ScenePromptsPanel（提示词展示面板：正文 MarkdownRenderer 富渲染随页面滚动，executor 行随行 content 直渲染+extensionNote，state-extract/parse-article 走只读路由拉取）
- `WorkspaceManagementTab.tsx` — 工作区管理（列表/删除/孤儿恢复/环境依赖检查）
- `SubAgentTab.tsx` + `subagent/AbilityBlockRow.tsx` — 子会话派遣标签页：Profile 列表（非 default 启用 Switch）+ ProfileEditor（名称/模型/超时/基础工具/Skill）；能力域按能力包块化渲染（数据源 `client.getAbilityPacks()`，失败显示错误行+重试）：article/web-mcp 单开关、stock 单开关（直通包内全部 skill 与工具包，无细选）、code-workflow/自定义 skill 块开关+细选 Checkbox Popover、browser 单开关（齐开齐关 browser+extension 双字段，与装配语义一致）；memory 归场景页「子会话」行（enabledAbilities.memory 字段保留仅数据兼容，UI 与解析均不消费）；写回走 enabledAbilities 原字段（数组只增删包内名，存量混入名保留），交付通信为固定启用行
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

- `services/settings-service.ts` — 设置 JSON 存储（`.dogear/settings.json`）+ normalizeSettings 幂等迁移（含 failover 链维护、SubAgent 能力域缺键补齐、browser-parse 内置模板按全集补缺失键——存量 Profile 自动并入新增的 web/article、旧描述按 LEGACY 已知值识别迁移、webAiSites 归一（normalizeWebAiSites，空列表回退 DEFAULT_WEB_AI_SITES）；applySyncOptionsPatch 同步选项补丁（disabledSyncItems 白名单清洗、userSyncPaths 归一，六个 rev 组字段实际变化才 syncOptionsRev++））
- `services/workspace-json-service.ts` — 工作区 JSON 存储（`.dogear/workspaces.json`），增删触发 workspace-watcher 起停；getAll 默认过滤保留字 personal（includePersonal 拼合成条目，归档 timer 用）
- `services/workspace-config-service.ts` — 工作区能力配置（`workspaces/{id}/config.json`）；personal 读取时合并 PERSONAL_DEFAULT_CONFIG 最小能力集（仅联网搜索，stored 可逐包覆盖）
- `types/settings.ts` — AppSettings/ModelProfile/ModelTier/SubAgentProfile/WebAiSite/permissionMode 等与 DEFAULT_SETTINGS（与 electron/main/services/settings-types.ts 主进程镜像双份，共享类型改需两处同步）；主进程 settings-types.ts 另有 SETTINGS_SYNC_FIELDS 跨设备传播白名单（9 项通用偏好，白名单外含未知新字段一律保本端）

## 注意

- 能力元数据唯一来源 `getAbilityPacks()`（前端零硬编码，residentToolGroups 同接口下传）；场景总览 `getSceneOverview({ workspaceId })` 返回七场景行（五 matrix+两 summary）+三大类分组头，子会话/定时任务扩展组多为 groupNotes 文字而非包格子
- 设置保存为主进程按 diff 分层生效：快照域标脏受影响 PiSession，无整体重启链路
- 包开关联动算法在 `ability/config-mutations.ts`（applySkillToggles 原子双写；有 Skill 的包总开关联动补齐包内 skill 与工具包只补不删，无 Skill 纯工具包开关直接写 enabledToolPacks），能力页只读无写路径，写回入口在场景页
- 子会话扩展能力实际生效 = Profile 勾选 ∩ 工作区能力包开关（交集语义）；固定层（memory 等）归场景页「子会话」行 sceneOverrides.sub 裁决，不查 Profile；SubAgentProfile.enabled 仅非 default 有意义（停用后系统提示词不列出、startChild 拒绝）
- failover 链（AppSettings.failover）由 normalizeFailoverChain 在 normalize 尾部维护：新供应商追加链尾、删供应商移出、tier 失效回退、piModels 为空不进链
- 设置保存联动走 updateSettings → broadcastSettingsChanged → setup-settings-sync（同窗口自收自发）

## 数据流

- 模型选择：对话创建时 tipc 注入 settings.ai.defaultModelSelection 浅拷贝 → ChatInputArea 的 ModelSelector 切换 → conversation-store.setConversationModelSelection 写库 → useSendMessage 发送前 reconcile（null 拦截；同 profile 换 tier 走快速路径，跨 profile 返回 needsRestart 触发会话重启）；插话路径跳过 reconcile 沿用会话原模型
