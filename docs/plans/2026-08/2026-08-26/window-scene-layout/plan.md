# 窗口场景化布局改造 实施计划

**目标**：设置迁移为独立窗口并瘦身为纯设置；新建数据中心独立窗口承接组卡/用量/历史/定时/记忆等高频查看内容；删除 Agent 监控；MarkdownFileDialog 改非模态。

**架构思路**：窗口 = 场景。真相源全在主进程（服务 + JSON），窗口只做「拉取 + 订阅广播 + RPC 触发」，窗口间不直接通信。设计全文见 [../window-scene-layout-design.md](../window-scene-layout-design.md)。

**涉及模块**：`electron/main/index.ts`（窗口创建）、`electron/main/tipc/`（windows 路由新建 + agent.ts 删监控路由）、`src/App.tsx`（路由 + overlay 移除）、`app/settings/**`（瘦身）、`app/data-center/`（新建）、`app/page.tsx`（header）、`stores/`（ui-store / workspace-store / settings-store）、`components/MarkdownFileDialog.tsx`。

## 步骤索引

- [x] [Step 1: 止血与清理](./step1-quickfix-cleanup.md) — MarkdownFileDialog 非模态 + 删除 Agent 监控全链路
- [x] [Step 2: 设置窗口化](./step2-settings-window.md) — 设置迁独立窗口 + settingsChanged 跨窗口联动 + dirty 关闭拦截
- [x] [Step 3: 数据中心骨架与核心面板](./step3-datacenter-core.md) — 窗口骨架 + 工作区筛选 + 组卡/用量面板 + 轮询纪律落地
- [ ] [Step 4: 数据中心其余面板与设置瘦身收尾](./step4-datacenter-rest.md) — 定时/历史/解析/记忆平移 + 设置页删已迁 tab + doc-sync

## 全局决策

- **多窗口纪律（硬约束）**：窗口之间不直接通信，只跟主进程对话；窗口本地 store 禁放需跨窗口共享的状态；跨窗口通知一律走主进程广播事件
- **tipc 事件是定向发送**（`createRendererHandlers(...).xxx.send(event.sender, ...)`）：`settingsChanged` 需发给**主窗口**而非发起保存的设置窗口，用 `BrowserWindow.getAllWindows()` 或主窗口引用筛选目标（见 step2）
- **新窗口一律照抄自选股模式**：模块级单例变量 + 已存在则 focus + HashRouter URL + `closed` 置 null；按需创建、关闭即销毁，不做隐藏常驻
- **数据中心筛选器不是工作区切换器**：顶部 `全部 / 各工作区` Select，默认「全部」；组件 props 传 workspaceId（`string | 'all'`），不读 workspace-store
- **轮询绑定 visibilitychange**：数据中心所有轮询走统一 hook，不可见暂停、恢复可见立即拉一次对齐
- **错误处理**：RPC 失败 toast 后端文案（跟随 scheduler-store 惯例）；删除走 confirm-store 二次确认
- **主进程代码改完必须 `bun run build:electron`** 重新编译才生效
- **命名**：新 IPC 路由集中在 `electron/main/tipc/windows.ts`；页面目录 `app/data-center/`；事件名 `settingsChanged`

## 范围外（单独立项，本计划不做）

- 会话 tab 类别式收敛（会话占一个入口）
- 右侧工作台插拔制 / 模块注册接口 / 面板宽度分档
- 微信 Dialog、WorkspaceRuleDialog 等现有浮窗的形态调整

## 计划内拍板的未决问题

| 问题 | 拍板 |
|------|------|
| 智能分类配置归属 | 数据中心（与补分类任务同处） |
| 数据中心筛选默认值 | 「全部」（定位是全局账本） |
| SystemPromptPreviewTab | 留设置（系统契约查看与配置强相关） |
| 「重新提炼」入口 | 双入口保留：话题面板单组 + 数据中心全库 |
| 跨工作区聚合接口缺口 | step3 实施时逐个检查，缺则补 RPC，语义为「不传 workspaceId = 全部」 |
