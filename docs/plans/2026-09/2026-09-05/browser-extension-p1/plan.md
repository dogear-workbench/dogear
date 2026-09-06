# 浏览器三期 P1（扩展只读工具链 + 域名授权 + 入库工具）实施计划

**目标**：把 P0 单向快照链路升级为双向命令通道——agent 在用户真实浏览器的已授权页面上 observe/click/fill/read_text（同构一期语义，L0/L1 护栏内自动执行），并补齐浏览器子会话「读到 → 存入文章库」断链。

**架构思路**：帧协议 v2 加 requestId 请求-响应（command/command_result 两帧 + protocolVersion 协商）；gateway 加 pending map；扩展侧每命令 executeScript（无常驻 content script），ref 用 data-dogear-ref 页面属性自持；域名授权走 optional_host_permissions + popup 手势；password/submit 硬护栏。排除：a11y 树（P3）、自动重连、多会话、L2+ 写入。设计全文见 [../browser-extension-p1-design.md](../browser-extension-p1-design.md)。

**涉及模块**：`extension/`（manifest/popup/background/dom-actions/nm-protocol）、`electron/main/services/browser/`（nm-protocol/browser-gateway/browser-action-stream）、`electron/main/tipc/browser.ts`、`electron/main/agents/tools/`（extension-tools 新建 + browser-tools 补 save_article）、settings 双份类型 + normalize + 设置页 + SubAgentTab。

## 步骤索引

- [x] [Step 1: 帧协议 v2 + gateway 命令通道](./step1-protocol-command.md) — protocolVersion 协商、command/command_result 帧、sendExtensionCommand + pending map + 断连/超时清理（纯主进程侧，可单测）
- [x] [Step 2: 扩展侧命令执行 + 风险护栏](./step2-extension-actions.md) — dom-actions.js 四纯函数平移（含 ref 属性机制、fill input 事件派发）、background 命令分发（tabId/url 竞态校验、guard_password/guard_submit）、命令成功回推 tab_snapshot
- [x] [Step 3: 域名授权链路](./step3-host-permission.md) — manifest optional_host_permissions、popup 授权/撤销 UI、授权状态帧与 gateway 汇聚（authorizedOrigins + 设置页展示）、gateway 命令前置 origin 校验
- [x] [Step 4: 工具层 + 能力域 + save_article](./step4-tools-profile.md) — dogear-extension 工具组四工具、extension 能力字段（双份类型 + normalize + SubAgentTab + 浏览器解析 Profile）、动作流 source='extension'、dogear__browser__save_article（B 项）
- [x] [Step 5: 端到端验收](./step5-e2e-acceptance.md) — headful 真实链路全用例（授权/observe/click/导航/read_text/护栏/四类竞态）、「搜索→readText→save_article」子会话闭环、全量回归

## 全局决策

- **不写注释**；UI 文案中文；工具/服务错误返回 `{content:[{type:'text'}], isError: true}` 语义化 errorCode，不抛异常
- **两份帧协议实现同步改**（extension/src/nm-protocol.js 与 nm-protocol.ts），不共享文件、语义必须一致；帧格式（4B LE 长度前缀 + UTF-8 JSON、64MB 上限）不变
- **errorCode 全集**（设计文档「错误处理」节 12 个）：not_connected/stale_protocol/timeout/disconnected/stale_tab/navigated_away/tab_closed/permission_denied/ref_expired/value_mismatch/guard_password/guard_submit——step1 定义 TS 联合类型，各步复用不新造
- **命令超时 30s**（对齐一期）；ref 格式 `eN`、属性 `data-dogear-ref`，与一期完全一致（agent 语义零迁移）
- **护栏硬编码不可配置**；宁可拦错（guard_submit 文案引导用户手动提交）
- **`extension/` 不进** tsc/eslint 工程（原生 JS 独立交付物）；runner/验证脚本一律 `node` 执行；主进程改动后 `bun run build:electron`
- **浏览器侧验证一律 headful**（NM/扩展无 headless 等价路径）；dev electron 必须 `NODE_ENV=development`（与安装版抢单实例锁教训）；验证环境用临时 DOGEAR_CONFIG_DIR 隔离，结束清理
- **涉及杀进程/装卸载的操作禁止按进程名杀宿主**（P0 step5 自杀事故教训）
- **版本**：本次开发期 0.1.102 起，发布时 bump

## 完成总结

**状态：全部完成**（2026-09-06，5 step 全绿，commit bd123c7 / 70d678a / e8ff838 / 245dabc / 本步收口 commit）。

**交付**：P0 单向快照链路升级为双向命令通道——agent 在用户真实浏览器的已授权页面上 observe/click/fill/read_text（L0/L1 护栏内自动执行），浏览器子会话「读到→存入文章库」断链补齐（dogear__browser__save_article）。

- **帧协议 v2**：protocolVersion 协商 + command/command_result 帧 + gateway pending map 全生命周期清理（30s 超时/断连/接管），旧扩展 stale_protocol 快速失败
- **扩展命令执行**：无常驻 content script，executeScript 注入纯 DOM 函数；ref `data-dogear-ref` 页面自持；guard_password/guard_submit 硬护栏；竞态四类 + 导航 lost 兜底（8s 注入超时竞赛 + URL 轮询）
- **域名授权**：popup 真实手势授权/撤销（optional_host_permissions）、permission_state 帧汇聚、gateway 前置 origin 校验（未授权快速失败不发出命令）、设置页 chip 展示、SW 冷启恢复
- **工具层**：dogear-extension 四工具（12 errorCode 全量中文映射）+ extension 能力域（双份类型/normalize/Profile 模板/SubAgentTab）+ save_article（workspacePath 显式传参）
- **验收**：逐步冒烟 + 最终 HEAD 上 49/49（含 stale_tab 真机构造、PiSession 装配反射验证、observe→read_text→save_article 序列闭环）；回归 lint 0 errors / build:electron / tsc / 管线 20/20；版本 bump 0.1.102；codebase-map 已同步

**人工遗留**（见 step5-e2e-acceptance.md 回填）：真实 PiSession agent loop 全链路（需关闭安装版后 dev electron）、Chrome 侧全链路（137+ 无法自动化）、真实 toolbar 手势、原生权限弹窗真人过一遍、设置页 chip 视觉、发布链路（0.1.102 安装包）。

**P2 输入**：导航后快照不自动更新（agent 无法自行恢复需用户重连）、自动重连/多 tab 多会话、guard_password 误拦登录页用户名框细化、老版本扩展升级引导消解、双链路工具引导（agent 偏向受控浏览器，需点名才走扩展）、主会话扩展状态感知（无查询通道）。
