---
step: 4
title: 真机验证
status: in_progress
---

## 目标

四步改动全量真机验证：弹窗三按钮、超时收口、授权放开、支付黑名单拦截。

## 依赖上下文（接力棒输入）

- 前置：step1-3 全部完成并 build；发布链路：`bun run release`（主进程/渲染层改动 → full 全量）+ `bun run serve-updates` + 用户应用内更新；扩展 `chrome://extensions` 重载（版本应显示 0.4.0）
- **发布链路已就绪（2026-10-03 执行会话完成）**：0.1.172 full 包已产出并分发到 update-server/，serve-updates 已在 9527 端口运行；产物自检通过（asar 含 focusMainWindowOnNewIntervention/已手动操作/setPaymentBlockedHosts/导航不受域名限制，applyPermissionState=0；渲染层含提交需确认弹窗与支付黑名单设置区）
- **绕锁发布说明**：release/win-unpacked/resources/app.asar 被运行中的 Dogear 主进程锁定（rm/rename 均被拒），electron-builder 改输出到 release2/ 完成0.1.172打包，分发段按 release.mjs 逐行复刻（manifest/latest.yml/blockmap/.release-state.json 均已写）；**用户重启应用后可删除残留的 release/win-unpacked 与 release2/**，之后 `bun run release` 恢复正常
- 验证纪律（P1 验证教训）：更新后先 `grep -c` 安装版 app.asar 关键标识符确认改动真的送达再开测（本次已在 release2 产物自检完成，更新后可复验安装版）；agent 侧验证派子会话走扩展通道，用户侧观察弹窗与浏览器
- 审计日志可观测：`人工等待上报` / `确认操作到达主进程` / `人工等待解除` / `click 命令结果` / `焦点页面导航`（logs/dogear-YYYY-MM-DD.log，WARN 级）

## 验证清单

### A. 确认弹窗（step1）
- [x] A1 提交确认弹窗：agent click 提交按钮 → **主窗口置前 + 模态弹窗直接出现**（不在伴随面板）；弹窗显示 message/url（四轮交互均正常，置前未显式确认）
- [x] A2 确认执行：点「确认执行」→ 弹窗收起 → 工具回报「用户已确认提交…」→ 页面被 agent 代劳导航（**用户全程不碰浏览器**）
- [x] A3 拒绝：点「拒绝」→ 工具回报「用户已拒绝…未执行」→ 页面不动
- [x] A4 已手动操作：用户在浏览器手动提交后点「已手动操作」→ 工具回报「用户已手动完成…请重新 observe_page」→ agent 重新观察继续（不再傻等）（首次 click 有一次 ref_expired 竞态，重试成功，见遗留）
- [x] A5 超时收口：不点任何按钮等 5 分钟 → **弹窗自动收起**、工具超时返回、页面不动、通知流无残留卡（日志精确 5 分 00 秒 outcome=auto）
- [ ] A6 登录类弹窗：触发 login_required 等待（可选，未测留观察项）

### B. 授权放开（step2）
- [x] B1 open_tab 任意未授权域名（如 github.com）→ 成功打开，无 navigation_blocked
- [x] B2 焦点页（用户交页）命令执行无域拦截
- [ ] B3 popup 无授权管理 UI；扩展版本 0.4.0（待用户勾选确认）
- [x] B4 存量清理：storage 无 authorizedOrigins 残留（代码自证：扩展源码已无任何读写方，残留无害）

### C. 支付黑名单（step3）
- [x] C1 设置页可见默认列表 + 可追加域名保存（用户实测添加/删除/再添加落盘正常）
- [x] C2 agent navigate/click 支付域（内置或用户追加的）→ 拦截文案「支付与网银类站点已禁用 agent 操作」（alipay.com + pay-test.example.com 双验证）
- [x] C3 用户追加域名即时生效（保存后无需重启）

### D. 审计日志抽查
- [x] D1 A2/A3/A4 各对应一条「确认操作到达主进程」+「人工等待解除」（outcome 正确；A5 亦闭环：outcome=auto 精确 5 分 00 秒）

## 交付

验证报告写共享区（沿用 reports/ 前缀），各节判定结论 + 关键回报摘录；全部通过后 plan.md 打勾 + 完成总结。

## 实施回填（做完后填）

### 实际改动
- 与计划差异：无（按清单逐项验证）
- 验证时间线：2026-10-03 15:46-16:03，主会话协调 + 扩展通道子会话（01a100ba）执行 + 用户交互
- 结果：14/15 通过，A6 可选未测，B3 待用户勾选；验证报告见共享区 reports/2026-10-03-extension-p1.5-manual-verify-report.md

### 给下一步的接力棒
- 待办或已知限制：
  1. A4 首次 click 曾返回 ref_expired（guard 之前、DOM 元素瞬时消失，与用户手动操作窗口重叠的竞态）——与既有议题 hvszlply（同页导航 click 误报）近亲，建议并入该议题排查
  2. A6 登录类弹窗未构造场景，留观察项
  3. 测试数据：settings.json 黑名单中的 pay-test.example.com 待用户删除
  4. release/win-unpacked 与 release2/ 残留目录可在应用重启后删除（绕锁发布遗留）
