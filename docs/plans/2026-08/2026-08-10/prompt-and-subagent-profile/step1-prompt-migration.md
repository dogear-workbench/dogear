---
step: 1
title: 提示词文件迁移
status: done
---

## 目标

将提示词文件读取路径从 `.claude/CLAUDE.md` 改为 `.dogear/agent.md`，通用提示词和工作区提示词各一个。

## 依赖上下文（接力棒输入）

- 无前置 step 依赖，可独立执行
- 当前读取位置：`pi-session.ts:245-246`
  ```typescript
  const projectClaudeMd = await readTextFileSafe(path.join(this.config.workspacePath, '.claude', 'CLAUDE.md'));
  const userClaudeMd = await readTextFileSafe(path.join(os.homedir(), '.claude', 'CLAUDE.md'));
  ```
- `getConfigDir()` 位于 `electron/main/services/settings-service.ts:35`，返回 `.dogear` 根目录
- 工作区数据目录模式：`getConfigDir()/workspaces/{workspaceId}/`

## 计划改动

- [x] `pi-session.ts` 引入 `getConfigDir`，改写两行读取逻辑：
  - 通用提示词：`path.join(getConfigDir(), 'agent.md')`
  - 工作区提示词：`path.join(getConfigDir(), 'workspaces', this.config.workspaceId, 'agent.md')`
- [x] `os.homedir()` 未移除——line 251 的 skill 加载路径仍在用 `os.homedir()/.claude/skills`
- [x] Grep 确认：读 `.claude/CLAUDE.md` 的只有 pi-session.ts:245-246 一处

## 验证

- `bun run build:electron` 编译通过
- 启动会话后日志中 systemPrompt 不报错（文件不存在时 readTextFileSafe 返回空串，不会崩溃）
- 在 `.dogear/agent.md` 放入测试内容，确认会话提示词中包含

## 实施回填（做完后填）

### 实际改动
- `pi-session.ts:42` — import 行加 `getConfigDir`
- `pi-session.ts:245-246` — 两行提示词读取路径从 `.claude/CLAUDE.md` 改为 `.dogear/agent.md`（通用）和 `.dogear/workspaces/{workspaceId}/agent.md`（工作区级）
- `os` import 保留（skill 加载路径 line 251 仍用 `os.homedir()`）
- `bun run build:electron` 编译通过

### 给下一步的接力棒
- 提示词读取已改为 `getConfigDir()/agent.md`（通用）和 `getConfigDir()/workspaces/{wsId}/agent.md`（工作区级）
- `getConfigDir()` 在 `settings-service.ts:35`，已在 pi-session.ts 中可用
- 下一步（Step 2）重构 settings types，与提示词路径无直接耦合
