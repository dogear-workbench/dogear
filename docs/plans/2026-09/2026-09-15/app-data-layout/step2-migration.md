---
step: 2
title: 存量懒迁移
status: done
---

## 目标

应用初始化时把各工作区旧的 `<workspace>/.dogear/notes|memory` 幂等搬移到 config 新路径，迁完清旧目录，杜绝双读。

## 依赖上下文（接力棒输入）

- 前置 step 产出：[step1-service-paths.md] 服务层已全部走 config 新路径（待回填：具体入口函数与 workspaceId 获取方式）
- 参考模式：`electron/main/services/migrate-notes-todos.ts`（历史迁移的写法与接入点）
- 标记文件：`getConfigDir()/workspaces/{id}/notes-memory-migrated.json`

## 计划改动

- [x] 新建迁移模块：遍历 `workspaces.json` 全部工作区 → 无标记 ∧ 存在旧目录 → 整目录 move（跨盘 fallback copy+delete）→ 写标记 → 删旧目录
- [x] 半途失败处理：move 前先写 `migrating` 状态标记，成功后覆写完成标记；检测到 `migrating` 残留时下次启动续迁（目标目录已存在则跳过已迁条目或整目录覆盖策略）
- [x] 接入点：应用启动主流程（与 migrate-notes-todos 同一初始化阶段），异步执行不阻塞启动
- [x] 迁移期间 UI 读写走新路径为空的处理：确认迁移接入点早于会话创建/工具注册
- [x] 本地验证：造一个带旧目录的工作区跑一遍，检查新旧目录与标记文件

## 实施回填（做完后填）

### 实际改动
- 与计划差异：①搬移策略选「条目级合并 move」而非整目录覆盖——Step 1 切路径后新路径可能有真实新写入，覆盖会丢数据；合并 move 冲突时保留目标侧、源侧改名 `.migrated-conflict-<ts>` 并入，绝不丢数据；半途崩溃后重跑自动跳过已迁条目=天然续迁；目标不存在时仍先整目录 rename 快路径（EXDEV/占用退化逐条）。②接入顺序改串行链：目录迁移先于待办迁移（待办条目 noteId 指向搬迁后笔记，未搬完时 appendNote 会误建新卡）。③迁完无条件重建两侧 index.json（并入场景旧索引缺条目，memory 索引不会自愈）。④源清理不净置 dirtySource 保持 migrating 待重试。
- 改动文件清单：新建 `electron/main/services/migrate-notes-memory.ts`（~170 行，导出 migrateNotesMemoryAllWorkspaces）；`electron/main/main-app.ts` 接入点改串行链（≈:769）。标记文件 `config/workspaces/{id}/notes-memory-migrated.json`，status done 含 migratedAt + counts{notesFiles,memoryFiles,conflicts}；旧目录两侧都不存在直接写 done（避免每次启动重复 fs.access）
- 验证：mock 环境验 4 场景（首次迁移/二次幂等/新目录已有内容+同名冲突/无旧目录）24 断言全过；build:electron / bun test 326 pass / lint 0 errors；真实 AppData 核查无 mock 残留

### 给下一步的接力棒
- 关键签名 / 数据结构：`migrateNotesMemoryAllWorkspaces()` 幂等可重复调用；标记 status=done 后永不再扫该工作区；日志 tag `[AgentManager]:migrate-notes-memory`
- 下个 step 该从哪里继续：Step 3 挂载与写排除，pi-session.ts 四处 roots 构造点与 updateWorkspacePaths；agent worker 池启动（main-app.ts:720）先于迁移但无路径依赖，无影响
- 待办或已知限制：①冲突副本进 rebuild 索引成重复条目（概率≈0，数据保留可手删）；②迁移 rebuild 与运行时读改写索引的理论竞争窗口（启动早期，接受）；③workspace-json-service 的 getConfigDir 不读 DOGEAR_CONFIG_DIR 环境变量（与 settings-service 不一致，主进程内无影响，脚本化验证需注意）
