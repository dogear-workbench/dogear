# 设备同步范围可配置化 设计文档

日期：2026-09-29
状态：方案已拍板，待实施
背景调研：会话「调研设备同步范围」（manifest/orchestrator/apply 全量代码核对），结论已存工作区记忆 `sync-whitelist-conflict-copy-mechanics`

## 1. 问题

1. **同步范围硬编码**：白名单（`manifest.ts:13-22` 顶层常量）用户不可配置。能调的只有 stocks/feishu 开关、per-peer 工作区启停、同步方向。
2. **shadow-git 误同步（隐患）**：影子仓库 git-dir 位于 `workspaces/<wsid>/shadow-git/`，不在 `IGNORE_DIR_NAMES` → git 对象库/refs/index 被当普通文件跨设备互传。两端各自打快照后 refs 指向不同 commit、index 二进制必然不同 → 每轮同步都对这些 git 内部文件做冲突裁决、副本堆积；refs 被对端覆盖致本端最新快照悬空；gc 后 pack 互覆盖可能损坏仓库。参照：`backups` 目录（zip 备份）本就在排除列表——「本端保护性数据不跨端」有先例。
3. **`.conflict-*` 副本跨端累积**：副本进清单同步是原设计（manifest.ts:48-49 注释），但撞名静默覆盖（同一胜方二次胜出覆盖上一份副本，apply.ts:58）且零清理机制，只增不减。

## 2. 用户拍板（2026-09-29）

- **粒度**：固定开关列表（白名单逐项 on/off），不做自定义路径排除。
- **配置两端统一**：排除配置随 settings.json 同步传播，两台设备收敛为一致。
- **conflict 副本与 shadow-git**：各做成开关，UI 带说明提示。默认值取「不同步」（本设计 §3.3 论证）。
- **冲突语义维持现状**：默认拉取档 mtime 裁决 + 败方留副本（结果面板可见，无需处理）；双向/推送档挂起等用户逐个裁决（取本端/取对端）。用户认可此模型，本次不改。

## 3. 设计

### 3.1 配置模型（settings.syncOptions 扩展）

```ts
syncOptions: {
  deviceName: string;            // 保持现状：每端独立，merge 保本端
  pairedDevices: [...];          // 保持现状：并集
  syncStocksData: boolean;       // 保持现状（默认 false）
  syncFeishu: boolean;           // 保持现状（默认 false）
  // —— 新增 ——
  disabledSyncItems?: string[];  // 关闭的同步项 id（SyncItemId），默认 [] = 全开
  syncConflictCopies?: boolean;  // .conflict-* 副本是否同步，默认 false
  syncShadowGit?: boolean;       // shadow-git/ 目录是否同步，默认 false
  syncOptionsRev?: number;       // 范围字段修订号，setSyncOptions 改范围字段时 ++
}
```

**SyncItemId 枚举（12 项）**：`workspaces / conversations / memory / usage / article-parser / site-knowledge / run-history`（目录 7）+ `settings.json / plans.json / notifications.json`（文件 3）+ `stocks / feishu`（可选 2）。

- stocks/feishu **保留现有独立布尔键**（不迁入 disabledSyncItems），避免迁移逻辑；UI 层统一呈现为一张开关列表。
- **必选项保护**：`settings.json` 不可关（关掉则 syncOptions 自身不再传播，自相矛盾）——UI 置灰并标注「必选」；`workspaces` 关闭 = 所有工作区数据不同步，允许但 UI 说明后果；`plans.json`/`notifications.json` 可关，说明「关闭后任务/通知不跨设备」。
- 旧版本读到新字段会被 `normalizeSyncOptions` 丢弃（现状行为），旧端退回「全开」按旧白名单跑，协议版本警告（§3.5）提示升级。

### 3.2 两端统一机制：syncOptionsRev

settings.json 走 merge registry 条目级合并（apply.ts:166-201），现状仅 deviceName 保本端、pairedDevices 并集。新增规则：

- `setSyncOptions` 修改范围字段（disabledSyncItems / syncConflictCopies / syncShadowGit）时 `syncOptionsRev++`（settings-service 写入口维护，单调递增）。
- merge 时：deviceName、pairedDevices 按现状；**其余 syncOptions 字段整体取 rev 大的一端**（原子替换，不逐字段混）。
- rev 相同但内容不同（两端离线各自改的罕见竞态）→ 保本端，不产生副本（该子对象以本端为准，下轮同步收敛）。

理由：范围配置是「一套整体决策」，逐字段并集会出现「一端关了另一端又开」的振荡；rev-LWW 简单、可解释（「以最近修改的设备为准」）、收敛。

