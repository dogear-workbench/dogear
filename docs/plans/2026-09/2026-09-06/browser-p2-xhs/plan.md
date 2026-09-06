# 浏览器三期 P2：小红书调研工作流 实施计划

**目标**：把扩展通道升级为「调研级稳定」——agent 在已授权域名的工作区 tab 上自主导航（含 SPA），配合工具层反风控约束（随机延迟 + 单次预算 + 风控信号即停），支撑「主会话对话 → 子会话小红书调研 → 结论 + 链接」的完整工作流。

**架构思路**：帧协议加 navigate 命令与代际语义（两份实现同步改）；扩展侧 URL 自动跟踪 + 快照自动重采解决「一导航就断线」（P1 最大限制，本次硬前提）；主进程工具层注入节奏预算与风控检测（不依赖 agent 自觉）；站点策略代码级模块（不进 settings）。设计全文见 [../browser-p2-xhs-research-design.md](../browser-p2-xhs-research-design.md)，调研依据见同目录两份 survey。

**涉及模块**：`extension/src/`（background/dom-actions/nm-protocol）、`electron/main/services/browser/`（nm-protocol/browser-gateway/browser-action-stream/site-policy 新建）、`electron/main/agents/tools/extension-tools.ts`、`settings-types.ts`（仅浏览器解析 Profile 描述文案）。

## 步骤索引

- [ ] [Step 1: 帧协议 navigate 命令 + gateway 路由](./step1-protocol-navigate.md) — CommandKind 加 navigate、快照帧加 generation、gateway 目标域名授权校验与 navigation_blocked（纯主进程 + 协议，可单测）
- [ ] [Step 2: 扩展侧 URL 自动跟踪 + ref 代际](./step2-extension-tracking.md) — navigate 真实导航执行、tabs.onUpdated URL 变化监听 + 快照自动重采（节流）+ 代际重置、observe_page 导航后可用、命令前校验自愈
- [ ] [Step 3: 站点策略 + 工具层节奏预算](./step3-tools-policy.md) — site-policy.ts（小红书第一份）、extension-tools 随机延迟/预算计数/风控信号检测/navigate 工具/双链路引导文案、动作账本加字段、Profile 描述更新
- [ ] [Step 4: 端到端验收](./step4-e2e-acceptance.md) — headful 真机用例矩阵（导航跟踪/SPA/预算/风控/竞态回归）+ 小红书真实调研一次（保守低频）+ 全量回归

## 全局决策

- **沿用 P1 全部验证纪律**：runner/验证脚本一律 `node` 执行（playwright×bun 挂起教训）；浏览器侧验证 headful；dev electron 必须 `NODE_ENV=development`；验证环境临时 `DOGEAR_CONFIG_DIR` 隔离、结束清理；涉及杀进程禁止按进程名杀宿主；`extension/` 不进 tsc/eslint 工程；改主进程后 `bun run build:electron`
- **两份帧协议实现同步改**（`extension/src/nm-protocol.js` 与 `nm-protocol.ts`），不共享文件、语义必须一致；帧格式（4B LE 长度前缀 + UTF-8 JSON、64MB）不变
- **协议 errorCode 只加一个 `navigation_blocked`**（gateway 前置判：navigate 目标域名未授权）；`budget_exceeded` / `risk_signal_detected` 是**工具层语义结果**（isError 文案 + 结构化原因），不进协议 errorCode，不新造协议复杂度
- **ref 代际原则**：宁可误杀（强制重 observe），不可拿旧 ref 操作新页面；URL 变化与命令成功回推快照时 generation 递增，observe 采集同步当前 generation，命令校验 generation 不符 → ref_expired
- **站点策略落点拍板**：新建 `electron/main/services/browser/site-policy.ts` 代码级模块（默认策略内置、导出查询函数），**不进 settings 双份类型**——P2 无调参 UI 需求，参数真机校准前做 UI 无意义；校准后再考虑提设置
- **预算挂在 conversationId**：`createExtensionToolDefs({ conversationId })` 已有会话标识，预算计数用工具模块内 Map（会话结束自然废弃，无持久化——设计拍板无日级锁）
- **随机延迟做在工具函数入口**（读 site-policy 参数），延迟期间动作流不记噪音
- **不写注释**；UI/文案中文；错误返回 `{content:[{type:'text'}], isError: true}` 语义化文案不抛异常
- **主会话状态注入不做**（YAGNI：子会话工具自报 not_connected 已足够引导；动态注入系统提示词成本不成比例）——记入完成总结遗留
- **AGPL 红线**：Proma 只借鉴思想（generation / 风险状态机 / 账本字段），零代码复制
- 版本：开发期沿用 0.1.103（工作区已 bump），收口时确认

## 完成总结

（全部完成后回填）
