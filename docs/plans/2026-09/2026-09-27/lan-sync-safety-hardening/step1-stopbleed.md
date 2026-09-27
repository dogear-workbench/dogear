# Step 1: 止血——孤儿导入不删目录、冲突挂起待选、同步方向三档

对应设计决策 D1 + D2 + D3。改完本步，事故两直接隐患（删源目录、冲突静默 LWW）与方向不可控全部关闭。

## 1A 孤儿导入永不删源目录（D1）

- `electron/main/tipc/workspace.ts` L154：`input.deleteAfterImport ?? true` → `?? false`。
- `app/settings/WorkspaceManagementTab.tsx` L154 附近：删除 `deleteAfterImport: true` 传参；导入成功提示改为「已合并 N 条会话索引；源目录已保留，请人工确认无遗漏后再清理」。
- `workspace-recovery-service.ts` 的 `deleteAfterImport` 参数与删除分支保留（无调用方传 true，防御纵深），在参数注释标注「完整搬迁工具上线前禁止传 true」。

验收：UI 合并导入后孤儿目录仍在磁盘；tipc 直调不传 deleteAfterImport 不删目录。

## 1B 冲突挂起 + 用户选择 + 回测空间（D2）

- `orchestrator.ts`：
  - `RunSyncOptions` 增加 `conflictResolutions?: Record<string, 'local' | 'remote'>`。
  - conflict 循环改为查表：`remote`/`local` 分别走现有对端胜/本端胜分支（副本逻辑不变）；**无条目 → `skipped.push({relPath, reason: '冲突待处理，本轮跳过'})` 且 `conflicts.push(relPath)`**。
  - **仅拉取档（默认档）冲突简化**：按 mtime 自动取新者（对端新→拉覆盖+本端副本；本端新→不动），不挂起不推对端；结果面板列出「已自动裁决」清单供从副本换回。双向/推送档维持挂起等 `conflictResolutions`。
  - 有裁决的文件计入 pulled/pushed（沿用现有计数）。
- `tipc/sync.ts` `runSync` input 增加 `conflictResolutions?: Record<string, 'local' | 'remote'>` 透传。
- `stores/sync-store.ts` `runSync(peerId)` 签名扩展 `opts?: { confirmVersionMismatch?, conflictResolutions? }`。
- `app/data-center/sync-result.tsx`：
  - 有待处理冲突时卡片升级为显著区域（顶部横幅 + 列表默认展开），不再折叠。
  - 冲突列表**按顶层目录分组**（`workspaces/`、`conversations/`、`memory/`、`settings.json` 等），每组「整组取对端 / 整组保留本端」；顶部全局「全部取对端 / 全部保留本端」（首次交接一键收尾）；行级按钮保留。
  - 每行「打开所在文件夹」入口 + hint「另一侧保留在 .conflict-<胜方短ID> 副本，选错可手动换回」（回测空间显性化）；需要主进程补一个 reveal-in-folder 的 tipc 路由（若已有则复用）。
- `sync-peer-card.tsx` 首次同步提示文案改：「两端还没有共同基线，同名但内容不同的文件会列为待处理冲突，可按大类一键选择；首次交接建议在旧设备数据拉过来后全部取对端」。
- 前后端若各自维护 SyncReport/RunSyncOptions 类型，同步改。

验收：
1. 双向档制造双改冲突 → 该文件两端都未变、出现在待处理冲突列表 → 按「整组取对端」→ 本端被对端内容覆盖且本端旧内容成 `.conflict-<对端短ID>` 副本 → 「打开所在文件夹」可定位副本。
2. 仅拉取档双改冲突 → 自动取 mtime 新者，败方留副本，面板列出已自动裁决清单。
3. 首次同步大量冲突 → 顶部「全部取对端」一键收尾。

## 1C 同步方向三档，默认仅拉取（D3）

- `orchestrator.ts`：`RunSyncOptions` 增加 `direction?: 'both' | 'pull' | 'push'`，**缺省 `pull`**。
  - `pull` 档（默认）：对端文件一个不动——跳过 `pushOutgoing`；冲突本端胜分支不推（本端新→不动）；仅本端有的文件不推；对端 mtime 较新的拉覆盖；无删除传播。
  - `push` 档：跳过 `applyIncoming`；冲突对端胜分支同样跳过。
  - `both` 档：现状行为（叠加 1B 的冲突挂起/裁决机制）。
  - `diff` 本身不变（两端清单仍要交换，对端清单即拉取依据）。
- `tipc/sync.ts` runSync input 透传 direction；`sync-store.ts` 同步扩展。
- `sync-peer-card.tsx`：「同步」按钮改为 Button + DropdownMenu：**仅拉取（默认）/ 仅推送 / 双向**；主按钮默认动作 = 仅拉取，菜单选其他档；进行中状态沿用。

验收：
1. 仅拉取档：本端新增文件不被推到对端；本端较新的文件在对端旧版面前不动；对端较新的文件被拉过来。
2. 仅推送档：对端新增文件不落本端。
3. 双向档：现状行为不回归。

## 回归

- 版本不匹配拦截（confirmVersionMismatch）链路不回归。
- 单侧修改正常 pull/push 不回归；settings.json 字段合并不回归。

## doc-sync

完成后按仓库惯例同步 codebase-map 相关条目（若 sync 域有条目提及 LWW 语义，更新之）。
