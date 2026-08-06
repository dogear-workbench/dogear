---
step: 4
title: 验证、清理与文档同步
status: pending
---

## 目标

验证权限收敛没有留下旧模式或旧规则调用，并同步受 tipc 签名变更影响的项目文档。

## 依赖上下文（接力棒输入）

- 前置 step 产出：Step 1 已迁移设置数据；Step 2 已完成 Pi runtime 和 tipc 契约；Step 3 已完成设置与聊天 UI 收敛。
- 当前验证约束：项目使用 Bun；主进程修改必须执行 `bun run build:electron`；前端和类型修改须至少执行 `bun run lint` 与 `bun run build`。
- 关键决策回顾：主会话默认模式按七个基础工具设置控制，工具包自动放行；自动执行和子会话永远不询问；没有跨会话“总是允许”。

## 计划改动

- [ ] 全仓搜索并处理权限相关残留：`acceptEdits`、`bypassPermissions`、`dontAsk`、`plan`、`always_allow`、`permissionRules`、`subAgent.permissionMode`、`updatedInput`；仅允许 PARSE_ARTICLE SDK 内部固定 `dontAsk`、历史逐字稿/usage 向后兼容读取或明确的设置迁移代码保留。对每一处保留项记录其兼容理由，不得让旧值重新进入 Pi runtime、tipc 输入或新 UI。
- [ ] 验证配置文件兼容：用含旧模式、旧规则、缺失/额外基础工具键及 `ai`/映射父对象结构损坏的样例设置启动，确认规范化后的模式和七工具默认值符合设计、规范化幂等，旧规则不影响新 Pi 会话。
- [ ] 验证主会话策略矩阵：默认+七项基础工具的 ask/allow、默认+工具包、默认+未分类工具、自动执行+任意基础设置；验证未分类工具不能获得会话白名单，会话允许在重启后失效，拒绝能解除等待且中断/关闭不死锁。
- [ ] 验证子会话：无论旧 JSON、设置页旧值或直接 tipc 改模式请求如何，创建后和调用后均使用 `autoExecute` 且不产生权限请求；聊天输入区没有可操作的权限模式菜单。
- [ ] 以一行含 `always_allow` 的历史 permission JSONL 验证读取、聚合和详情展示；统计不得出现 `NaN`、丢失计数或运行时异常。
- [ ] 验证同一 session 附着到两个 renderer 时，任一窗口切换模式后另一窗口同步更新；未附着/已销毁窗口不应影响当前会话。
- [ ] 执行 `bun test`（至少覆盖新增的设置规范化、权限策略与 usage 历史兼容测试）、`bun run lint`、`bun run build:electron`、`bun run build`，修复真实类型/构建问题，不以关闭检查或屏蔽报错绕过。
- [ ] 调用 `doc-sync` skill，核查 `CLAUDE.md`、`.claude/rules/` 和代码地图中与 Pi 权限、设置页、tipc 权限路由有关的描述；按实际代码更新必要索引。

## 实施回填（做完后填）

### 实际改动

- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒

- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
