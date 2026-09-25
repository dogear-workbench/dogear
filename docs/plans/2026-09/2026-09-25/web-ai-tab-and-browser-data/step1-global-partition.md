---
step: 1
title: 全局单分区重构 + 旧分区 cookie 迁移
status: done
---

## 目标

内嵌浏览器从「按工作区 hash 分区」改为全局单分区，启动时把旧分区的 cookie 合并迁移进全局分区并删除旧目录，登录态一次迁移全局生效。

## 依赖上下文（接力棒输入）

（本步为地基，无前置。已知现状：）
- `electron/main/services/browser/embedded/profile.ts` 现有 `resolveProfileKey(workspaceId)` → `persist:dogear-browser-{sha256前32位}`；旧分区目录在 `userData/Partitions/dogear-browser-*`
- 分区使用点：embedded-browser-manager 内调 `buildPersistentPartition(resolveProfileKey(...))`，执行前先 Grep 确认全部调用点

## 计划改动

- [x] `electron/main/services/browser/embedded/profile.ts` — profileKey 固定为 `'global'`，废弃 workspaceId 维度（保留函数形状还是改签名，看调用点数量定，倾向简化为无参）
- [x] 新增迁移函数（放 profile.ts 或独立 `migrate-legacy-partitions.ts`）：扫描 `userData/Partitions` 下 `dogear-browser-*` 目录 → 每个旧分区 `session.fromPartition(旧名).cookies.getAll()` → 逐条 `session.fromPartition('persist:dogear-browser').cookies.put()` 合并（同 cookie 后写覆盖）→ 全部成功后删旧目录；单分区读取失败跳过并记日志，不阻塞启动
- [x] 迁移触发点：主进程启动早期、任何内嵌 tab 创建之前调用（找 app ready 后 browser 相关初始化处挂载）
- [x] 全部 `resolveProfileKey` 调用点适配
- [x] `bun run build:electron` 验证编译

## 验证

- 启动应用，确认 `Partitions` 下旧 `dogear-browser-{hash}` 目录被合并删除、只剩新全局分区目录
- 伴随面板浏览器 tab 打开一个此前登录过的站点（如小红书），登录态保留
- agent 跑一次内嵌浏览器任务（readArticle 或 navigate）正常

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
  - 计划写 `cookies.put()`，Electron 39 实际 API 是 `cookies.set()`，按实际 API 实现
  - profileKey 维度彻底移除（未保留 `resolveProfileKey`/`buildPersistentPartition` 函数，改为 `profile.ts` 导出单一常量 `GLOBAL_BROWSER_PARTITION`）；manager 的 workspaces Map 键改用 workspaceId（tab 分组/agentTabId/activeTabId 语义不变），仅 session/partition 全局共享；`EmbeddedWorkspaceRecord.profileKey` 字段删除
  - 目录删除从「合并后同次删除」改为「marker 两段式」：同进程内 fromPartition 打开的旧分区在 Windows 上句柄无法释放，rm 必 EBUSY；改为合并成功后写 `dogear-migrated.marker`，下次启动（未打开旧 session、无句柄）直接删目录
  - 追加防丢失检查：marker 后若 `Network/Cookies` mtime 更新（如安装版旧代码又写入过 cookie），重新完整合并并刷新 marker，避免删目录时丢登录态
- 改动文件清单：
  - `electron/main/services/browser/embedded/profile.ts` — 重写为单一常量 `GLOBAL_BROWSER_PARTITION = 'persist:dogear-browser'`
  - `electron/main/services/browser/embedded/migrate-legacy-partitions.ts` — 新增，`migrateLegacyBrowserPartitions()`：扫描 `Partitions/dogear-browser-*` → fromPartition 读 cookie → `cookies.set()` 逐条合并（hostOnly 判断是否传 domain）→ 全部成功写 marker；marker 存在且无新写入则直接删目录，有新写入则重合并；单分区失败记日志不阻塞启动
  - `electron/main/services/browser/embedded/embedded-browser-manager.ts` — import 常量；getOrCreateWorkspace/getWorkspaceByWorkspaceId 改用 workspaceId 作 Map 键 + 全局分区；closeTab/handleTabDestroyed 删除键同步改
  - `electron/main/services/browser/embedded/types.ts` — `EmbeddedWorkspaceRecord` 删 `profileKey` 字段
  - `electron/main/main-app.ts` — whenReady 内（playbook 迁移之后、createWindow 之前）await 挂载迁移
- 验证：`bun run build:electron` 通过；`bun run lint` 0 errors；隔离临时 userData 端到端验证通过（合并 domain/host-only cookie → marker 后再写入触发重合并不丢 cookie → 跨启动周期删除目录 → 幂等稳态）；真实旧分区 `dogear-browser-6730...` 读出 0 条有效 cookie（分区本来就没有未过期 cookie），已写 marker 待下下次启动删除

### 给下一步的接力棒
- 关键签名 / 数据结构：
  - 全局分区获取：`import { GLOBAL_BROWSER_PARTITION } from 'electron/main/services/browser/embedded/profile.js'` → `session.fromPartition(GLOBAL_BROWSER_PARTITION)`；Step 2 白嫖框 tab 的 webPreferences.partition 直接用该常量，与 agent 内嵌浏览器共享登录态
  - 迁移：`migrateLegacyBrowserPartitions(): Promise<void>`（main-app.ts whenReady 已挂载，无需再调）
  - manager 语义：workspaces Map 键 = workspaceId；同 workspaceId 共享 record（tabs/agentTabId/activeTabId），所有 record 的 session/partition 都是全局同一份
- 下个 step 该从哪里继续：Step 2 白嫖框 tab —— 渲染层新建 tab 组件，通过 tipc 走 manager.openTab（source 传 'user-connected'）或按 Step 2 计划新建专用入口，partition 用 GLOBAL_BROWSER_PARTITION
- 待办或已知限制：
  - 仅迁移 cookie；旧分区的 localStorage 等其他存储不迁移（站点若用 localStorage 存登录 token 则需重新登录，内嵌浏览器场景主流站点以 cookie 为主）
  - marker 后有新写入时需要两个启动周期才删净目录（第一次重合并+刷新 marker，第二次删除），属预期行为
  - 真实分区目录删除将在新版应用前两次启动内完成，日志关键字 `[embedded-browser]`
