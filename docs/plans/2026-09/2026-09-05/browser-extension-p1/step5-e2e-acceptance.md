---
step: 5
title: 端到端验收
status: pending
---

## 目标

全链路真机验收（工具调用视角）+ 子会话闭环 + 全量回归，形成人工遗留清单，P1 收口。

## 依赖上下文（接力棒输入）

- 前置 step 产出：[step4-tools-profile.md] 四工具 + save_article 已注册可调；extension 能力域装配完成
- 当前关键文件状态：`resources/browser-eval/run-agent.mjs` 支持 search 类任务与 expect.tools/minUrls 断言；CDP 自动化路径（popup page target + 主窗口设置 overlay）见 P0 step4 交付文档；dev electron 必须 NODE_ENV=development
- 关键决策回顾：真实验收 headful + 真实手势；无人值守脚本禁止杀宿主进程；验证环境临时 DOGEAR_CONFIG_DIR 隔离、结束清理

## 计划改动

- [ ] 端到端用例矩阵（headful Edge + dev electron，CDP 辅助 + 必要人工手势）：
  1. 授权域 observe_page → click（导航类链接）→ 导航后 read_text —— 完整链 + 状态行随命令刷新
  2. 未授权域命令 → permission_denied（gateway 前置拦截）
  3. password 框 fill → guard_password；form submit 按钮 click → guard_submit（本地测试页）
  4. 竞态四类：断连中命令（disconnected）/ 换 tab 重连后旧命令（stale_tab）/ 命令前关 tab（tab_closed）/ 命令前页面自行导航（navigated_away）
  5. 旧扩展降级：临时装无 protocolVersion 的旧 background → 命令 stale_protocol（重载恢复）
  6. SW 冷启：重启 Edge → 重连 → 授权列表恢复 + 命令恢复
- [ ] 子会话闭环（B 项验收）：派「浏览器解析」Profile 子会话，任务「用扩展工具 observe + read_text 读取当前连接页 → dogear__browser__save_article 入库」→ 断言文章三件套 + 入库 id
- [ ] 全量回归：`bun run lint`（0 errors）/ `bun run build:electron` / `bunx tsc -p tsconfig.json --noEmit` / `node resources/browser-eval/run-pipeline.mjs` 20/20 / P0 状态行用例复跑（连接/断连/受限页）
- [ ] `package.json` bump 0.1.102
- [ ] `docs/codebase-map.md` 同步（extension-tools / dom-actions / 新设置项 / 授权列表 UI）
- [ ] 人工遗留清单（无法自动化项）整理进回填；环境清理（临时目录/脚本/进程）

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 人工遗留验收项：
- 后续（P2 输入）：
