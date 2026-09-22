---
step: 3
title: playbook 归入 memory 全局主题
status: done
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

- [x] `memory-fs.ts`：新增全局目录/索引/主题文件路径函数；读写函数支持 scope 路由（'workspace' | 'global'，默认 workspace）
- [x] `memory-service.ts`：SaveMemory/ForgetMemory 接受可选 scope；recall/list 读侧合并全局 index（全局条目在结果中带 scope 标记）
- [x] `agents/tools/` 记忆工具：zod schema 加 scope 可选枚举，description 写明准入（全局=跨工作区复用的踩坑知识）
- [x] `browser-playbook-service.ts`：`readBrowserPlaybook` 实现改为读全局 memory 主题（slug `browser-playbook`），主题不存在时回退读旧文件（兼容迁移前状态）
- [x] 一次性幂等迁移（主进程启动或 service 初始化时）：全局 `browser-playbook.md` 存在且全局 memory 无该主题 → 内容转为主题（keywords 配检索词：浏览器/踩坑/调研/反爬/SERP/登录墙/风控等）→ 原文件改名为 `browser-playbook.md.migrated`（不删，留人工确认）
- [x] 核实前端有无记忆管理视图：有则全局主题加「全局」标记展示（`components/` 下 grep memory 相关组件）

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
  - 前端无记忆管理视图（src/ 下 grep memory 零命中），「全局」标记展示不做，与计划一致
  - 迁移入口选主进程启动（main-app.ts whenReady 迁移区，与既有迁移同模式），readBrowserPlaybook 内不做迁移，保持同步签名不变
  - 顺手修复 memory-indexer 的既有 bug：readIndex 对不存在索引返回 `{ ...EMPTY_INDEX }` 浅拷贝，topics 数组是共享引用，首次 upsert push 会污染模块级常量，导致后续所有空索引读取返回幽灵条目；改为 `{ ...EMPTY_INDEX, topics: [] }`
  - 迁移前预置默认旧文件的 ensureDefaultPlaybook 仅在「主题不存在」时调用，避免迁移完成后每次启动重新生成 browser-playbook.md 残留
- 改动文件清单：
  - electron/main/services/memory/memory-types.ts：新增 MemoryScope、ScopedTopicIndexEntry
  - electron/main/services/memory/memory-fs.ts：新增全局路径函数 getGlobalMemoryDir/getGlobalTopicsDir/getGlobalTopicPath/getGlobalIndexPath + resolveTopicsDir/resolveTopicPath/resolveIndexPath 路由
  - electron/main/services/memory/memory-indexer.ts：readIndex/updateIndexEntry/removeIndexEntry/rebuildIndex 加可选 scope；修 EMPTY_INDEX 浅拷贝 bug
  - electron/main/services/memory/memory-service.ts：listTopics 合并工作区+全局（条目带 scope）；getTopic/upsertTopic/deleteTopic 加可选 scope
  - electron/main/services/memory/memory-recall.ts：recall 合并全局 index，结果 topics 带 scope
  - electron/main/agents/tools/memory-tools.ts：SaveMemory/ForgetMemory zod 加 scope 可选枚举 + 准入 description；RecallMemory description 说明合并全局
  - electron/main/services/browser/browser-playbook-service.ts：readBrowserPlaybook 先读全局主题（slug browser-playbook）回退旧文件；新增 migrateBrowserPlaybookIntoMemory()
  - electron/main/main-app.ts：whenReady 迁移区挂 playbook 迁移

### 给下一步的接力棒
- 关键签名 / 数据结构：
  - `readIndex/updateIndexEntry/removeIndexEntry/rebuildIndex(workspaceId, scope = 'workspace')`
  - `getTopic/upsertTopic/deleteTopic(workspaceId, ..., scope = 'workspace')`；upsertTopic global 时 workspaceId 传 ''
  - `listTopics(workspaceId): Promise<ScopedTopicIndexEntry[]>`（合并工作区+全局，条目带 scope）
  - `recall()` 结果 topics 元素新增 `scope: 'workspace' | 'global'`
  - `migrateBrowserPlaybookIntoMemory(): Promise<void>`（幂等：主题存在或旧文件不存在则跳过；旧文件改名为 browser-playbook.md.migrated）
  - 前端 tipc listMemoryTopics 返回结构多了 scope 字段（当前无前端消费者，无兼容性问题）
- 下个 step 该从哪里继续：见设计文档后续 step；注意 scope 已是 memory 体系一等能力，新写入侧可直接传 scope
- 待办或已知限制：
  - 真实环境的迁移要等用户启动一次应用后确认（检查 config/memory/topics/browser-playbook.md 存在、config/browser-playbook.md 变为 .migrated）
  - 全局 index.json 若被误删，可用 tipc rebuildMemoryIndex 思路对全局 scope 重建（rebuildIndex 已支持 scope 参数）
