# 浏览器文章读取一期 实施计划

**目标**：Playwright 受控浏览器作为文章解析兜底层——JS 渲染/展开/登录墙页面可正常出结果，登录场景「递到面前」，Agent 获得浏览器工具包与动作流可视化。

**架构思路**：浏览器层插进 tipc parseArticle 现有编排（平台脚本 → Readability → 浏览器 → AI 兜底），手动路径与 Agent 路径共用 `browser-article-service`；`BrowserManager` 全局单例（headful + `--start-minimized`）+ 队列串行。设计全文见 [../browser-article-design.md](../browser-article-design.md)。

**涉及模块**：`services/browser/`（新增三文件）、`agents/tools/browser-tools.ts`、`tipc/article.ts`、`permission-rules.ts`、`article-service.ts`（小重构）、渲染层（article-store / BrowserPanel / renderer-handlers）、`resources/browser-eval/`。

## 步骤索引

- [x] [Step 1: BrowserManager 地基](./step1-browser-manager.md) — Playwright 依赖 + 实例单例（队列/懒启动/空闲关闭/置前/崩溃自恢复）
- [x] [Step 2: readArticle 核心服务](./step2-article-service.md) — 渲染等待、展开启发式、登录墙检测、复用静态解析后段落盘
- [x] [Step 3: tipc 编排接入 + 登录墙前端流程](./step3-tipc-login-flow.md) — 链路插入、`need_login` 状态、窗口置前 + toast + 重试按钮
- [x] [Step 4: Agent 工具包 + 权限映射](./step4-agent-tools.md) — readArticle 声明式 + 原子工具集 + observe 压缩 + permission-rules
- [x] [Step 5: 伴随面板动作流](./step5-action-panel.md) — action-stream 环形缓冲 + 广播 + BrowserPanel 第五 tab
- [x] [Step 6: 测试基建与基线](./step6-eval-baseline.md) — 六类测试页 + 15 任务 + runner + 便宜档成功率基线

## 全局决策

- **命名**：主进程服务目录 `electron/main/services/browser/`；工具包 server 名 `dogear-browser`；工具名 `dogear__browser__readArticle` 等（原子工具同为 `dogear__browser__` 前缀）
- **profile 位置**：全局配置目录下 `browser-profile/`（登录态跨工作区共享），路径获取对齐现有 configDir 解析方式；不落工作区
- **窗口形态**：`launchPersistentContext({ headless: false, args: ['--start-minimized'] })`，单 tab（manager 只维护一个 page）
- **parseStatus**：不加浏览器专属成功态，成功沿用 `fixed`；路径区分记录在 parse history 的 `layer` 字段（`script` / `readability` / `browser` / `ai`）；新增 `need_login` 状态
- **权限**：只读原子工具（navigate/observe_page/read_text/wait_for/screenshot/close）在工具包启用时放行；`readArticle`/`click`/`fill` 在 default 模式逐次确认（工具包放行不覆盖这三个），autoExecute 全放行
- **错误约定**：工具层 `isError: true` 不抛；服务层 throw 由编排层包装分类（need_login / timeout / parse_empty / browser_crash）
- **超时**：readArticle 任务级 60s、原子单步 30s、队列排队不设上限但任务有超时兜底（数值实施可调）
- **规范**：不写注释；UI 文案中文；主进程改动后 `bun run build:electron`

## 完成总结

**六步全部完成**（2026-09-03，commit e5d0c0a → step6）。

| Step | 交付 | commit |
|---|---|---|
| 1 BrowserManager 地基 | Playwright + Chromium 就绪；单例 acquire/release 队列串行、懒启动、空闲 3 分钟关闭、before-quit 清理、CDP 置前/最小化、崩溃自恢复 + SingletonLock 清理。`--start-minimized` 在 Chromium 151 不生效，launch 后 CDP 主动最小化兑底 | e5d0c0a |
| 2 readArticle 核心服务 | article-service 抽出 parseArticleHtml/parseArticleDocument 纯函数（原管线行为不变）；readArticleWithBrowser：导航→渲染等待→登录墙检测→展开启发式→Readability，四类 errorClass，任务级 60s 含排队，need_login 自动置前 | 0eeac4a |
| 3 tipc 编排 + 登录墙前端 | parseArticle 链插浏览器层（成功 layer:browser / need_login 落 stub 广播不走 AI / 其余附原因转 AI）；前端 need_login 徽标 + 重试按钮 + 树条目锁图标；parse history 五写入点补 layer | f9807b9 |
| 4 Agent 工具包 | dogear-browser 九工具（readArticle + navigate/observe_page(ref 协议)/click/fill/read_text/wait_for/screenshot/close），单步 30s 含排队；权限：只读随包放行、readArticle/click/fill default 逐次确认（单测 20/20）；挂 article-parser 域四处挂载同步 | 7a7cb40 |
| 5 动作流面板 | 环形缓冲 500 条 + seq 竞态合并，手动解析与 Agent 工具双源接线，BrowserPanel 按任务分组卡片流，CompanionPanel 第五 tab | 37072a4 |
| 6 测试基建 | 六类测试页 + 15 任务（9 pipeline + 6 agent）+ runner；管线回归 9/9 PASS 可重复 | （本 commit） |

**量化结果与决策回填**：
- 管线回归 9/9 PASS（SPA 延迟注入 / 展开真实点击 / 登录墙 need_login / 懒加载 / 非标准容器均过）；翻页只取最长可见单页（约 1/3 内容）→ **翻页拼接记待补做（二期优先）**
- Agent 任务层基线**未采集**：子会话不可用浏览器工具包（SubAgentEnabledAbilities 无 browser 字段），6 个 agent 任务已定义、runner 跳过标注；二期采集条件见 baseline.md

**二期清单**（详见 resources/browser-eval/baseline.md）：①翻页拼接（含 URL 跳转型）②登录墙检测盲区修复（正文隐藏在标准容器内时 innerText 退化致漏判）③qualityHint 对无展开候选页恒存在的误示 ④Agent 基线采集（先补 SubAgentEnabledAbilities.browser + settings UI）⑤Chromium 打包分发策略（NSIS/便携版携带）⑥「轻反爬」场景把浏览器层前移（fetchRawHtml 403 时也进浏览器层）

**踩坑记录（重要）**：playwright 与 Bun 运行时不兼容（bun 下 manager.acquire 永久挂起），验证脚本/runner 必须 node 执行；主进程 evaluate 需 new Function 构造（tsconfig 无 DOM lib 且字符串 evaluate 不回传）；正文可见性度量须 innerText 而非 textContent
