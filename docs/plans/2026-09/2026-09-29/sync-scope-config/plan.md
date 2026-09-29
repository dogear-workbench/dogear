# 设备同步范围可配置化 实施计划

**目标**：LAN sync 同步范围从硬编码白名单改为用户可配置（固定开关列表，两端统一）；顺带修复 shadow-git 误同步隐患，把 `.conflict-*` 副本传播做成开关。冲突语义不变。

**设计全文**：`docs/plans/2026-09/2026-09-29/sync-scope-config-design.md`（含用户拍板记录与关键坑位：集合差 diff 的对称过滤、syncOptionsRev 合并语义）

**涉及模块**：`electron/main/services/sync/`（manifest / orchestrator / apply / protocol）、`settings-service` + `settings-types`、`tipc/sync.ts`、数据中心 `sync-settings.tsx`

## 步骤索引

- [x] [Step 1: 排除引擎与对称过滤](./step1-exclude-engine.md) — isExcluded 纯函数 + 清单/拉取/应用三处过滤 + 协议版本 bump + 单测
- [x] [Step 2: 设置模型与两端统一](./step2-settings-merge.md) — syncOptions 新字段 + syncOptionsRev + settings merge 特判 + orchestrator/lan-sync-service 透传 + 单测
- [x] [Step 3: tipc 路由与设置 UI](./step3-tipc-ui.md) — setSyncOptions schema 扩展 + 「同步范围」开关列表（settings.json 置灰）+ shadow-git/副本提示文案 + 手动验收

## 全局决策

- **三处对称过滤缺一不可**（设计 §3.4）：只改 buildManifest 会被 remote-only 照拉架空；应用侧过滤是对旧版本对端的兜底。
- **以本端 excludes 为准**过滤：本端不想要的路径不落盘，无论对端清单怎么说。
- **stocks/feishu 保留独立键**不迁移；UI 统一呈现。
- **存量不删**：shadow-git 文件与 .conflict-* 副本停止同步后保留在本端。
- **结构性排除（.bak/.lock/.tmp、__pycache__ 等）保持硬编码**，只有上述三类语义进可配置层。
- **新逻辑带单测**（沿用 merge-records.test.ts 以来的现状；lan-sync 早期「不写单测」偏好已被取代）。
- 默认值：disabledSyncItems=[]（全开）、syncConflictCopies=false、syncShadowGit=false——默认行为相对现状只变 shadow-git 与副本两处，这正是修复目标。

## 验收（对照设计 §4）

默认行为仅两点变化（shadow-git、副本不再同步）✓；单测覆盖 isExcluded / manifest 排除 / 对称过滤 / rev 合并（35 项新增用例全绿）✓；双机手动验收遗留（依赖 Mac 真机，同 lan-sync step5 未完成约束，可与该步合并做）。

## 实施总结（2026-09-29）

- 三步全部完成，分三笔提交：step1 377a9547（排除引擎与对称过滤）、step2 36113ea9（设置模型与 rev-LWW merge）、step3（tipc 防呆 + UI）。
- 实施中拍板：rev 自增触发集 = 五个 rev 组字段（含 stocks/feishu），理由与回退方式见 step2 实施记录；设计文档 §3.2 已同步修正。
- 已知遗留：① 双机手动验收（依赖 Mac）；② server.ts writeIncomingFile（对端主动推入口）不在三处对称过滤内，旧版对端推来的排除路径落成不参与同步的死文件，无害；③ SCOPE_SKIP_REASONS 文案复制可后续提纯共享模块。
