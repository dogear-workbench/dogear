---
step: 3
title: 存量数据迁移 + 损坏数据修复
status: done
---

## 目标

一次性迁移：sdkSessionId 合并到 sessionId，修复被空壳覆盖的指针，清理磁盘上的空壳 jsonl。

## 依赖上下文（接力棒输入）

- Step 2 产出：sdkSessionId 字段已从类型定义和运行时代码中删除
- 磁盘调查结果：6 个会话 sessionId 指向空壳，其中 1 个可用 sdkSessionId 兜底修复，3 个可用孤儿文件时间戳匹配修复

## 计划改动

### 启动迁移函数

在 `electron/main/index.ts` 的启动流程中加一个迁移步骤（与现有 migration-p3/p4 并列），幂等执行：

- [ ] 新增 `electron/main/services/migration-session-id.ts`
- [ ] 迁移标记文件：`<configDir>/migration-session-id-done.json`

### 迁移逻辑

**阶段 1：sdkSessionId → sessionId 合并**

遍历每个工作区的 conversations.json：
- 每条 conversation：如果 `sdkSessionId` 字段存在
  - `sessionId = sessionId ?? sdkSessionId`（sessionId 优先）
  - 删除 `sdkSessionId` 字段
- 写回 conversations.json

**阶段 2：空壳指针修复**

对每个 conversation 的 `sessionId`，检查对应的 jsonl 文件大小：
- 如果 >225B（有内容）→ 跳过
- 如果 ≤225B（空壳）→ 查找正确指针：

修复映射（基于磁盘调查，硬编码到迁移脚本）：

| conversationId (title) | 当前空壳 sessionId | 正确 sessionId | 匹配依据 |
|------------------------|-------------------|---------------|----------|
| f2c6c159 (开始实施 b694) | 019fd122-841d | 019fd0ee-82e3 | sdkSessionId 兜底 |
| a9aee3ee (step1 话题) | 019fd0fa-45c0 | 019fd0e5-27a9 | jsonl 时间戳 07:48:26 = createdAt |
| 0b134fd1 (step3 UI) | 019fd122-90d9 | 019fd0f8-df63 | jsonl 时间戳 08:09:58 = createdAt |
| 0f822c46 (step4 验收) | 019fd122-9309 | 019fd105-fc51 | jsonl 时间戳 08:24:18 = createdAt |

不修复的会话（无可靠匹配）：
- d95b935d (排查权限) — 保持空壳，用户打开会看到错误提示
- 2e954b9e (step1 重试) — 同上

**阶段 3：空壳 jsonl 清理**

扫描 sessions 目录，删除所有 ≤225B 的 jsonl 文件（只有 session header，无 branch entries）。

注意：阶段 2 修复指针后才能执行阶段 3，否则可能删掉还没修复的会话的 session 文件。

### 迁移标记

- 迁移完成后写 `migration-session-id-done.json`（含 version 和 timestamp）
- 二次启动检测到标记即跳过

## 实施回填（做完后填）

### 实际改动
- 新增 `electron/main/services/migration-session-id.ts`：三阶段幂等迁移脚本
- 改动 `electron/main/index.ts`：在 migration-p3 之前插入 `runSessionIdMigration()` 调用

### 给下一步的接力棒
- 迁移标记文件：`<configDir>/migration-session-id-done.json`（version=1）
- 空壳判定阈值：≤225B（只有 session header 行，无 branch entries）
- 修复映射使用 title 关键词 + correctSessionId 前缀动态匹配（非硬编码完整 UUID）
- 当前开发环境实际有 3 条 sdkSessionId 非 null 的会话（sessionId=NULL），迁移会自动合并
- step3 文件列出的 4 个修复目标（f2c6c159/a9aee3ee/0b134fd1/0f822c46）在当前数据中已不存在，脚本仍保留映射以兼容其他环境
