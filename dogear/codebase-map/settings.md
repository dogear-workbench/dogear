# 设置域（settings）

设置页（全屏 overlay）、能力/场景页、模型方案、子会话 Profile、工作区管理与规则、模型选择链路。能力包注册表真源见 agent-core.md。

## 设置页（app/settings/）

- `page.tsx` — 设置页骨架（SETTINGS_TAB_ID 哨兵 tab 页，主工作区常驻挂载按 activeTabId 切 display；全实时保存：local 变更防抖 500ms 落盘+卸载时兜底写回；消费 settings-store 的 subTabFocusReq 外部跳转请求，受控以支持场景页跳转子会话派遣页与顶栏设置搜索命中定位）；受控 Tabs 九页顶部横向导航分别组件化：BehaviorTab（基础）/BrowserTab（浏览器）/AbilityTab（能力）/SceneTab（场景）/ProfilesTab（模型方案）/WorkspaceManagementTab（工作区管理）/SubAgentTab（子会话派遣）/ShortcutsTab（快捷键）/AboutTab（关于）；页内挂载 SettingsSearchProvider（顶栏设置项搜索：各 Tab 文件导出自己的 SettingsSearchEntry 清单，search-index.ts 定义类型，provider 聚合后按 label/description/keywords 同步过滤，命中=跳设置页对应子 tab，不高亮具体项）
- `BehaviorTab.tsx` — 基础设置 tab：左锚点导航（~160px）+ 分组（模型/对话/外观/提示/会话列表），开关统一 Switch 行、radio 卡片改 Segmented，模型组内挂 FailoverSection（跨方案全局配置），文案精简版
- `BrowserTab.tsx` — 浏览器 tab：搜索（引擎/代理）/扩展（ExtensionStatusLine + ExtensionActionPolicyNote）/任务浏览器（TaskBrowserSection）/联网搜索 Key/网页拦截（PaymentBlockedHostsSection）
- `EnvDepsSection.tsx` — 环境依赖检查节（挂 AboutTab）：按钮触发扫描（非展开即扫），结果列表 + 一键安装缺失 Python 依赖
- `ProfilesTab.tsx` — 模型方案 tab（左右布局：左列方案列表+新增按钮，右栏 ProfileForm 表单；模型清单行 pi-model-row 两行卡片 + FetchModelsDialog 入口）
- `ShortcutsTab.tsx` — 快捷键清单 tab（从 hotkey-registry listHotkeys 自动渲染，只读；数据源见 infra.md hotkey-registry）
- `ExtensionStatusLine.tsx` — 受控浏览器小节的扩展状态行（未连接时安装引导卡：三步指引+目录路径复制/打开+自定义副本动作条——「复制到自定义」「恢复默认」与落后时「用内置版覆盖副本」，源 `getExtensionDirPath` 返回 `{ path, source, outdated }`；已连接时若加载 custom 副本则展示副本路径与同款动作条；ExtensionStatus 类型源在 browser.md）
- `AbilityTab.tsx` — 能力标签页编排（只读展示，启停配置在场景页）：列表态按三大类分组（分组头数据取 getSceneOverview.categories，CATEGORY_FALLBACK 兜底；规则包卡+能力包卡+自定义 skill 行+系统行为卡）/详情态按 selectedKey 路由（workspace-rules/global-rules→规则包编辑页、`skill:` 前缀→自定义 skill 二级页（CustomSkillDetailPage，SKILL.md 编辑器）、`__system__`→SystemBehaviorDetail、包 key→AbilityPackDetailPage）
- `ability/` — 能力页组件（全部只读）：RulesPackCard/RulesPackDetailPage（工作区+全局规则合并卡与双编辑器，编辑器保留）、AbilityPackCard/AbilityPackDetailPage（skill 型包 chips 查看切换+SKILL.md 渲染+skill 明细启用徽标；段型包 SegmentBlock）、AbilityPackSidebar（包类型徽标+配套工具组+加载情况）、AbilityMountsSection（挂载矩阵行列表：主会话/子会话各 Profile/任务执行会话 + 三条后台任务行——定时自定义任务 loaded 按 resolveAbilities sceneOverride:'scheduler' 驱动、reason 与场景页 schedulerCell 口径对齐，可选包按工作区工具包命中，话题状态抽取/文章解析恒 false；行徽标「后台任务/子会话/系统预设」）、SystemBehaviorDetail、BasicToolsSection、CustomSkillsSection/CustomSkillDetailPage（自定义 skill 列表与二级编辑页，与规则包详情同构）、config-mutations.ts（装配开关写回算法共享模块：applyPackToggle/applySkillToggles/applyScenePackToggle 纯函数+createConfigPersister 乐观更新工厂+buildSkillToPacks/packToggleLinksOf/EMPTY_CONFIG，消费方为场景页）、pack-meta.ts（PACK_TYPE_LABELS+CATEGORY_FALLBACK 分组兜底）
- `scene/` — 场景标签页（全部能力启停唯一入口，两层配置模型 v2）：SceneTab（五行侧栏：主会话/子会话/任务执行会话/定时自定义任务四 matrix 行 + 文章解析 summary 行；matrix 行按 ScenePackCell.state 三态渲染——switchable 开关/forced「强制」徽标/excluded 灰显排因，开关写回经 config-mutations 写底层真源：main=abilityOverrides、sub/executor/scheduler-custom=sceneOverrides 对应键（恢复默认=删整键回跟随工作区），写后重拉 overview；sub/scheduler 扩展组撤格子换 groupNotes 一句话+派遣页跳转，scheduler 行首含基础工具 forced 合成格且 shunt/scheduler 包结构排除，executor/scheduler 行 header 带「前往任务面板」按钮，executor 行附单段通用执行提示词模板与挂载说明，summary 行展示固定提示词；底部跳转子会话派遣页）、SceneAbilityRow（三态单格行：开关/强制/排除徽标+reason+右上状态徽标，展开子开关区仅 code-workflow 有）、ScenePromptsPanel（提示词展示面板：正文 MarkdownRenderer 富渲染随页面滚动，executor 行随行 content 直渲染+extensionNote，parse-article 走只读路由拉取）
- `WorkspaceManagementTab.tsx` + `WorkspaceListNav.tsx` — 工作区管理（左右布局：左列 220px 工作区列表——快照状态点/当前/默认/快照关徽标，底部「丢失的会话」入口与「添加工作区」按钮（复用主界面创建 IPC）；右栏两态：WorkspaceDetail（路径/删除/快照开关+排除目录）+ SnapshotConfigSection（快照全局规则），或 OrphansPanel（丢失会话扫描：导入=合并索引保源、舍弃=删源目录二次确认））
- `SubAgentTab.tsx` + `subagent/ProfileEditor.tsx` + `subagent/AbilityBlockRow.tsx` — 子会话派遣标签页（左右布局实时保存，无 draft/commit：左列 Profile 列表——启用状态点/内置徽章（default 标「默认」余「内置」）/停用置灰 + 新建按钮；右栏头部名称输入（内置禁改）+「复制为副本」（内置，新 UUID+「副本」后缀防重名）或「删除」（自定义，showConfirm）+ 启停 Switch（非 default）；ProfileEditor 直写 setLocal 真源：描述/模型/超时/基础工具可点 chip/能力域）；能力域按能力包块化渲染（数据源 `client.getAbilityPacks()`，失败显示错误行+重试）：article/web-mcp 单开关、stock 单开关（直通包内全部 skill 与工具包，无细选）、code-workflow/自定义 skill 块开关+细选 Checkbox Popover、browser 单开关（齐开齐关 browser+extension 双字段，与装配语义一致）；memory 归场景页「子会话」行（enabledAbilities.memory 字段保留仅数据兼容，UI 与解析均不消费）；写回走 enabledAbilities 原字段（数组只增删包内名，存量混入名保留），交付通信为固定启用行
- `pi-model-row.tsx` — 模型清单行：ID 行内编辑、窗口徽标手填（parseContextInput 解析 1M/200K 写法）
- `FetchModelsDialog.tsx` — 上游模型拉取弹窗（探测兼容端点模型列表，勾选后合并入清单）
- `SettingsControls.tsx` — 设置分组/行共用控件（SettingsGroup 等，多 Tab 复用）
- `ToolDetailDialog.tsx` — 工具详情弹窗（AbilityPackDetailPage / SystemBehaviorDetail 消费）
- `pi-model-badges.tsx` — 模型行徽标（窗口/输出上限/价格，内聚编辑态）

