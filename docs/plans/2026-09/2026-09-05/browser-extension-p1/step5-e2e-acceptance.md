---
step: 5
title: 端到端验收
status: done
---

## 目标

全链路真机验收（工具调用视角）+ 子会话闭环 + 全量回归，形成人工遗留清单，P1 收口。

## 依赖上下文（接力棒输入）

- 前置 step 产出：[step4-tools-profile.md] 四工具 + save_article 已注册可调；extension 能力域装配完成
- 当前关键文件状态：`resources/browser-eval/run-agent.mjs` 支持 search 类任务与 expect.tools/minUrls 断言；CDP 自动化路径（popup page target + 主窗口设置 overlay）见 P0 step4 交付文档；dev electron 必须 NODE_ENV=development
- 关键决策回顾：真实验收 headful + 真实手势；无人值守脚本禁止杀宿主进程；验证环境临时 DOGEAR_CONFIG_DIR 隔离、结束清理

## 计划改动

- [x] 端到端用例矩阵（headful Edge + dev electron，CDP 辅助 + 必要人工手势）：
  1. 授权域 observe_page → click（导航类链接）→ 导航后 read_text —— 完整链 + 状态行随命令刷新
  2. 未授权域命令 → permission_denied（gateway 前置拦截）
  3. password 框 fill → guard_password；form submit 按钮 click → guard_submit（本地测试页）
  4. 竞态四类：断连中命令（disconnected）/ 换 tab 重连后旧命令（stale_tab）/ 命令前关 tab（tab_closed）/ 命令前页面自行导航（navigated_away）
  5. 旧扩展降级：临时装无 protocolVersion 的旧 background → 命令 stale_protocol（重载恢复）
  6. SW 冷启：重启 Edge → 重连 → 授权列表恢复 + 命令恢复
- [x] 子会话闭环（B 项验收）：派「浏览器解析」Profile 子会话，任务「用扩展工具 observe + read_text 读取当前连接页 → dogear__browser__save_article 入库」→ 断言文章三件套 + 入库 id（安装版占用真实 pipe 期间无法走 dev electron 真实 PiSession，按任务书批准的等价分层策略执行：层 1 PiSession 装配反射断言 + 层 2 工具函数真实链路序列闭环；层 3 真实 agent loop 列入人工遗留）
- [x] 全量回归：`bun run lint`（0 errors）/ `bun run build:electron` / `bunx tsc -p tsconfig.json --noEmit` / `node resources/browser-eval/run-pipeline.mjs` 20/20 / P0 状态行用例复跑（连接/断连/受限页——用 node gateway 侧断言 extensionStatusChanged 广播等价覆盖）
- [x] `package.json` bump 0.1.102
- [x] `docs/codebase-map.md` 同步（extension-tools / dom-actions / 新设置项 / 授权列表 UI）
- [x] 人工遗留清单（无法自动化项）整理进回填；环境清理（临时目录/脚本/进程）

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
  1. **验证拓扑沿用 step2-4 先例（安装版 Dogear 占用真实 pipe，dev electron 不可用）**：临时拷贝 dist 整树（仅替换 nm-protocol.js 的 pipe 常量 → `\\.\pipe\dogear-nm-gateway-step5-test`）+ 独立 node gateway 宿主进程 + 临时扩展拷贝 manifest 静态 host_permissions(18777) + HKCU NM 注册（PowerShell 写，node 直跑 worker）+ 本地测试页 server(18777/18778) + CDP(18779)。产品代码零改动。
  2. **用例矩阵由单一 driver 脚本无人值守执行**（node 单进程承载 gateway 宿主 + 测试页 server + CDP 驱动 + 断言），49/49 PASS，逐步 PASS/FAIL 行留档于 step5-delivery.md。
  3. **stale_tab 实现了端到端真机构造**（step2 只能 mock 单测）：裸 socket（不发 hello、不触发 takeOver）向 gateway 发伪 tab_snapshot 污染 tabId → 命令携带错误 tabId → 真实扩展 SW 校验拒绝，真实扩展侧分支真实命中。
  4. **子会话闭环按任务书批准的分层策略**：层 1 用 `Object.create(PiSession.prototype)` 反射调 buildSubAgentToolDefs（补 toolPackMap 实例字段）；层 2 在 headful 真实链路上按 agent 调用序连续执行 observe_page → read_text → save_article 工具函数并断言三件套落盘。层 3（真实 agent loop）列人工遗留。
  5. **node 直调 dist 深链（PiSession）补两项基建**：electron 假包（node_modules/electron，ESM+CJS 双格式 stub）+ module loader resolve hook 把 `electron` 请求重定向到假包（node_modules 内部包 @egoist/tipc 的 electron 依赖从包自身位置向上解析，仅本地假包不够）。browser-tools 动作流在无 tipc 环境需 setBrowserToolsActionListener 接线到 recordBrowserAction。
  6. **环境清理额外发现并清除了历史注册表垃圾键**：HKCU Edge NativeMessagingHosts 下键名带尾引号的 `com.dogear.nmhost"`（MSYS 转义误创建的历史残留，任务开始的检查方式假阴性未发现）与 HKCU Chrome 下 P0 时期遗留的 `com.dogear.nmhost`，均已删除（用户其他软件的 quark/browsercore 键未触碰）。
