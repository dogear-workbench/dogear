# 浏览器三期 P1（扩展只读工具链 + 域名授权 + 入库工具）实施计划

**目标**：把 P0 单向快照链路升级为双向命令通道——agent 在用户真实浏览器的已授权页面上 observe/click/fill/read_text（同构一期语义，L0/L1 护栏内自动执行），并补齐浏览器子会话「读到 → 存入文章库」断链。

**架构思路**：帧协议 v2 加 requestId 请求-响应（command/command_result 两帧 + protocolVersion 协商）；gateway 加 pending map；扩展侧每命令 executeScript（无常驻 content script），ref 用 data-dogear-ref 页面属性自持；域名授权走 optional_host_permissions + popup 手势；password/submit 硬护栏。排除：a11y 树（P3）、自动重连、多会话、L2+ 写入。设计全文见 [../browser-extension-p1-design.md](../browser-extension-p1-design.md)。

**涉及模块**：`extension/`（manifest/popup/background/dom-actions/nm-protocol）、`electron/main/services/browser/`（nm-protocol/browser-gateway/browser-action-stream）、`electron/main/tipc/browser.ts`、`electron/main/agents/tools/`（extension-tools 新建 + browser-tools 补 save_article）、settings 双份类型 + normalize + 设置页 + SubAgentTab。

## 步骤索引

- [x] [Step 1: 帧协议 v2 + gateway 命令通道](./step1-protocol-command.md) — protocolVersion 协商、command/command_result 帧、sendExtensionCommand + pending map + 断连/超时清理（纯主进程侧，可单测）
- [x] [Step 2: 扩展侧命令执行 + 风险护栏](./step2-extension-actions.md) — dom-actions.js 四纯函数平移（含 ref 属性机制、fill input 事件派发）、background 命令分发（tabId/url 竞态校验、guard_password/guard_submit）、命令成功回推 tab_snapshot
- [ ] [Step 3: 域名授权链路](./step3-host-permission.md) — manifest optional_host_permissions、popup 授权/撤销 UI、授权状态帧与 gateway 汇聚（authorizedOrigins + 设置页展示）、gateway 命令前置 origin 校验
- [ ] [Step 4: 工具层 + 能力域 + save_article](./step4-tools-profile.md) — dogear-extension 工具组四工具、extension 能力字段（双份类型 + normalize + SubAgentTab + 浏览器解析 Profile）、动作流 source='extension'、dogear__browser__save_article（B 项）
- [ ] [Step 5: 端到端验收](./step5-e2e-acceptance.md) — headful 真实链路全用例（授权/observe/click/导航/read_text/护栏/四类竞态）、「搜索→readText→save_article」子会话闭环、全量回归

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

（全部完成后填）
