# 浏览器文章读取一期 实施计划

**目标**：Playwright 受控浏览器作为文章解析兜底层——JS 渲染/展开/登录墙页面可正常出结果，登录场景「递到面前」，Agent 获得浏览器工具包与动作流可视化。

**架构思路**：浏览器层插进 tipc parseArticle 现有编排（平台脚本 → Readability → 浏览器 → AI 兜底），手动路径与 Agent 路径共用 `browser-article-service`；`BrowserManager` 全局单例（headful + `--start-minimized`）+ 队列串行。设计全文见 [../browser-article-design.md](../browser-article-design.md)。

**涉及模块**：`services/browser/`（新增三文件）、`agents/tools/browser-tools.ts`、`tipc/article.ts`、`permission-rules.ts`、`article-service.ts`（小重构）、渲染层（article-store / BrowserPanel / renderer-handlers）、`resources/browser-eval/`。

## 步骤索引

- [x] [Step 1: BrowserManager 地基](./step1-browser-manager.md) — Playwright 依赖 + 实例单例（队列/懒启动/空闲关闭/置前/崩溃自恢复）
- [ ] [Step 2: readArticle 核心服务](./step2-article-service.md) — 渲染等待、展开启发式、登录墙检测、复用静态解析后段落盘
- [ ] [Step 3: tipc 编排接入 + 登录墙前端流程](./step3-tipc-login-flow.md) — 链路插入、`need_login` 状态、窗口置前 + toast + 重试按钮
- [ ] [Step 4: Agent 工具包 + 权限映射](./step4-agent-tools.md) — readArticle 声明式 + 原子工具集 + observe 压缩 + permission-rules
- [ ] [Step 5: 伴随面板动作流](./step5-action-panel.md) — action-stream 环形缓冲 + 广播 + BrowserPanel 第五 tab
- [ ] [Step 6: 测试基建与基线](./step6-eval-baseline.md) — 六类测试页 + 15 任务 + runner + 便宜档成功率基线

## 全局决策

- **命名**：主进程服务目录 `electron/main/services/browser/`；工具包 server 名 `dogear-browser`；工具名 `dogear__browser__readArticle` 等（原子工具同为 `dogear__browser__` 前缀）
- **profile 位置**：全局配置目录下 `browser-profile/`（登录态跨工作区共享），路径获取对齐现有 configDir 解析方式；不落工作区
- **窗口形态**：`launchPersistentContext({ headless: false, args: ['--start-minimized'] })`，单 tab（manager 只维护一个 page）
- **parseStatus**：不加浏览器专属成功态，成功沿用 `fixed`；路径区分记录在 parse history 的 `layer` 字段（`script` / `readability` / `browser` / `ai`）；新增 `need_login` 状态
- **权限**：只读原子工具（navigate/observe_page/read_text/wait_for/screenshot/close）在工具包启用时放行；`readArticle`/`click`/`fill` 在 default 模式逐次确认（工具包放行不覆盖这三个），autoExecute 全放行
- **错误约定**：工具层 `isError: true` 不抛；服务层 throw 由编排层包装分类（need_login / timeout / parse_empty / browser_crash）
- **超时**：readArticle 任务级 60s、原子单步 30s、队列排队不设上限但任务有超时兜底（数值实施可调）
- **规范**：不写注释；UI 文案中文；主进程改动后 `bun run build:electron`
