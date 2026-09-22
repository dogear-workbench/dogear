---
step: 3
title: playbook 归入 memory 全局主题
status: pending
---

## 目标

browser-playbook 从孤立全局单文件变为 memory 体系的**全局主题**：进统一索引（主会话 RecallMemory 可命中）、子会话注入语义不变、SaveMemory/ForgetMemory 可维护，共用记忆的清理与检索入口。

## 依赖上下文（接力棒输入）

- 当前关键文件状态：
  - `electron/main/services/memory/memory-fs.ts:17-33` 全部路径按 `workspaces/<wid>/memory` 组织——全局 scope 是**新增能力**：加 `getGlobalMemoryDir()` = `getConfigDir()/memory`（目录已存在但未使用）
  - `electron/main/services/memory/memory-types.ts` Topic/TopicIndexEntry/frontmatter 均 camelCase
  - 注入链：`pi-session.ts:52` 调 `readBrowserPlaybook()`（来自 `services/browser/browser-playbook-service.ts:22`）——**保持该接口不变、换实现为读全局 memory 主题**，pi-session 调用点零改动
  - 检索：`memory-recall.ts` 当前只读工作区 index.json，需合并全局 index
- 关键决策回顾：不做通用 inject 框架（注入源只有 playbook 一个，服务层按固定 slug `browser-playbook` 读取）；SaveMemory/ForgetMemory 开放 `scope: 'global'` 可选参数（playbook 的生命力来自 agent 踩坑后能沉淀新条目，写权限不收死；工具 description 强调全局仅限跨工作区复用知识）

## 计划改动

- [ ] `memory-fs.ts`：新增全局目录/索引/主题文件路径函数；读写函数支持 scope 路由（'workspace' | 'global'，默认 workspace）
- [ ] `memory-service.ts`：SaveMemory/ForgetMemory 接受可选 scope；recall/list 读侧合并全局 index（全局条目在结果中带 scope 标记）
- [ ] `agents/tools/` 记忆工具：zod schema 加 scope 可选枚举，description 写明准入（全局=跨工作区复用的踩坑知识）
- [ ] `browser-playbook-service.ts`：`readBrowserPlaybook` 实现改为读全局 memory 主题（slug `browser-playbook`），主题不存在时回退读旧文件（兼容迁移前状态）
- [ ] 一次性幂等迁移（主进程启动或 service 初始化时）：全局 `browser-playbook.md` 存在且全局 memory 无该主题 → 内容转为主题（keywords 配检索词：浏览器/踩坑/调研/反爬/SERP/登录墙/风控等）→ 原文件改名为 `browser-playbook.md.migrated`（不删，留人工确认）
- [ ] 核实前端有无记忆管理视图：有则全局主题加「全局」标记展示（`components/` 下 grep memory 相关组件）

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