- 改动文件清单：
  - `package.json`（version 0.1.101 → 0.1.102）
  - `docs/codebase-map.md`（browser/ 段补 nm-bridge/nm-protocol/browser-gateway 条目；browser-action-stream 补 source 枚举；browser-tools 11 工具 + save_article；新增 tools/extension-tools 条目；新增「浏览器扩展（extension/）」顶层段（manifest/popup/background/dom-actions/nm-protocol/授权链路）；ExtensionStatusLine 新条目；page.tsx/SubAgentTab/pi-session.ts/settings-service 条目补 extension 相关；关键数据流补「扩展命令链路」）
  - `docs/plans/2026-09/2026-09-05/browser-extension-p1/step5-e2e-acceptance.md`（本文件回填）
  - 验证产物（.tmp-step5/：dist 拷贝树+electron 假包+loader hook、扩展拷贝 ext/ext-v1、worker/bat/NM manifest、driver 脚本、Edge profile×3、临时工作区）与 HKCU 临时注册已全部清理，不在仓库中

### 验收结果（49/49 PASS，明细见共享区 step5-delivery.md）

| 组 | 用例 | 结果 |
|----|------|------|
| 1 | 授权域 observe → click 导航链接（lost 兜底）→ popup 重连 → read_text + 状态行随命令刷新（快照回推 title/url） | 9 断言 PASS |
| 2 | 未授权域：gateway 前置拦截（origin 不在列表/空 url）+ 命令帧不发出；真实扩展对 18778 页 observe → permission_denied | 3 断言 PASS |
| 3 | guard_password（值未写入 DOM 复核）/ guard_submit×2（button[type=submit]、form 内无 type button）+ 拦截后未导航 | 5 断言 PASS |
| 4 | disconnected（挂起 reject + 断连后 not_connected）/ stale_tab（伪快照构造）/ navigated_away / tab_closed（NM 连接存活） | 9 断言 PASS |
| 5 | v1 扩展 protocolVersion=1 → stale_protocol；授权链不受影响；换 v2 + 新 profile 重启 → protocol=2 命令恢复 | 5 断言 PASS |
| 6 | SW 冷启：杀/启 Edge → 重连 → authorizedOrigins 自动恢复 → observe 恢复 | 3 断言 PASS |
| B-层1 | PiSession 装配：浏览器解析 Profile（extension:true）含四扩展工具 + save_article；对照组不含 | 3 断言 PASS |
| B-层2 | observe_page → read_text → save_article 序列：入库文案 + 三件套（meta/content.md/.order.json + raw.html）+ wordCount=982 + 动作流 source=extension 四 action + save_article | 5 断言 PASS |
| P0 等价 | welcome.appVersion / connected 广播全字段 / 受限页 extractError / permission_state 合并 / command 帧全字段 / timeout / 迟到回包忽略 / disconnected 广播 | 11 断言 PASS |

### 全量回归（最终 HEAD）

- `bun run lint`：0 errors, 99 warnings（全为存量）✓
- `bun run build:electron`：通过 ✓
- `bunx tsc -p tsconfig.json --noEmit`：通过 ✓
- `node resources/browser-eval/run-pipeline.mjs`：20/20 PASS ✓
- P0 状态行等价覆盖：见上表 ✓

### 给下一步的接力棒
- 人工遗留验收项：
  1. **真实 PiSession agent loop 全链路（B 项层 3）**：关闭安装版 Dogear → `bun run dev`（NODE_ENV=development + 临时 DOGEAR_CONFIG_DIR）→ 用「浏览器解析」Profile 派子会话真实跑「observe + read_text 当前连接页 → save_article 入库」（层 1/2 已证明装配与工具链正确，风险极低）
  2. Chrome 侧全链路（Chrome 137+ 移除 --load-extension 无法自动化）：chrome://extensions 开发者模式加载 → popup 授权/撤销 → observe 放行/拦截
  3. 真实 toolbar 手势路径：真实鼠标点扩展图标 → popup 显示当前域名 → 点授权（activeTab 手势只能真实点击触发；自动化用的 popup page target 是等价路径）
  4. Edge 原生权限弹窗（permissions.request「允许/拒绝」）真人 30 秒过一遍（step3 已用 UIA 自动化覆盖）
  5. 设置页「受控浏览器」状态行 + 授权域名 chip 视觉确认（dev electron 开设置页即可）
  6. 发布链路（P0 遗留）：0.1.102 安装包 NSIS 注册表写入 + 安装版 exe NM host 全链路
- 后续（P2 输入）：
  1. **导航后快照不自动更新**（本期已知限制）：页面路径变化后命令 navigated_away，且 observe 引导文案指向的动作同样被拦，agent 无法自行恢复需用户 popup 重连——P2 评估导航自动快照同步（设计排除项重新定价）或至少修正工具文案
  2. 自动重连（alarms 保活）/ 多 tab 多会话绑定——设计排除项，按 P2 需求重新评估
  3. P2 小红书只读工作流地基已就绪：扩展通道（登录态/指纹）+ save_article 入库闭环 + extension 能力域子会话
  4. guard_password 的 form 内 password 检测会误拦登录页用户名框（宁拦错设计意图），L2 开放写入时可细化
  5. 老扩展用户升级桌面端后需手动重载扩展（stale_protocol 文案已引导），商店上架后自然消解
  6. 双链路工具引导不足（2026-09-06 真机试用发现）：「浏览器解析」Profile 同时挂 browser + extension 两包，agent 面对一般读网页任务偏向受控浏览器（新开干净实例），扩展链路需任务里点名才走——P2 考虑工具描述/Profile 描述/提示词加引导（如「目标页需登录态且扩展已连接时优先 extension 工具」）或按连接状态自动优先
  7. 主会话对扩展连接无感知（2026-09-06 真机试用发现）：连接状态只在 UI（状态行/设置页）展示，主会话既无 extension 工具也无状态查询通道，用户问「连接了吗/连的谁」答不上——P2 可考虑状态查询工具或把连接状态注入主会话提示词