## 工作区相关组件

- `components/WorkspaceSwitcherPopover.tsx` — 工作区切换器（对话列表头部 + 无工作区兜底页；选择/添加）
- `components/WelcomeFirstRun.tsx` — 零工作区首次启动引导
- `components/ModelSelector.tsx` — 通用模型选择下拉（按 Profile 分组、按 modelId 去重、可选「不指定」）

## Store 与 lib

- `stores/settings-store.ts` — 应用设置加载/保存（整体 save 模式）+ subTabFocusReq 跳转请求（requestSubTabFocus/consumeSubTabFocus，SettingsPage 消费切子 tab）
- `lib/setup-settings-sync.ts` — 监听 settingsChanged 热更（主题/字号即时生效）
- `lib/model-selection.ts` — 模型选择纯函数（dedupeProfileTiers/sameSelection/resolveModelLabel，ModelSelector 与设置页共用）

## 服务与类型

- `services/settings-service.ts` — 设置 JSON 存储（`.dogear/settings.json`）+ normalizeSettings 幂等迁移（含 failover 链维护、SubAgent 四内置预设 default/browser-parse/explore/stock：同名自建「探索/股票」收编改挂内置 slug 且配置字段继承、缺失补齐、name/description 以代码模板为单一真源无条件接管（消灭 LEGACY 旧值迁移链）、能力域只补缺失键显式 false 不动，enabled/model/超时用户自治；同步带入的已下架残留字段（如 webAiSites）清洗丢弃）；applySyncOptionsPatch 同步选项补丁（disabledSyncItems 白名单清洗、userSyncPaths 归一，六个 rev 组字段实际变化才 syncOptionsRev++）
- `services/workspace-json-service.ts` — 工作区 JSON 存储（`.dogear/workspaces.json`），增删触发 workspace-watcher 起停；启动时 removeLegacyPersonalWorkspace 一次性清理临时会话遗留目录（下个大版本可移除）
- `services/workspace-config-service.ts` — 工作区能力配置（`workspaces/{id}/config.json`）
- `services/claude-config-service.ts` — 提示词文件管理（工作区级 `.dogear/workspaces/{id}/agent.md` / 用户级 `.dogear/agent.md`）+ `.claude/agents/`（tipc/claude-config.ts 载体；规则包编辑器后端）
- `services/settings-diff.ts` — 设置域映射（ui=广播热更 / perCall=按次读取 / snapshot=PiSession 快照标脏；「按 diff 分层生效」的实现文件）；unattendedChanged 真逻辑在 pi-session-manager 分发处（开启：活跃 main 会话 resolveAllPendingPermissions + takeOverForUnattended + 批量跳过挂起介入 + 飞书直连推送；关闭：restoreFromUnattended + 取消在途退避重试）
- `BehaviorTab.tsx` 基础页含 ai.unattended「无人值守」开关（默认关：权限全放行/介入自动跳过/断联退避重试/关键事件推飞书）
- `services/workspace-recovery-service.ts` — 孤儿工作区扫描与合并导入（OrphansPanel 后端）
- `services/snapshot-exclusion-scan.ts` — 快照排除目录对照扫描与清单读写（tipc/git.ts + 启动迁移 + 新工作区注册钩子）
- `types/settings.ts` — AppSettings/ModelProfile/ModelTier/SubAgentProfile/permissionMode 等与 DEFAULT_SETTINGS（与 electron/main/services/settings-types.ts 主进程镜像双份，共享类型改需两处同步）；主进程 settings-types.ts 另有 SETTINGS_SYNC_FIELDS 跨设备传播白名单（9 项通用偏好，白名单外含未知新字段一律保本端）

