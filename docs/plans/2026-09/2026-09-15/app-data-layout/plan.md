# 应用数据布局调整与全局目录挂载 实施计划

**目标**：notes/memory 迁入全局 config 的 workspaces/{id}/ 下、全局 config 目录默认挂载进会话文件边界（带禁写区）、动态段 + 工具描述补齐 agent 认知；articles 留工作区不动。

**架构思路**：存储分层按「应用功能 vs 用户内容」定死（notes/memory=应用功能入 config，articles=工作区产物不动）；configDir 整树挂载 + WorkspaceExecutionEnv 写排除清单保住「笔记/记忆工具是唯一写通道」的索引一致性；认知注入收敛为 3 行动态段而非目录导览。设计全文见 [../app-data-layout-design.md](../app-data-layout-design.md)。

**涉及模块**：`electron/main/services/notes/*`、`electron/main/services/memory/*`、`electron/main/agents/pi-session/{pi-session,workspace-execution-env,search-tools}.ts`、`electron/main/agents/session-append-templates.ts`、迁移逻辑（新文件）、前端 data-center 跟进。

## 步骤索引

- [x] [Step 1: 盘点与服务层路径切换](./step1-service-paths.md) — notes/memory 全部路径拼接点与调用方盘点，服务层从 workspacePath 切到 config 下新路径
- [ ] [Step 2: 存量懒迁移](./step2-migration.md) — 旧目录检测、幂等搬移、标记文件、旧目录清理
- [ ] [Step 3: 挂载与写排除机制](./step3-mounting.md) — pi-session basePaths 统一（含热更新）、WorkspaceExecutionEnv 写排除
- [ ] [Step 4: 认知注入](./step4-prompts.md) — 动态段 + segments 注册 + Glob/Grep 描述补充
- [ ] [Step 5: 连带收尾与全量验证](./step5-verify.md) — 前端/文档/规则文件跟进，lint + build + 冒烟

## 全局决策

- **新路径**：`getConfigDir()/workspaces/{workspaceId}/notes` 与 `.../memory`；路径函数保持现名（getNotesDir 等），仅换实现与参数语义（workspacePath → workspaceId）。
- **basePaths**：`[workspacePath, ...additionalPaths, getConfigDir()]` 去重（大小写不敏感前缀包含去重）；热更新 `updateWorkspacePaths` 重算时同样包含 configDir。
- **禁写清单**（相对 configDir 顶层）：`notes/`、`memory/`、`tasks.json`、`plans.json`、`usage/`、`logs/`、`run-history/`、`tmp/`、`workspaces/`；原则=有专用写工具或 app 独占高频写。实施时可校准，原则不变。
- **迁移标记**：`getConfigDir()/workspaces/{id}/notes-memory-migrated.json`（参考既有 `migration-session-id-done.json` 模式），内容含迁移时间与条数；迁移成功后删除旧目录，不留双读。
- **不写新单测**（项目偏好），既有 tool-registration-smoke 等保持通过。
