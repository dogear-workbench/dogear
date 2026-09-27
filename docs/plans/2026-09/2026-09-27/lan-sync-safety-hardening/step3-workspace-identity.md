# Step 3: 工作区映射与选择性同步

> **状态：已完成（2026-09-27）**。实施确认项结论：① sessions 读取为 flat-cwd 目录定位，两端不兼容 → 折算已覆盖 sessions 子目录名重写（pull 用本端编码可算，push 依赖对端 hello.dataDirPath，旧版对端退化旧行为）；② buildManifest 过滤走 ManifestOptions.enabledWorkspaceIds（undefined=全量兼容/空数组=全关）；③ workspaceMeta 轻量只读注册表+conversations 索引。实施中发现并修复：映射折算后 candidateHashes 失配 → 服务端把请求条目按自己映射折算后匹配（否则分叉收敛大面积退化为待处理冲突）。遗留：真机两端 E2E 未跑（单测+真机编码比对覆盖，建议联调时按验收清单过一遍，重点双端同为本次版本）；workspaces.json 并集会把对端机器路径条目灌进本端注册表（step2 既有语义，建议后续 UI 对 path 不可达工作区提示/隐藏）。

对应设计决策 D5。目标：工作区跨设备身份通过**显式映射表**互通（首次交接、两端分叉均覆盖）；未映射目录不自动同步；已映射工作区可逐个开关；全局数据恒定同步。

## 3A 映射表与引擎路径折算

- `sync-state.ts`：`peers[peerId]` 增加：
  ```ts
  workspaceMap: Record<localWsid, { remoteWsid?: string; enabled: boolean }>;
  ignoredRemoteWorkspaces?: string[];   // 待映射区选过「不同步」的对端 wsid
  ```
  remoteWsid 缺省 = 同 id 直通；enabled 建映射时默认 true。
- 折算函数（新 `sync/workspace-map.ts` 或并入 manifest.ts）：
  - `toLocalRelPath(relPath)`：对端清单 `workspaces/<remote>/...` 前缀按映射换 `<local>`；无映射的 workspaces/ 路径 → 返回 null（进待映射清单）。
  - `toRemoteRelPath(relPath)`：推送方向反向折算（both/push 档用）。
- `orchestrator.ts`：
  - 对端清单 entries 先过 `toLocalRelPath`：null 且前缀为 `workspaces/<id>/` 且 id 不在忽略列表 → 汇入 `SyncReport.unmappedWorkspaces`（含可展示信息：wsid、（若对端清单带）名称/会话数——需在协议 manifest 响应里附带对端工作区元信息，见 3D）；在忽略列表 → 静默跳过。
  - 本端 manifest：`buildManifest` 增加映射过滤参数——`workspaces/` 目录只收「映射表中 enabled=true」的 wsid（未映射的本端工作区同样不同步，与对端对等：首次使用即受控）。
  - pull/push 路径折算接入 `applyIncoming` / `pushOutgoing` 的 relPath（拉对端 `<remote>` 存本端 `<local>`；推反之）。
- baseline：折算后以**本端路径**记（baseline 是本端视角快照，天然一致）。

## 3B 握手交换映射（反向自动学习）

- `protocol.ts` manifest 响应增加可选字段 `workspaceMap`（对端的 local→remote 视角）与 `workspaceMeta`（对端 workspaces 概要：wsid、name、会话数、lastUpdated，供待映射区展示）。
- orchestrator 收到后：对端映射条目 `<对端X ↔ 本端A>` → 本端补 `workspaceMap[A] = {remoteWsid: X, enabled: true}`（已存在则不覆盖 enabled）。
- server 端（对端旧版本无这些字段）：字段可选，旧版对端 → 本端待映射区照常工作，仅反向学习不生效（升级后闭环）。

## 3C 同步面板「工作区同步」卡片 + tipc 路由

- `tipc/sync.ts` 新增：
  - `setWorkspaceSync(peerId, localWsid, { enabled })`：开关。
  - `mapWorkspace(peerId, { remoteWsid, mode: 'new' | 'existing', localWsid?, localPath?, localName? })`：建映射——`new` = 本端建工作区条目（复用 workspace-json-service.add，path 用用户选的本地目录）+ 建映射；`existing` = 直接建映射。
  - `unmapWorkspace(peerId, localWsid)`：断开（表项删，数据不动）。
  - `ignoreRemoteWorkspace(peerId, remoteWsid)` / `unignoreRemoteWorkspace`：忽略列表维护。
- `sync-panel.tsx` 新增卡片（SyncPeerCard 下方或独立 section）：
  - **已映射区**：每行 `本端名 ↔ 对端名 · 状态（同步中/已暂停）· 开关 · 断开`。
  - **待映射区**（来自上次报告 `unmappedWorkspaces`）：每项展示名称/会话数/最后更新，三动作按钮：接收为新工作区（弹本地目录选择 → mapWorkspace new）/ 映射到本端已有（下拉本端工作区列表 → mapWorkspace existing）/ 不同步（ignore）。
  - 底部说明：「全局数据（设置、计划、记忆等）恒定同步，不可关闭」。
- 建映射后自动触发一次仅拉取（把该工作区数据拉下来），或提示用户点同步——取自动触发，交接体验顺。

## 3D 协议扩展与展示元信息

- `protocol.ts`：manifest 请求/响应加可选 `workspaceMeta: Array<{ wsid, name?, conversationCount?, lastUpdated? }>`（server 端从本端 workspaces.json + 各 conversations.json 汇总，轻量统计）。
- 版本兼容：字段全部可选，旧版互操作不破坏；SYNC_PROTOCOL_VERSION 是否 bump 视实现（加字段不破坏旧版则不 bump，保持可互通）。

## 3E 冲突处理区域放大（面板内）

- 若 step1 已落地冲突显著区，本步补齐布局层：同步面板 max-w 放宽（4xl → 全宽或 6xl）、字号/行高提升、批量操作条吸顶；1920 宽下无横向滚动、行操作按钮 ≥ 32px 高。

## 验收

1. **首次交接**：新空白端点同步 → 报告列出对端工作区待映射 → 「接收为新工作区」选本地目录 → 映射建立 + 自动拉取 → 本端出现同数据工作区（本端 wsid 为新建 id，映射生效）→ 对端配置不变。
2. **两端分叉**：两端各自注册同一项目（不同 wsid、各有会话）→ 一端「映射到本端已有」→ 同步 → 两端会话/组/笔记并集收敛，无副本爆炸（记录文件条目合并）。
3. **开关**：关闭某工作区 → 同步不再传输该目录任何文件（manifest 过滤生效）→ 重新打开 → 增量补齐。
4. **忽略**：待映射区选「不同步」→ 下次同步不再出现在待映射列表；可解除忽略。
5. **全局恒同步**：关闭全部工作区后，settings/plans/memory 等仍正常同步。
6. **反向学习**：一端建映射 → 握手后另一端 sync-state 自动出现反向映射条目，无需手动配置。

## 实施确认项

- sessions jsonl 读取侧定位方式（sessionId 扫描 vs flat-cwd 定位）——映射后两端 flat-cwd 子目录并存，需确认读取兼容；查 `session-history-reader` / `conversation-service`。
- `buildManifest` 过滤参数的注入点（ManifestOptions 扩展 or 调用方预过滤目录列表）。
- server.ts manifest 响应组装处（加 workspaceMeta 的成本与性能：全量 conversations.json 扫描，900M 首交时统计耗时需实测，必要时只统计条目数）。
