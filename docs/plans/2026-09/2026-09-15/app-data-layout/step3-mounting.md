---
step: 3
title: 挂载与写排除机制
status: done
---

## 目标

会话文件边界默认包含全局 config 目录；WorkspaceExecutionEnv 支持禁写清单（读开写禁），保住 notes/memory「工具是唯一写通道」。

## 依赖上下文（接力棒输入）

- 前置 step 产出：[step2-migration.md] 数据已在新路径（待回填：迁移模块位置）
- 现状锚点：
  - `pi-session.ts` 四处 roots 构造：env :522、builtin file tools :599、search tools :667 与 :781；热更新 `updateWorkspacePaths()` :333-335
  - `conversation-runtime-service.ts:105` additionalPaths 过滤构造点
  - `workspace-execution-env.ts` guard() 单态校验，write 类方法：writeFile / appendFile / remove / createDir
- 禁写清单与去重规则：见 [plan.md 全局决策](./plan.md)

## 计划改动

- [x] pi-session `start()` 内统一计算 `basePaths`（去重：大小写不敏感前缀包含），四构造点与 `updateWorkspacePaths` 全部改用同一来源（建议收敛成私有方法）
- [x] `WorkspaceExecutionEnv`：新增 `writeExcludedPaths` + `updateWriteExcludedPaths()`；guard 拆 `guardRead` / `guardWrite`，write/edit/remove/createDir 走 guardWrite 命中禁写区返回明确错误文案（提示走 dogear__ 工具）
- [x] 禁写清单在 pi-session 启动时按 configDir 生成（相对顶层列表 join），随 basePaths 一并下发
- [x] 注意：appendFile 属于写（走 guardWrite）；bash 不受影响（现状无沙箱，不在本步范围）
- [x] 验证：临时工作区新会话中 glob 可搜到 configDir 下文件、read settings.json 成功、write `notes/` 下文件被拒并给出工具指引文案
- [x] `bun run build:electron` + smoke test

## 实施回填（做完后填）

### 实际改动
- 与计划差异：basePaths/禁写清单计算收敛为独立模块 `workspace-paths.ts`（非私有方法，便于验证脚本直接 import 且 pi-session.ts 已超 1400 行）；禁写清单校准 +3 项（conversations/stocks/wechat，原则内）；tool-registration-smoke 反射调用签名同步 +basePaths 参数
- 改动文件清单：`pi-session/workspace-paths.ts`（新建）、`pi-session/workspace-execution-env.ts`（写排除）、`pi-session/pi-session.ts`（basePaths 收敛）、`tool-registration-smoke.test.ts`（签名同步）

### 给下一步的接力棒
- 关键签名 / 数据结构：`computeBasePaths(workspacePath, additionalPaths)` / `buildWriteExcludedPaths()`（workspace-paths.ts）；`env.updateWriteExcludedPaths(paths)`（WorkspaceExecutionEnv）
- 下个 step 该从哪里继续：动态段（session-append-templates）注入 configDir 绝对路径与禁写区一句话，configDir 从 `getConfigDir()` 取，禁写清单可用 `buildWriteExcludedPaths()` 或直接引用 WRITE_EXCLUDED_TOP_LEVEL 语义
- 待办或已知限制：resolveWithinPaths 相对路径永远落第一个根（既有语义），跨根相对路径不探测存在性；Glob/Grep 遍历跳过 `.dogear` 目录名的行为未改（显式 path 参数可搜，动态段说明）
