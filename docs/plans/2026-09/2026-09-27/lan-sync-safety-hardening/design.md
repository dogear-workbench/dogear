# LAN 同步安全加固设计（sync-safety-hardening）

**日期**：2026-09-27
**背景**：2026-09-27 真机交接同步（Mac ↔ Windows）发生数据丢失事故（见工作区记忆 `dogear-sync-data-loss-recovery`）。本文档覆盖事故两个直接隐患 + 用户后续提出的同步方向与工作区映射问题，共四项。

## 问题清单（已逐一核对代码现状）

### P1 孤儿导入默认删除源目录 —— 隐患仍在
- `tipc/workspace.ts` L154：`input.deleteAfterImport ?? true`（RPC 层默认 true）
- `app/settings/WorkspaceManagementTab.tsx` L154：UI 显式传 `deleteAfterImport: true`
- `importOrphanToWorkspace` 只把 `conversations.json` 索引 merge 进目标工作区，**不搬 sessions 正文、groups、notes、memory**；随后 `fs.rm(孤儿目录, {recursive, force})` 整目录删除 → 未迁移内容永久丢失。事故中 db291a2d 目录即因此被删。

### P2 同步方向不可控
- 现状：点「同步」= 双向一把梭（pull + push），`runSyncInternal` 无方向参数。
- 用户期望：在 A 端点同步 = 把 B 端数据拉过来，可控地决定是否改动对端。

### P3 冲突自动 LWW、无干预手段
- 现状（`orchestrator.ts` conflict 循环）：双改冲突按 mtime 自动裁决（新者胜），败方留 `.conflict-<短ID>` 副本；结果面板只展示文件列表，无任何处理入口。
- mtime 跨机器不可靠（时钟偏差、恢复/复制刷 mtime）——事故中旧内容正是 mtime 更新而胜出，覆盖了活文件。

### P4 活文件整文件覆盖 + 工作区身份无映射
- **P4a 记录型 JSON 整文件覆盖**：`workspaces/workspaces.json`、`workspaces/*/conversations.json`、`groups.json`、`plans.json`、`notifications.json` 都是「两端各自追加条目」的记录文件；3-way 整文件覆盖天然丢一侧新增。`settings.json` 已有字段级合并先例（`mergeIncomingSettings`），其余文件没有。
- **P4b 工作区身份分叉**：两端各自 `add()` 时 `uuidv4` 独立生成 wsid → 同一项目两个身份。且 `workspaces.json` 条目的 `path`/`additionalPaths` 是**机器特定路径**（`C:\dogear` vs `/Users/...`），整文件同步会把打不开的路径灌到对端（当前 Windows 端注册表里已残留 Mac 路径条目）。用户诉求：首次同步对端空白时，应直接继承本端工作区身份（同 wsid 映射），而不是对端自建新身份。
- 另注：`sync` 无删除传播（对端删了的文件会被本端推回去），本设计不改此语义，仅在此记录。

## 设计决策

### D1（P1）孤儿导入永不删源目录
- `tipc/workspace.ts` 默认值改 `?? false`；`WorkspaceManagementTab.tsx` 不再传 true，UI 文案改为「合并导入后源目录保留，请人工确认无遗漏后再清理」。
- service 层 `deleteAfterImport` 参数保留但无调用方传 true（防御纵深层）。
- 后续真正的「合并后清理」由 P4b 的完整搬迁工具（step3）承接：搬完并校验数量才允许删。

### D2（P3）冲突不再自动裁决，改为挂起 + 用户选择；败方副本 = 回测空间
- `RunSyncOptions` 增加 `conflictResolutions?: Record<relPath, 'local' | 'remote'>`。
- conflict 循环改为查表：`remote` → 走现有「对端胜」分支（本端先存副本再覆盖）；`local` → 走现有「本端胜」分支（仅双向/推送档可用；拉取档下等价于「跳过不动」）；**无条目 → 本轮跳过**，记入 `SyncReport.conflicts`（语义改为「待处理冲突」）。
- tipc `runSync` input 透传 `conflictResolutions`。
- **回测空间显性化**（用户诉求「选错能救回」）：任一侧被覆盖前必存 `.conflict-<胜方短ID>` 副本（机制已有）；冲突列表 UI 明示「另一侧保留在 <副本名>」+ 每行「打开所在文件夹」按钮 + 换回指引文案。
- **按大类批量选择**（用户拍板：逐个点太多）：冲突列表按顶层目录分组（`workspaces/`、`conversations/`、`memory/`、`settings.json` 等），每组两个按钮「整组取对端 / 整组保留本端」；列表顶部再给全局「全部取对端 / 全部保留本端」（首次交接一键收尾）。
- **仅拉取档下的冲突简化**：因对端永不被修改且败方副本兜底，拉取档的冲突可按 mtime 自动取新者 + 留副本（结果面板显著列出，可从副本换回）——「使用本机数据还是更新过来的数据」在新者判定 + 回测空间下自动完成，无需逐个点；双向/推送档仍走挂起 + 手动选择。
- 单侧修改路径（本端未改、对端改了 → 直接 pull 覆盖）保持不变：3-way merge 正确行为，无丢失风险。

### D3（P2）同步方向三档，默认仅拉取；对端永不被修改
- `RunSyncOptions` 增加 `direction?: 'both' | 'pull' | 'push'`，**默认 `pull`（仅拉取）**。
- **仅拉取语义**（用户拍板的工作流：在需要数据的那端点同步，对端常是被动开机方）：
  - 本端为接收方，**对端文件一个都不动**（不 push 任何内容，冲突本端胜分支也不推对端）。
  - 逐文件按新者胜：对端有本端无 → 拉；对端 mtime 较新 → 拉覆盖（记录型文件走 D4 条目合并）；**本端较新或仅本端有 → 本端不动**——即使搞错了「哪边新」，本端新数据也不会被对端旧版顶掉。
  - 无删除传播（沿用全局决策）：对端已删、本端仍有的文件不删，本端多余文件不清理。
