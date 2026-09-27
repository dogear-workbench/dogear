# Step 1: 止血——孤儿导入不删目录、冲突挂起待选、同步方向三档

对应设计决策 D1 + D2 + D3。改完本步，事故两直接隐患（删源目录、冲突静默 LWW）与方向不可控全部关闭。

## 1A 孤儿导入永不删源目录（D1）

- `electron/main/tipc/workspace.ts` L154：`input.deleteAfterImport ?? true` → `?? false`。
- `app/settings/WorkspaceManagementTab.tsx` L154 附近：删除 `deleteAfterImport: true` 传参；导入成功提示改为「已合并 N 条会话索引；源目录已保留，请人工确认无遗漏后再清理」。
- `workspace-recovery-service.ts` 的 `deleteAfterImport` 参数与删除分支保留（无调用方传 true，防御纵深），在参数注释标注「完整搬迁工具上线前禁止传 true」。

验收：UI 合并导入后孤儿目录仍在磁盘；tipc 直调不传 deleteAfterImport 不删目录。

## 1B 冲突挂起 + 用户选择（D2）

- `orchestrator.ts`：
  - `RunSyncOptions` 增加 `conflictResolutions?: Record<string, 'local' | 'remote'>`。
  - conflict 循环改为查表：`remote`/`local` 分别走现有对端胜/本端胜分支（副本逻辑不变）；**无条目 → `skipped.push({relPath, reason: '冲突待处理，本轮跳过'})` 且 `conflicts.push(relPath)`**；有裁决的文件不再 push 进 conflicts（或单列 `conflictsResolved`，取前者，面板语义简单）。
  - 有裁决时该文件计入 pulled/pushed（沿用现有计数）。
- `tipc/sync.ts` `runSync` input 增加 `conflictResolutions?: Record<string, 'local' | 'remote'>` 透传。
- `stores/sync-store.ts` `runSync(peerId)` 签名扩展 `opts?: { confirmVersionMismatch?, conflictResolutions? }`。
- `app/data-center/sync-result.tsx`：
  - 冲突列表 hint 改为「双方都改过、尚未处理；选择保留哪一侧，另一侧自动存 .conflict- 副本」。
  - 每行加两个 ghost 按钮「取对端」「保留本端」→ `runSync(peerId, {conflictResolutions: {[relPath]: 'remote'|'local'}})`（peerId 从 lastReport 取，按钮期间 disable）。
  - conflicts ≥ 3 时列表顶部加批量按钮「全部取对端」「全部保留本端」。
- `sync-peer-card.tsx` 首次同步提示文案改：「两端还没有共同基线，同名但内容不同的文件会列为待处理冲突，需要你选择保留哪侧（首次交接可一键全取旧设备一侧）」。
- 前后端若各自维护 SyncReport/RunSyncOptions 类型，同步改。

验收：制造双改冲突（两端各改同一文件）→ 同步后该文件两端都未变、出现在待处理冲突列表 → 点「取对端」→ 本端被对端内容覆盖且本端旧内容成 `.conflict-<对端短ID>` 副本；「保留本端」反向同理。

## 1C 同步方向三档（D3）

- `orchestrator.ts`：`RunSyncOptions` 增加 `direction?: 'both' | 'pull' | 'push'`（缺省 both）。
  - `push` 档：跳过 `applyIncoming` 阶段（pullItems 不执行）；冲突 remote 胜分支同样跳过。
  - `pull` 档：跳过 `pushOutgoing` 阶段；冲突 local 胜分支（推对端副本 + 推本端内容）同样跳过，无裁决的冲突照旧挂起。
  - `diff` 本身不变（两端清单仍要交换，对端清单就是拉取依据）。
- `tipc/sync.ts` runSync input 透传 direction；`sync-store.ts` 同步扩展。
- `sync-peer-card.tsx`：「同步」按钮改为 Button + 下拉（DropdownMenu）：「双向同步（默认）/ 仅拉取 / 仅推送」，三个菜单项分别调 `runSync(peerId, {direction})`；进行中状态沿用。
- 默认档：**双向**（待用户拍板，若用户选「仅拉取」为默认则改菜单第一项与缺省值，一行改动）。

验收：仅拉取档下，本端新增文件不会被推到对端（对端无该文件）；仅推送档下，对端新增文件不落本端。

## 回归

- 版本不匹配拦截（confirmVersionMismatch）链路不回归。
- 单侧修改正常 pull/push 不回归；settings.json 字段合并不回归。

## doc-sync

完成后按仓库惯例同步 codebase-map 相关条目（若 sync 域有条目提及 LWW 语义，更新之）。
