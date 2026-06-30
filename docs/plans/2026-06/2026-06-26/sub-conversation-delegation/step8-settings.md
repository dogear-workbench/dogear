---
step: 8
title: 设置页派遣配置
status: done
---

## 目标

让用户可在设置页配置子会话默认模型、权限模式、超时分钟数。Step 1 已经把 `AppSettings.subAgent` 字段落了，本步只是给个 UI 写它。

## 依赖上下文（接力棒输入）

- Step 1 落了 `AppSettings.subAgent = { modelSelection?, permissionMode?, timeoutMinutes }`，DEFAULT_SETTINGS 默认值 `{ permissionMode: 'bypassPermissions', timeoutMinutes: 30 }`
- 现有设置页：`app/settings/page.tsx` 是纵向 Tab 容器；各 Tab 文件如 `WorkspaceConfigTab.tsx` / `PersonaTab.tsx`
- 现有 ModelSelector 组件支持「不指定」option（缺省走 ai.defaultModelSelection 兜底）
- 现有 settings 走「整体 save 模式」+ dirty 检测，本步遵循同套

## 计划改动

### 1. `app/settings/SubAgentTab.tsx`（新文件）
- 三块控件：
  - **默认模型**：复用 ModelSelector，allowEmpty=true，placeholder「跟随主会话默认模型」
    - 绑定 `settings.subAgent.modelSelection`
  - **权限模式**：Radio / Select，三选项：
    - `bypassPermissions` — 全自动通过（推荐，默认）
    - `acceptEdits` — 自动通过编辑类，Bash 仍需确认（在子会话 tab 内确认）
    - `default` — 所有需权限的工具都要确认
  - **超时分钟数**：NumberInput，min=1 max=180，默认 30
    - 说明文案：「子会话独立运行的最长时间。超时会被强制 abort 且 WaitForDeliveries 收到 status:timeout。Agent 调 WaitForDeliveries 时可传 timeoutMs 覆盖此默认值」
- 顶部说明卡：简述「子会话 = agent 自动派遣的独立 conversation。这些配置控制其默认行为，单次派遣不可改」

### 2. `app/settings/page.tsx`
- 在 Tab 列表加「派遣」一项，icon 用 lucide `Send` 或 `Workflow`
- 路由到 SubAgentTab

### 3. 文案 / 边界
- 模型未选时不报错（缺省自动走 defaultModelSelection），保存时也允许 null
- timeoutMinutes 输入校验：非数字 / <1 时禁用保存按钮
- 不需要新建 IPC——saveSettings 已经全量写整个 AppSettings

### 4. 文档更新
- 修改 `.claude/rules/codebase-map.md`：
  - 「页面」节加 `app/settings/SubAgentTab.tsx — 子会话派遣配置标签页`
  - 「类型」节 `settings.ts` 描述里追加 `subAgent` 字段
- 修改 `CLAUDE.md`（如有相关章节，否则不动）

## 验证

- `bun run build:electron` 通过
- `bun run lint` 通过
- 手测：
  1. 打开设置 → 派遣 Tab → 改模型为 Haiku，权限为 acceptEdits，超时 5min
  2. 保存
  3. 主会话派一个子会话
  4. 子会话应使用 Haiku 模型（看 chat 区模型徽章 / usage 详情）
  5. 子会话调 Bash 应弹权限请求在子会话 tab 内
  6. 子会话故意空跑 6 分钟应 timeout（手测耗时长，可暂时把默认改 1min 验证后改回）
- 设置改回默认（modelSelection 留空 + bypassPermissions + 30min）验证回归

## 实施回填

### 实际改动

