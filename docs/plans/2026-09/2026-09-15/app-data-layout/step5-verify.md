---
step: 5
title: 连带收尾与全量验证
status: done
---

## 目标

清点本 feature 之外的连带影响并收尾：规则文件/文档同步、前端展示、agent.md 模板、验证全局通过。

## 依赖上下文（接力棒输入）

- 前置 step 产出：[step4-prompts.md] 认知段上线（待回填：最终注入形态与开关归属）

## 计划改动

- [x] `.dogear/workspaces/15d3447b.../agent.md`（Dogear 项目指南）：硬决策区补一行「用户内容产物留工作区（articles），应用功能数据在全局 config（已挂载）」；同步此前对齐的清理项（删「使用中文回答」「95% 把握」两条全局重复、删内嵌笔记存卡纪律段、删常用命令清单保留 Electron 重编译 caveat）——见本话题前半段讨论
- [x] `resources/agent-templates/workspace.md` 模板：去掉「使用中文回答」等与 general.md 重复的硬编码项
- [x] `.dogear/agent.md`（通用偏好）：「子会话使用」段 `CreateSession` 补 `dogear__` 前缀
- [x] `docs/codebase-map/` 相关分域文档按 doc-sync 核对（notes/memory 存储、挂载机制）
- [x] 全量验证：`bun run lint` + `bun run build:electron` + `bun run dev:renderer` 起前端冒烟（笔记/记忆/文章页面正常）+ tool-registration-smoke
- [ ] plan.md 勾选收尾 + 完成总结（主会话职责，另行处理）

## 实施回填（做完后填）

### 实际改动
- 与计划差异：①「95% 把握」条后半句「改一个功能要全面考虑对其他模块的影响」非全局重复，主会话验收时已回补为独立一行（含「拿不准先问」语义）；②codebase-map 更新涉及四份（infra/agent-core/data-center/articles），均按代码事实核验，agent-core.md 中他人未提交遗留行未触碰
- 改动文件清单：`.dogear/workspaces/15d3447b.../agent.md`（硬决策补行 + 删两条硬约束 + 删笔记存卡段 + 压缩常用命令）；`resources/agent-templates/workspace.md`（删 2 条与 general.md 重复硬编码，保留 3 条特有约束）；`.dogear/agent.md`（dogear__CreateSession 前缀）；`docs/codebase-map/{infra,agent-core,data-center,articles}.md`
- 验证：lint 0 error / build:electron 通过 / bun test 326 pass 0 fail / 前端 tsc exit 0 / dev:renderer Vite 就绪 HTTP 200（已 kill）

### 给下一步的接力棒
- 主会话收尾：plan.md 勾选 + 完成总结 + 最终 commit
