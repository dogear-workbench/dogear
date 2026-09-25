# 网页 AI 白嫖框 + 浏览器数据全局管理 实施计划

**目标**：白嫖框（免费网页 AI 哨兵 tab）+ 内嵌浏览器全局单分区（含旧分区迁移）+ 数据中心「浏览器数据」管理面板。

**架构思路**：复用两个现成先例——飞书哨兵 tab 模式（`FEISHU_TAB_ID` 同构）与 BrowserPageView 占位容器 bounds 上报模式；embedded-browser-manager 加「用户常驻 tab」语义（免 TTL）。排除：登录态/缓存分开管理（Electron 分区不支持）、白嫖框独立分区（违背登录态全局精神）、多开网页 tab（污染 tab 模型）。设计全文见 [../web-ai-tab-and-browser-data-design.md](../web-ai-tab-and-browser-data-design.md)。

**涉及模块**：`electron/main/services/browser/embedded/`（profile/manager）、新增 `browser-data-service.ts`、`electron/main/tipc/`、`stores/session-store.ts`、`app/page.tsx`、新增 `components/webai/`、`components/conversation-list/`、`components/data-center/`、设置页、settings.json schema。

## 步骤索引

- [x] [Step 1: 全局单分区重构 + 旧分区 cookie 迁移](./step1-global-partition.md) — profile.ts 固定全局分区，启动时合并旧工作区分区 cookie 并删旧目录
- [x] [Step 2: 白嫖框 tab 呈现链路](./step2-webai-tab.md) — 哨兵 tab + WebAiPanel + bounds 上报/attach + 主进程常驻 tab + 临时会话区入口 + 站点切换
- [ ] [Step 3: 站点配置管理](./step3-site-config.md) — settings `webAiSites` schema + 设置页增删改编辑 UI，tab 切换器联动
- [ ] [Step 4: 数据中心浏览器数据面板](./step4-browser-data-panel.md) — cookie 域名聚合查询 + 按域登出/清除 + 清缓存 + 全部清除

## 全局决策

- **分区**：全局唯一 `persist:dogear-browser`（profileKey 固定 `'global'`），agent 内嵌浏览器与白嫖框共用；旧 `persist:dogear-browser-{sha256}` 分区 cookie 启动时一次性合并（按扫描顺序后者覆盖同 cookie），成功后删除旧分区目录
- **哨兵常量**：`WEB_AI_TAB_ID = '__webai__'`（session-store，不落盘，进 `SENTINEL_TAB_IDS`）
- **settings schema**：`webAiSites: [{id: string, name: string, url: string}]`，预置 DeepSeek（https://chat.deepseek.com）/ Kimi（https://kimi.moonshot.cn）/ 豆包（https://www.doubao.com/chat）
- **IPC 红线**：全部走 `@egoist/tipc`，禁止直连 ipcMain/ipcRenderer；确认弹窗统一 `showConfirm()`（confirm-store）
- **用户 tab 语义**：embedded-browser-manager 新增用户来源 tab，不进 TTL 兜底回收，retain 持有到应用退出
- **域名归一**：cookie.domain strip 前导点，内置常见多段后缀表（com.cn/net.cn/org.cn/gov.cn/edu.cn/co.uk 等）归到注册域
- 主进程代码改动后需 `bun run build:electron` 才生效；不写注释（项目规范）
- 所有清除类操作必须 `showConfirm` 二次确认，文案提示「agent 正在跑浏览器任务可能受影响」