## 注意

- 能力元数据唯一来源 `getAbilityPacks()`（前端零硬编码，residentToolGroups 同接口下传）；场景总览 `getSceneOverview({ workspaceId })` 返回七场景行（五 matrix+两 summary）+三大类分组头，子会话/定时任务扩展组多为 groupNotes 文字而非包格子
- 设置保存为主进程按 diff 分层生效：快照域标脏受影响 PiSession，无整体重启链路
- 包开关联动算法在 `ability/config-mutations.ts`（applySkillToggles 原子双写；有 Skill 的包总开关联动补齐包内 skill 与工具包只补不删，无 Skill 纯工具包开关直接写 enabledToolPacks），能力页只读无写路径，写回入口在场景页
- 子会话扩展能力实际生效 = Profile 勾选 ∩ 工作区能力包开关（交集语义）；固定层（memory 等）归场景页「子会话」行 sceneOverrides.sub 裁决，不查 Profile；SubAgentProfile.enabled 仅非 default 有意义（停用后系统提示词不列出、startChild 拒绝）
- failover 链（AppSettings.failover）由 normalizeFailoverChain 在 normalize 尾部维护：新供应商追加链尾、删供应商移出、tier 失效回退、piModels 为空不进链
- 设置保存联动走 updateSettings → broadcastSettingsChanged → setup-settings-sync（同窗口自收自发）

## 数据流

- 模型选择：对话创建时 tipc 注入 settings.ai.defaultModelSelection 浅拷贝 → ChatInputArea 的 ModelSelector 切换 → conversation-store.setConversationModelSelection 写库 → useSendMessage 发送前 reconcile（null 拦截；同 profile 换 tier 走快速路径，跨 profile 返回 needsRestart 触发会话重启）；插话路径跳过 reconcile 沿用会话原模型