### 3.3 默认值：shadow-git 与 conflict 副本默认不同步

- shadow-git：隐患修复本身就是目标；开启的收益（快照历史跨端共享）远小于 git 内部文件被文件级 mtime 裁决覆盖的风险。UI 说明文案：「影子快照仓库，建议不同步；开启后快照历史将跨设备共享，但两端并发快照时 git 内部文件可能冲突损坏」。
- `.conflict-*`：副本的价值主要在**产生冲突的那台设备**上手动换回；跨端传播有撞名覆盖、永不清理两个坑。UI 说明文案：「同步冲突时自动保留的败方留底副本；默认仅留在产生冲突的设备上，不跨设备传播」。
- 存量文件不受影响：开关关闭只是停止跟随变化，本端已有副本/shadow-git 文件**不删除**。

### 3.4 排除引擎与对称过滤（本次最关键的实现点）

**坑**：diff 是集合差语义——只在 buildManifest 让本端不收某路径，对端清单仍有 → 判 remote-only **照拉不误**，排除被架空。必须三处对称过滤：

1. **清单生成侧**（buildManifest）：`ManifestOptions` 增加 `excludes`；walk 三个入口（walkDir / walkWorkspacesDir / 顶层 statFile）应用。
2. **拉取侧**（diffManifests 或 orchestrator 拉取循环）：对端清单里命中排除的 relPath 跳过不拉。
3. **应用侧**（applyIncoming 入口）：收到的 relPath 命中排除直接丢弃（挡住旧版本对端推来的文件，双保险）。

以**本端 excludes** 为准过滤（本端不想要的东西不落盘）。`isExcluded(relPath, excludes)` 提为**纯函数**供三处共用 + 单测。

排除规则明细：
- `shadow-git`：任意层级目录名 === `shadow-git` 且 syncShadowGit=false → 跳过整树。
- `.conflict-*`：basename 匹配 `*.conflict-*`（含 6 位短 ID 尾缀）且 syncConflictCopies=false → 跳过。
- disabledSyncItems：relPath 等于 `settings.json|plans.json|notifications.json` 或以 `workspaces/|conversations/|memory/|usage/|article-parser/|site-knowledge/|run-history/` 为前缀（stocks/feishu 走现有 OPTIONAL_DIR_FLAGS 开关，不进此过滤）。
- 现有结构性排除（.bak/.lock/.tmp、__pycache__/browser-profile/logs/backups、sync-state.json、符号链接）**保持硬编码不变**。

**基线自然清洗**：排除生效后 buildNextBaseline 以新清单为准；基线中残留的旧条目（两端清单均无）在 diff 中无动作，不产生脏数据（实现时验证一遍）。

### 3.5 协议版本

`SYNC_PROTOCOL_VERSION`（protocol.ts）+1。两端版本不一致时握手警告机制已有（确认覆盖此变更即可）。过渡期行为推演：
- 新端不推 shadow-git/conflict（本端清单已无）；旧端推来的被新端应用侧过滤挡住。
- 旧端清单里若还有新端的 shadow-git 条目（上次同步记的基线），单侧删除无动作（删除不传播），不会误删。

### 3.6 UI（数据中心 sync-settings.tsx）

- 新增「同步范围」分组：12 项开关列表（stocks/feishu 从现有位置迁入统一列表，设置键不变）；`settings.json` 置灰标「必选」；hover/说明文案标注各项内容（如 plans.json = 任务数据）。
- 两个独立开关（shadow-git、冲突副本）带 §3.3 的说明文案，默认关。
- 修改即调 `setSyncOptions`（rev++），与现有保存动线一致。

## 4. 验收标准

1. **默认行为只变两点**：shadow-git、`.conflict-*` 不再同步；其余与现状完全一致。
2. 单测：`isExcluded` 纯函数（三类规则 × 边界）、buildManifest 排除生效、拉取侧/应用侧对称过滤、settings merge 的 rev 语义（rev 大者胜 / deviceName-pairedDevices 不受影响 / rev 相同保本端）。
3. 手动验收（双机，依赖 Mac 真机可用，同 lan-sync step5 约束）：改 A 端开关 → 同步 → B 端生效且收敛一致；旧版本对端过渡期不落脏文件。

## 5. 风险

- rev 竞态（两端离线同时改）：降级保本端，下轮收敛，可接受。
- 过渡期旧端多拉/多推一次：无害（新端过滤兜底）。
- 用户关闭 plans.json 后任务不跨端：预期行为，UI 已说明。
