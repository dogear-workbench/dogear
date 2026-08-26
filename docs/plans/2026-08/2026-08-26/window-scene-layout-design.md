# 窗口场景化布局改造设计

**日期**：2026-08-26
**状态**：设计已拍板，待写实施计划

## 背景

当前「设置」是全屏 overlay 盖住主界面，但里面 11 个 Tab 混装了三种东西：纯设置（低频表单）、数据查看（组卡/用量/历史，高频）、管理混合（定时计划/记忆）。为看一眼数据要付三层导航（进设置 → 纵向 tab → 找到内容），且 overlay 的「世界切换」感打断主界面上下文。同时 MarkdownFileDialog 模态浮窗承载长文阅读，点外部即关，阅读体验差。

讨论中确立的核心心智：**窗口 = 场景**。会话（主窗口）、账本（数据中心）、配置（设置）是三个互不打扰的场景；右侧工作台是「人机交互区域」，模块化插拔。工作区是**领域的划分**（在哪个领域干活），数据是**跨领域的资产**，两者正交——数据中心聚合全工作区数据，用筛选器区分，而不是复制工作区切换器。

## 目标

1. 设置页瘦身为纯设置并迁移到独立窗口
2. 新建数据中心独立窗口，承接所有高频查看/管理内容，支持跨工作区聚合
3. 删除无用的 Agent 监控窗口
4. MarkdownFileDialog 改非模态止血
5. 确立多窗口纪律，避免后续窗口膨胀带来复杂度

## 架构

### 最终容器图景

| 容器 | 内容 | 形态 |
|------|------|------|
| 主窗口 | 会话 + tab 系统（后续收敛为类别式）+ 右侧插拔工作台（文件/附加/话题 + 未来模块） | 现有 |
| 数据中心（新） | 组卡全库 / 用量 / 执行历史 / 解析历史 / 定时计划 / 主题记忆·画像，顶部「全部 / 某工作区」筛选器 | 独立窗口，按需创建关闭即销毁 |
| 设置（迁移） | behavior / abilities / profiles / sub-agent / 工作区管理 | 独立窗口，单例（已开则 focus） |
| 删除 | Agent 监控（header 按钮 + openMonitorWindow + agent-monitor/page.tsx） | — |

### 多窗口通信纪律（硬约束）

- **窗口之间不直接通信，全部只跟主进程对话**。真相源 = 主进程服务 + 盘上 JSON 文件
- 窗口本地 Zustand store 只放窗口本地状态（UI 折叠、tab 选中），禁止放需要跨窗口共享的数据；需要共享的状态上移主进程或盘上
- 每个窗口只订阅自己关心的事件，避免广播误伤（如 toast 在无关窗口重复弹）
- **轮询绑定 `visibilitychange`**：窗口不可见即暂停，恢复可见立即拉一次对齐状态（scheduler activity / digests / dashboard 轮询都适用）

### 设置迁移的三个关键机制

1. **保存后跨窗口联动**：设置窗口调保存 RPC 落盘后，主进程广播新增的 `settingsChanged` 事件；主窗口监听后刷新 settings-store + 触发会话重挂载（原 restartActiveSessions + triggerSessionRestart 链路的跨窗口化）
2. **窗口关闭 dirty 拦截**：点窗口 X 时主进程拦 close，向渲染进程询问是否有未保存更改，有则走既有 confirm 流程（放弃/保存/保存并重启）
3. **单例**：已开则 focus，照抄自选股窗口模式

### 排除的选项及原因

- **固定 tab 承载数据查看（原方案 A）**：tab 栏已挤；且 tab 系统本身要向「类别式」收敛（会话占一个入口、其他各一个），再加固定 tab 方向相反
- **右侧面板扩展做主力容器（原方案 C）**：96 栏太窄，组卡详情/用量明细放不下；右侧定位为插拔工作台（伴随式上下文），不是宽内容容器
- **设置居中大 Dialog**：实现最便宜，但与「窗口 = 场景」心智不一致，被独立窗口方案取代
- **命令面板 Ctrl+K / header 全局入口大收敛**：过度设计，砍掉；header 只做「删监控按钮 + 加数据中心按钮」的净零变化

### 性能与开销结论（讨论中确认接受）

- 每窗口约 50-150MB 内存、空闲 CPU 接近零；常态 2-3 窗口，规模可控
- 真正风险是隐藏窗口继续轮询 → 已由 visibilitychange 纪律覆盖
- 不采用「隐藏窗口常驻换秒开」，按需创建/销毁即可

## 模块边界