**与计划差异**：
- **同步了渲染层 types/settings.ts 的 `subAgent` 字段**——Step 1 当时只落到了主进程 settings-types.ts，renderer 这边类型残缺，本步顺手补上。同时给 `ai.permissionMode` 联合类型加上了 `'bypassPermissions'`（之前 renderer 缺这个值导致设置 store 类型不兼容）
- main 端 `subAgent.modelSelection` 从 `ModelSelection` 改为 `ModelSelection | null` 以与 renderer 对齐——null 是「ModelSelector 不指定」选项的实际返回值，原先非 null 类型会让 store 同步报 ts2322
- SubAgentTab 三块控件 + 顶部说明文案完全按设计走；权限模式仅暴露 3 种（bypass / acceptEdits / default），刻意去掉了 plan / dontAsk 两个对子会话没意义的模式（plan 会让子会话什么都不干，dontAsk 已被 bypass 覆盖）
- timeoutMinutes 走 `clampTimeout` 兜底 [1, 180]，输入框 onBlur 强制夹紧，避免空字符串 / NaN 写库；不像设计文档说的"非数字时禁用保存按钮"——直接在输入层夹紧更稳，不污染顶部保存按钮 dirty 检测
- 没有改 `CLAUDE.md`（无相关章节可改）
- 代码地图同步了：「页面」节加 SubAgentTab；types/settings.ts 描述追加 `subAgent` 字段说明

**改动文件清单**：
- `types/settings.ts`：`ai.permissionMode` 联合追加 `'bypassPermissions'`；新增 `AppSettings.subAgent` 字段；DEFAULT_SETTINGS 补 `subAgent: { permissionMode: 'bypassPermissions', timeoutMinutes: 30 }`
- `electron/main/services/settings-types.ts` L83：`subAgent.modelSelection` 类型放宽到 `ModelSelection | null`
- `app/settings/SubAgentTab.tsx`（新建，108 行）：默认模型 ModelSelector + 权限模式 radio 3 选 + 超时分钟数 NumberInput
- `app/settings/page.tsx`：导入 SubAgentTab + 左侧 Tab 列表追加「子会话派遣」+ 注册 TabsContent
- `.claude/rules/codebase-map.md`：「页面」节加 `app/settings/SubAgentTab.tsx` 说明 + `settings.ts` 描述追加 `subAgent` 字段

### 完成总结（Phase 2 整体）

Phase 2 全部 8 步落定。从 Step 1 数据基础到 Step 8 设置 UI，子会话委派链路成 first-class 能力：

**能力清单**：
- 主会话有 6 个委派工具（DelegateTo / DelegateBatch / WaitForDeliveries / StopChild / ListChildren / SendMessageToChild / ReplyToChild）
- 子会话有 2 个工具（SubmitDelivery / AskParent）
- 子会话权限 + 模型 + 超时全部可在设置页配置（继承链：父对话 modelSelection → subAgent.modelSelection → defaultModelSelection）
- 反向通信（AskParent / ReplyToChild）打通子→主请求池
- 列表 UI 嵌套显示子会话 + 状态角标 + 父行「⏳N」徽章 + 一键点入独立 tab
- 子会话 chat 顶部 banner 显示父会话 / 交付路径 / 状态
- 主会话「🛑 中断等待」按钮逃生通道（不杀子会话 session）

**子会话默认模型在哪些路径被真正生效**：
- bridge.startChild 内一次性 resolve：`parent.modelSelection ?? settings.subAgent.modelSelection ?? settings.ai.defaultModelSelection ?? null`
- conversation 创建时浅拷贝写入子会话的 `modelSelection`，**后续 fork / sendMessage / 重启会话**都从子会话自身的 modelSelection 读，**不再回查 settings**
- 这意味着：用户改 subAgent.modelSelection 后，**已存在的子会话不会受影响**，只有新派遣的子会话会使用新值

**codebase-map.md 已同步**：是。

**已知坑 / 待办（Phase 2.5 候选）**：
- bridge 内存丢失（app 重启）后子会话在前端列表里彻底消失，对应 conversation 仍在 conversations.json 但被 `role !== 'sub'` 过滤掉。若要"孤儿恢复"需要：① 重启时扫 conversations.json 把 role='sub' 的拉回 bridge state（status='unknown' / 'cancelled'）② 前端 section 决定是否展示 orphan sub
- AskParent reject 后子 agent 行为没实测覆盖。如果观察到子 agent 拿到 isError 后反复重试 AskParent，应在 bridge 加「该回合内已 reject 过则后续 AskParent 直接 isError」标记
- DelegateBatch 中途失败回滚已有日志但没 toast；agent 看 isError 即可，前端没 UI 反馈
- 中断等待目前**不**杀子会话 session（设计如此）。若实战发现浪费严重，可扩展 `abortWaitForDeliveries({ stopChildren?: boolean })`
- `deliveriesAwaitChanged` 事件 emit 着但前端没用（awaitCount 已从 childrenByParent derive）。留作未来精细化用