- 仅推送 / 双向保留下拉可选项（换新设备首次灌数据用推送），不作为默认。
- UI（`sync-peer-card.tsx`）同步按钮改下拉：仅拉取（默认）/ 仅推送 / 双向。

### D4（P4a）记录型文件条目级合并
- `apply.ts` 建 merge registry（模式 → mergeFn），`applyIncoming` 命中模式的文件走合并落盘而非整文件覆盖：
  | 文件 | 键 | 同键冲突规则 | 机器亲和字段 |
  |---|---|---|---|
  | `settings.json`（现有） | — | 已实现 pairedDevices 并集、deviceName 保本端 | deviceName |
  | `workspaces/workspaces.json` | workspace id | 条目并集；同 id 时 `path`/`additionalPaths`/`isDefault` 取本端，`name`/`createdAt` 取更早（稳定） | path/additionalPaths/isDefault |
  | `workspaces/*/conversations.json` | sessionId | 并集；同 id 取 `updatedAt` 新者 | — |
  | `workspaces/*/groups.json` | group id | 并集；同 id 取 `updatedAt` 新者 | — |
  | `plans.json` | task id | 并集；同 id 取 `updatedAt` 新者（结构 `{version:2,tasks:[]}`，实施时核对任务字段） | — |
  | `notifications.json` | 通知 id | 并集；同 id 取新者 | — |
- **diff 后处理**（orchestrator）：`diff.conflict` 中 relPath 命中 merge 模式的条目移入 pullItems（apply 层合并收敛，合并幂等），**不进** conflictsPending——记录型文件靠合并收敛，不靠人工裁决。
- baseline：merge 落盘的文件统一重算 hash 后入 baseline（把现有 `settingsMerged` 特判推广为 `mergedFiles: string[]`）。

### D5（P4b + UI 可用性）工作区身份、搬迁与面板放大
1. **首次/对端空白**：workspaces.json 条目并集（D4）+ `workspaces/<wsid>/` 目录正常 pull → 对端自动以同 wsid 出现该工作区；条目 `path` 保本端（D4 机器亲和）不影响身份。首同步提示文案更新：「新设备请先同步、不要手动添加同名工作区，同步后自动出现」。
2. **分叉检测**：同步报告新增检查——`workspaces/` 下存在未注册目录（孤儿）或两端 workspaces.json 合并后出现同名不同 id 条目时，在 warnings 提示走搬迁工具处理。
3. **完整工作区合并搬迁**（新 service `mergeWorkspaceInto`，替代旧 importOrphanToWorkspace 的地位）：
   - 搬 `conversations.json`（条目 merge + `workspaceId` 改写）、`groups.json`、`groups/`、`notes/`、`memory/`、`sessions/`（jsonl 文件名含 flat-cwd，跨机器目录名不同但 sessionId 在文件名尾部，实施时核对读取侧定位方式——若按 sessionId 索引则直接搬）。
   - 搬迁完成且条目数校验通过后，才提供「删除源目录」确认操作。
   - UI 入口：工作区管理的孤儿面板 + 同步面板分叉提示。
4. **同步面板放大与冲突处理可用性**（用户拍板：数据中心位置放大、好点好操作）：
   - 有待处理冲突时结果卡片升级为显著区域（顶部醒目横幅 + 冲突列表默认展开），不再是折叠小列表。
   - 冲突行操作按钮加大；按大类分组的批量操作条置顶；「打开所在文件夹」入口每行可达。
   - 数据中心入口层面的放大（侧边栏/导航按钮）属全局 UI 调整，若用户指的是入口而非面板内区域，单独小改动处理，不阻塞本计划。

## 实施步骤（依赖顺序）

- **step1 止血**：D1 + D2 + D3（互不依赖，一次改完）——堵住事故复发口。
- **step2 记录合并**：D4（apply registry + orchestrator 后处理 + baseline 推广）。
- **step3 身份与搬迁**：D5（文案 + 检测 + mergeWorkspaceInto + 面板放大）。

## 已拍板决策（2026-09-27 用户确认）

1. 同步默认方向 = **仅拉取**（在需要数据的那端点同步；对端永不被修改；本端逐文件按新者胜，本端更新的不动）。双向/仅推送保留下拉可选项。
2. 冲突处理 = 按大类（顶层目录）批量选择 + 全局一键批量；逐文件按钮保留；败方副本 = 回测空间（UI 显性化：位置提示 + 打开文件夹 + 换回指引）；仅拉取档冲突按 mtime 自动取新者 + 副本兑底。

## 风险与实施确认项

- `conversations.json` 条目 `updatedAt` 由写入侧维护，merge 依赖其单调性——实施时抽查两端真实数据。
- sessions jsonl 定位：`session-id-repair.ts` 提示按文件名扫 `sessions/<flat-cwd>/<ts>_<sessionId>.jsonl`；确认读取侧是按 sessionId 全量扫描还是按 cwd 定位，决定 step3 搬迁是否需要重命名。
- `plans.json` 任务条目字段（id/updatedAt 具体名）实施时核对。
- 合并幂等性：并集 + 同键新者胜是幂等的，两端各跑一次同步即收敛；若发现合并后仍进 conflict（merged 结果与两端都不同），由 D4 的「conflict 移入 pull」后处理兜住。
