# 网页 AI 白嫖框 + 浏览器数据全局管理 设计

**日期**：2026-09-25
**状态**：已与用户对齐

## 背景

- DeepSeek / Kimi / 豆包等有功能齐全的免费网页版，希望作为「临时会话」的免费替代入口，随时可切的一等公民 tab
- 内嵌浏览器登录态按工作区分区（`persist:dogear-browser-{sha256(workspaceId)}`），跨工作区要重复登录，对单用户工作台隔离价值虚、成本实
- 浏览器数据（登录态/缓存）只进不出，黑盒增长，无处查看管理

## 目标

1. 临时会话分区加「网页 AI」入口，打开单个哨兵 tab，内嵌可配置的免费 AI 站点列表，tab 内顶栏切换站点
2. 内嵌浏览器改为**全局单分区**，登录一次处处可用；旧工作区分区 cookie 一次性迁移合并
3. 数据中心新增「浏览器数据」面板：按域名展示（登录态标识 + 占用）+ 按域登出/清除 + 清缓存 + 全部清除

## 架构

### 白嫖框（Web AI tab）

- **哨兵 tab 模式**，与飞书 tab 同构：`WEB_AI_TAB_ID = '__webai__'` 哨兵常量（session-store，不落盘），`SENTINEL_TAB_IDS` 纳入；page.tsx 常驻挂载 `WebAiPanel` 按 activeTabId 切 display
- **复用 embedded-browser-manager**：`openTab` 一个 tab（source 标记用户 tab），**不走 agent 的 TTL 兜底回收**，生命周期 = 应用生命周期（tab 打开后常驻，应用退出销毁，登录态在分区不丢）
- **呈现**：`WebAiPanel` 内占位容器（同 `BrowserPageView` 模式）ResizeObserver 上报 bounds → IPC → manager.attachToWindow；切走 tab / 面板卸载上报 null → detach（tab 保留不销毁）；弹层遮挡走同款 visibility 切换
- **站点切换**：切换器改 tab URL（manager.navigate）或关旧开新（实施时定，倾向 navigate 保留会话历史）
- **站点列表**：settings.json 新增 `webAiSites: [{name, url}]`，预置 DeepSeek / Kimi / 豆包；设置页提供增删改编辑

### 全局单分区

- `profile.ts`：`resolveProfileKey(workspaceId)` 废弃，统一返回固定 key（如 `global`）→ `persist:dogear-browser`
- 白嫖框与 agent 内嵌浏览器**共用同一全局分区**：白嫖框登录 DeepSeek 后 agent 访问同站也是登录态（用户明确要的效果）
- **一次性迁移**（启动早期、任何 tab 创建之前）：扫描 `userData/Partitions` 下 `dogear-browser-*` 目录（含已删工作区的孤儿分区），各旧分区 `session.fromPartition().cookies.getAll()` → 合并写入全局分区；迁移成功后删除旧分区目录回收磁盘；localStorage 无法迁移，个别站点需重登（已与用户对齐可接受）

### 数据中心「浏览器数据」面板

- 数据源：全局分区 `session.cookies.getAll()` 按 domain 归一聚合（strip 前导点 + 内置常见多段后缀表归到注册域）；占用大小来自缓存 `getCacheSize()` + 分区目录磁盘体积
- 操作（全部 `showConfirm` 二次确认）：

| 操作 | 清理内容 | 实现 |
|---|---|---|
| 域名行「登出」 | 该域 cookie + localStorage | clearStorageData({origins}) + 逐 cookie remove 兜底 |
| 域名行「清除数据」 | 该域全部数据 | 同上（origins 集合从该域 cookie 域名构造） |
| 「清理缓存」 | 全部 HTTP cache | clearCache() |
| 「全部清除」 | 分区全部数据 | clearStorageData() 全量 |

- 确认弹窗提示：清除时若 agent 正在跑浏览器任务可能受影响

### 排除的选项

- **登录态全局 + 缓存按工作区拆分**：Electron 分区机制不原生支持，cookie 同步方案复杂易碎，放弃；缓存全局反而省磁盘（不再每工作区囤一份）
- **白嫖框独立分区**：违背「登录态全局」精神，修正为共用全局分区
- **多开网页 tab（每次点击新建）**：污染会话 tab 模型，单 tab 内切站点足够
- **跟工作流打通（往网页注入脚本填内容）**：第三方页面改版即坏、灰色地带，不做；正经打通走免费 API 供应商那条路

## 模块边界

**主进程**
- `electron/main/services/browser/embedded/profile.ts` — 分区重构 + 迁移函数
- `electron/main/services/browser/embedded/embedded-browser-manager.ts` — 用户常驻 tab 语义（免 TTL）
- 新增 `electron/main/services/browser/browser-data-service.ts` — cookie 聚合查询 / 按域清除 / 缓存清理 / 磁盘占用
- 新增 `electron/main/tipc/browser-data.ts` — 上述能力 IPC 路由；webai tab 开启/呈现 bounds 上报走既有 presentation 或独立 tipc（实施时定）
- settings 读写扩展 `webAiSites`

**渲染层**
- `stores/session-store.ts` — `WEB_AI_TAB_ID` 哨兵 + open/switch action
- `app/page.tsx` — WebAiPanel 常驻挂载
- 新增 `components/webai/WebAiPanel.tsx` — 站点切换器 + 页面视图占位容器
- `components/ConversationList.tsx` / `conversation-list/` — PersonalSection「+」旁 Globe 入口
- 数据中心 `components/data-center/` — 新增浏览器数据面板
- 设置页 — 站点列表编辑 UI

## 数据流

- 白嫖框打开：入口点击 → session-store openWebAiTab → WebAiPanel 挂载 → bounds 上报 IPC → 主进程 openTab(全局分区) + attachToWindow → 页面加载（分区登录态自动生效）
- 站点切换：切换器 → IPC navigate → manager 内导航 → 登录态同分区自动生效
- 浏览器面板：进入数据中心 tab → IPC list → cookies.getAll 聚合 + 目录大小 → 渲染域名列表 → 清除操作 → showConfirm → IPC 清除 → 重新 list

## 错误处理 / 边界情况

- 迁移期间任何旧分区读取失败：跳过该分区继续（启动不因迁移失败阻塞），记日志
- WebContentsView attach 目标窗口销毁：既有 pruneWindowEntries 机制覆盖
- 清除数据时 agent 正在用该分区：确认弹窗文案提示风险，不强制阻断
- 域名归一的边缘后缀（.com.cn 等）：内置常见多段后缀表启发式，个别罕见后缀拆行展示不影响功能
- 白嫖 tab 被关闭（哨兵 tab 关闭语义）：tab 销毁、分区保留，下次打开重登无需（登录态在）

## 未决问题（实施时定）

- 站点切换实现细节：同 tab navigate vs 关旧开新
- bounds 上报通道：复用 presentation.ts 体系 vs 独立轻量通道（companion 呈现语义与主区域常驻语义不同，倾向独立）
- cookie 迁移冲突策略（同 cookie 不同值）：按分区顺序后者覆盖，不做复杂合并
- 分区目录磁盘体积统计的采样时机（启动后异步统计，面板进入时刷新）
