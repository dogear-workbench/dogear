# 浏览器 WebSearch 实施计划

**目标**：给 agent 补搜索发现能力——`dogear__browser__search(query)` 走受控浏览器，引擎链 Google（patchright+代理）→ DDG HTML → Bing cn 全自动降级。

**架构思路**：声明式高层工具（同 readArticle 定位）+ 新建 browser-search-service（引擎编排/SERP 解析×3/验证页检测）+ manager 换 patchright 并注入按域 PAC（Google/DDG 域走 Clash 本地端口，其余直连，不受系统代理开关影响）。排除：百度（验证频率高）、依赖系统代理（不可控）、行为模拟（YAGNI）、第三方搜索 API（外部付费依赖）。设计全文见 [../browser-search-design.md](../browser-search-design.md)。

**涉及模块**：`services/browser/browser-manager.ts`、`services/browser/browser-search-service.ts`（新建）、`agents/tools/browser-tools.ts`、`services/settings-types.ts` / `settings-service.ts`、设置 UI、`resources/browser-eval/`。

## 步骤索引

- [x] [Step 1: patchright 引入验证 + PAC 代理改造](./step1-patchright-pac.md) — 风险最高先做：换 chromium import、pipeline 11/11 回归、launch 注入 PAC
- [x] [Step 2: browser-search-service + SERP 测试基建](./step2-search-service.md) — 引擎编排降级链 + 3 个 SERP 解析器 + mock 页 + 管线断言
- [x] [Step 3: 工具注册 + 设置项 + 设置 UI](./step3-tool-settings.md) — dogear__browser__search 落地 + 代理/引擎两个设置项 + 浏览器设置小节
- [ ] [Step 4: agent 基线 + 真实冒烟 + 收尾](./step4-baseline-smoke.md) — run-agent 加 search 任务、真实引擎冒烟、baseline 回填、doc-sync

## 全局决策

- **不写注释**；UI 文案中文；工具错误返回 `isError: true` 不抛异常；主进程改动后 `bun run build:electron`
- **runner / 验证脚本一律 `node` 执行**（playwright 与 Bun 不兼容，bun 下 acquire 永久挂起）
- **SERP 解析器写宽松多候选选择器**（Google 改版频繁），解析空返回 errorClass 风格 `parse_empty` + warning，不 AI 兜底
- **权限**：search 不进 BROWSER_INTERACTIVE_TOOLS（只读高频），不新增能力开关，跟随 browser 能力域（Profile 级 `ab.browser === true` 即注册）
- **红线**：不自动破解 CAPTCHA / 不绕风控；验证页 = 检测 + 降级 + 提示人工处理（可见窗口，持久 profile 记住）
- **代理语义**：`browserProxyServer` 空 = 仅 Bing；auto 引擎先做代理健康探测（轻量请求 2s 超时）再选 Google/Bing；PAC 域名清单：.google.com / .googleusercontent.com / .gstatic.com / .googleapis.com / .ggpht.com / duckduckgo.com
- **降级链顺序**：Google → DDG → Bing；每级降级记录原因，结果附 degradations；三级全失败才算 search 失败
- **patchright 兜底预案**：step1 回归不过则 Google 暂缓，仅 Bing+DDG（DDG 零检测不受 patchright 影响），在 step1 回填中明确标记