**删除**：
- `app/agent-monitor/page.tsx` 及其路由注册、header 按钮、`openMonitorWindow`（workspace-store）

**新增**：
- `app/data-center/page.tsx` 及子面板组件（从设置页平移改造：DigestsPanel / UsageTab / SchedulerPanel + HistorySheet / ArticleParseHistoryPanel / TopicsPanel / CoreProfilePanel，去掉设置页 dirty-表单外壳）
- 数据中心窗口创建函数（electron 主进程，照抄自选股/监控窗口模式）
- 设置窗口创建函数（单例）
- `settingsChanged` 广播事件（renderer-handlers）

**迁移**：
- `app/settings/page.tsx` 整体改造为独立窗口入口：移出 digests / usage / parse-history / scheduler / memory 的 TabsContent 与对应 import；删除全屏 overlay 外壳与 dirty 关闭拦截的 overlay 版实现（改为窗口级）

**修改**：
- `App.tsx`：移除 settings overlay 挂载
- `stores/ui-store.ts`：移除 settingsOpen / openSettings / closeSettings（openSettings 语义变为开窗口，挪到 workspace-store 或新 window-service 前端封装）
- `stores/settings-store.ts`：restartActiveSessions 链路改为监听 settingsChanged 事件驱动
- `components/MarkdownFileDialog.tsx`：改非模态（点外部不关闭 onInteractOutside preventDefault，Esc 关闭），dirty/内容状态不受影响
- `app/page.tsx` header：删 Agent 监控按钮、设置按钮改为 openSettingsWindow、新增数据中心按钮

**不动**：
- 右侧工作台三个现有 tab（文件/附加/话题）；插拔制模块注册接口留作未来项，本次不实施
- TopicPanel 当前组视角（背景/组卡摘要/共享文件）保留在右侧话题 tab——与数据中心全库视角是同一数据两个视角，双入口是有意的

## 数据流

- 数据中心各面板：打开时 RPC 拉取（digest / usage / scheduler / memory / article 全部走既有 tipc 路由，多数带 workspaceId 参数；筛选器切「全部」时用现有 listGroups 全量接口或补一个跨工作区聚合入参）→ 订阅既有广播事件（categoriesUpdated / manualTaskDone / scheduler activity）刷新
- 设置：窗口独立 React 树 + 独立 settings-store 实例（照抄 session-window 的独立初始化模式）→ 保存 RPC → 主进程 settings-service 落盘 → 广播 settingsChanged → 主窗口刷新 + 重挂载会话
- 触发类动作（重新提炼 / 重置分类 / 运行任务）在数据中心直接调既有 RPC，与现在设置页里的调用完全相同

## 错误处理 / 边界情况

- 设置窗口关闭时 dirty → 主进程拦 close 问渲染进程，确认后放行/取消
- 数据中心打开时后端任务正在跑 → 沿用各面板现有 activity 轮询与徽章逻辑
- 窗口销毁时未完成的手动任务 → 任务在主进程执行不受窗口关闭影响（现有架构已保证），历史照常落 run-history
- settingsChanged 广播到达时主窗口正在编辑会话 → 会话重挂载沿用现有 restart 逻辑的时序（实施时验证）

## 未决问题（留给实施时定）

1. **智能分类配置归属**：SmartCategoryPanel 的配置区（总开关/阈值/重置）跟定时计划一起进数据中心，还是留在设置？倾向数据中心（与补分类任务同处）
2. **数据中心工作区筛选默认值**：默认「跟随主窗口当前工作区」还是「全部」？倾向默认「全部」（数据中心定位是全局账本）
3. **跨工作区聚合接口缺口**：现有 listGroupDigests / getUsageStats 是否已支持不传 workspaceId 的全量模式，缺则补 RPC
4. **「重新提炼」入口是否双保留**：话题面板（单组）与数据中心（全库）都留，还是收敛到数据中心
5. **tab 类别式收敛**：用户提到会话 tab 要做成「类别区分、会话只占一个位置」——独立改造项，与本次窗口化正交，建议单独立项设计
6. **工作台插拔制**：模块注册接口、面板宽度分档——未来项，等模块数量超过 4-5 个再设计

## 实施批次建议（供写实施计划参考）

1. 止血：MarkdownFileDialog 非模态 + 删 Agent 监控（无依赖，可先做）
2. 设置窗口化 + settingsChanged 联动 + dirty 窗口拦截
3. 数据中心窗口骨架 + 各面板平移（组卡 → 用量 → 历史/解析 → 定时计划 → 记忆）
4. 收尾：设置页删掉已迁出 tab、header 按钮净零调整、doc-sync
