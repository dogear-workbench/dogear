# Step 3: 工作区身份传承与完整搬迁

对应设计决策 D5。目标：① 首次同步对端空白时工作区以同 wsid 自动出现（传承）；② 同步后检测身份分叉并提示；③ 提供「完整工作区合并搬迁」工具替代旧的仅索引导入。

## 3A 首次同步同 wsid 传承（依赖 step2）

- step2 的 workspaces.json 条目并集 + `workspaces/<wsid>/` 目录 pull 已自动达成传承：对端空白 → 同步后注册条目与目录同 id 出现，`path` 由机器亲和规则保留对端本地路径（条目 path 为本端路径时对端打开前需改指向本地目录——UI 已有的工作区编辑能力承接，不新增）。
- `sync-peer-card.tsx` 首次同步提示文案追加：「新设备请先同步、不要手动添加同名工作区；同步后工作区自动出现，若路径指向另一台机器的目录，请在工作区管理中改为本地路径」。

## 3B 分叉检测

- `runSyncInternal` 收尾新增检查（结果进 warnings）：
  - 扫 `workspaces/` 目录：存在未注册于本端 workspaces.json 的非空 wsid 目录（孤儿）→ warning「发现 N 个未注册的工作区目录（孤儿），可在工作区管理中合并搬迁」。
  - workspaces.json 合并结果中 name 相同但 id 不同的条目对 → warning「工作区 <name> 存在两个身份（<idA>/<idB>），疑似两端各自注册，建议用合并搬迁工具统一」。
- 检查只报告不动数据。

## 3C 完整工作区合并搬迁（新 service）

- 新建 `electron/main/services/workspace-merge-service.ts`：`mergeWorkspaceInto(sourceWorkspaceId, targetWorkspaceId): Promise<MergeReport>`
  - `conversations.json`：条目逐个并入目标（复用 `importConversation`），并把 `workspaceId` 字段改写为目标 id。
  - `groups.json`：条目并入目标 groups.json（id 并集，同 id 取 updatedAt 新者；目标不存在该 group 时补条目）。
  - `groups/`：源 `groups/<groupId>/` 目录整体 move 到目标（目标已存在同名组目录时逐文件并入，冲突文件以 `.merged-from-<sourceShort>` 副本保留源版）。
  - `notes/`、`memory/`：文件并入（同名冲突保留两份，源版加后缀）。
  - `sessions/`：jsonl 文件 move 到目标 `sessions/<同一flat-cwd子目录>/`（文件名含 flat-cwd 与 sessionId；**实施前确认读取侧定位方式**——若按 `<flat-cwd>/<ts>_<sessionId>.jsonl` 命名契约扫描则原样搬即可；跨机器产生的 flat-cwd 子目录不同属正常，各自保留）。
  - 搬迁计数报告：sessions/groups/notes/memory 文件数与条目数，源与目标前后对比。
- 源目录清理：**搬迁工具本身不删**；搬迁成功后 UI 提供「删除已搬迁的源目录」按钮（确认弹窗列计数对比），删除前再校验源目录 sessions 文件数 == 0。
- `tipc/workspace.ts`：新增 `mergeWorkspace` 路由（输入 source/target id）。
- UI：
  - `WorkspaceManagementTab.tsx` 孤儿面板：合并导入入口改调 `mergeWorkspace`（目标 = 用户选择的当前工作区，补目标选择下拉）；导入文案与成功提示更新。
  - 同步面板分叉 warning 处可跳转工作区管理（简单 a11y 链接或文案指引即可）。
- 旧 `importOrphanToWorkspace` 保留但标记 deprecated（tipc 路由保留兼容，前端不再调用）。

## 验收

1. 构造孤儿工作区（未注册目录 + 会话/组/笔记/memory 内容）→ 合并搬迁 → 目标工作区会话列表可见、组/笔记/记忆齐全、会话正文可打开；源目录仍在，删除按钮校验通过后可删。
2. 两端各自注册同名工作区（不同 id）→ 同步 → 出现分叉 warning → 在一端搬迁合并 → 再同步 → warning 消失、两端收敛。
3. 首次同步（新空白端）→ 工作区同 id 出现、注册表含两端全部条目、isDefault/path 未被覆盖。

## 实施确认项

- sessions 读取侧定位方式（sessionId 扫描 vs cwd 定位）——决定 3C sessions 搬运是否需要改名；查 `session-history-reader` / `conversation-service` 的 jsonl 查找逻辑。
- `groups.json` 条目结构与组目录归属字段核对。
