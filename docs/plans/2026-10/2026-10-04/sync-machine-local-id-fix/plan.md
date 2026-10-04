# 同步机器本地 ID 污染修复 实施计划

**目标**：修复「同步后会话打不开（Conversation not found）」的根因——会话记录内嵌的机器本地 `workspaceId` 字段跨设备失真，并封堵同类污染通道（注册表并入远端路径、模型引用跨机失效）。

**架构思路**：机器本地事实（wsid、绝对路径、profile/tier 历史）不赋予跨设备语义——身份以宿主目录为准，运行时从 workspace 上下文取 id，同步落地时按宿主重写。不选「物理删除记录字段」：对端 Mira 跑 0.1.177 仍在写该字段，版本偏差期内「容忍存在、无人信任、落地重写」比 schema 迁移稳。不做存量数据迁移：1171 条 wsid 死数据无害，151 条 modelSelection 由恢复回退兜底。

**涉及模块**：
- `components/conversation-list/utils.ts`（openTab 传参）
- `electron/main/agents/pi-session/pi-session.ts`（模型解析回退）
- `electron/main/services/sync/merge-records.ts` / `apply.ts`（合并与落盘重写）

## 步骤索引

- [x] [Step 1: openTab 改用运行时工作区 id](./step1-opentab-runtime-wsid.md) — 治症：修掉信任记录字段的 UI 读点
- [x] [Step 2: 恢复会话的模型解析回退](./step2-model-fallback.md) — 治 151 条 modelSelection 跨机失效 + 消灭误导性报错
- [x] [Step 3: 同步层落地归一](./step3-sync-normalize.md) — 注册表不并入远端条目；conversations.json 落盘重写 wsid

## 全局决策

- **身份权威源 = 宿主目录名 + 运行时 workspace 上下文**。记录内 `workspaceId` 字段一律视为不可信的历史冗余，任何读点不得用于路由/拼接路径。
- **版本偏差兼容**：对端旧版本仍会推带脏 `workspaceId` 的记录——apply 落盘时统一重写为宿主 wsid，push 侧不做任何处理（对端 apply 时同样归一，双向安全）。
- **不做数据迁移**：存量 1171 条 wsid 字段留作死数据；151 条 modelSelection 失效靠 Step 2 的运行时回退解决。
- 主进程改动需 `bun run build:electron` 重编译后验证；同步层改动跑 `bun test electron/main/services/sync/`。
- 验证环境注意：运行中 app 的 `PiSessionRepository.metadataCache` 只在 repo 自身 create/delete/fork 时失效，验证会话打开前先重启 app。
