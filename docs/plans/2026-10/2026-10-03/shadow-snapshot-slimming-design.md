# 影子快照收窄设计（shadow snapshot slimming）

**日期**：2026-10-03
**来源**：备份/快照功能根因调查（见共享区 20261003-investigate-backup.md、20261003-investigate-snapshot.md）+ 设计讨论

## 背景

- 自动快照（影子 git）膨胀至 1.3GB：87% 是 `update-server/` 构建产物（18 个安装包 exe ≈1.15GB + update zip ≈141MB），另字体 151MB。根因链：`add -f` 绕过项目 .gitignore → 排除名单（`SHADOW_EXCLUDE_DIRS` 仅 7 个目录）没覆盖构建目录 → 原设计的「大二进制排除」未实现 → 无任何清理机制，528 个 commit 只增不减。
- 用户使用画像：回溯需求 = agent 改坏文件时救急（低频、近期），不需要全量历史回溯；源码工作区已有用户 git 管正式历史。
- 职责辨析（讨论确认，不改动）：ZIP 备份管 `.dogear` 应用数据（笔记/记忆/会话/任务/设置），影子 git 管工作区目录内文件，两者不重合。

## 目标

影子层定位从「无差别全量文件历史」收窄为「**编辑行为回滚安全网**」：只保护会被编辑的东西（源码/文档/笔记），不保护会被生成的东西（构建产物/大二进制）。收窄后快照库体积稳定在几十 MB 以内，且保护范围在 UI 上可解释。

## 架构（核心决策）

沿用 `BACKUP_CATEGORY_DEFAULTS` 的「推荐配置 + 用户可改 + 恢复默认」模式，新增 SnapshotSettings：

| 配置项 | 推荐默认 | 说明 |
|---|---|---|
| 单文件大小阈值 | 8MB | 超过不进快照；通用规则，任何工作区无需手动配置 |
| 排除目录 | `node_modules,out,dist,release,release2,update-server,tmp,.dogear,.git` | 在现有 7 个基础上补 `update-server`、`release2`；用户可追加 |
| 保留窗口（标准档，已拍板） | 近 7 天全留 → 7~30 天每天留最后一条 → 30 天外丢弃 | 快照链按时间窗裁剪 |
| 按工作区开关 | 默认开 | 逃生舱；关闭后该工作区仅剩用户 git（历史面板双源合并自然降级为单源） |

**排除的选项及原因**：
- 文件树逐文件「已保护」标记——文本文件基本全覆盖，标记无信息量，纯噪音（讨论否决）
- ZIP 备份与影子 git 合并——职责域不同，不重合，无需合并
- sessions 分类「全局 conversations 并入每个工作区 zip」语义修正——本次不动，单独立项
- 笔记/任务/记忆纳入 git 级版本管理——ZIP 备份兜底够用，YAGNI

## 模块边界

| 模块 | 改动 |
|---|---|
| `electron/main/services/git-service/shadow.ts` | takeSnapshot 前查开关；excludePathspecs 读配置；新增大小过滤；新增保留裁剪 |
| `electron/main/services/settings-types.ts` | SnapshotSettings 类型 + 默认值常量（对齐 BackupSettings 模式） |
| `app/settings/WorkspaceManagementTab.tsx` | 每工作区快照状态卡（开关/体积/条数/上次快照时间）+ 全局配置区 + 恢复默认 + 「立即瘦身」按钮 |
| `components/FileHistoryPanel.tsx` | 空态可解释：区分「从未被编辑过」vs「未受快照保护（超阈值/在排除目录）」并给出原因 |
| `electron/main/tipc/git.ts` | 体积/条数上报扩展（现有 getShadowRepoSizeBytes 基础上补快照条数、上次时间） |
| `electron/main/services/backup-service/categories.ts` | 顺手小修：listWorkspaceIds 按 workspaces.json 注册表过滤 `personal` |

## 数据流

- 快照路径：agent write/edit 或 UI 文件操作 → 查工作区开关（关则跳过）→ `git add -A -f`（目录排除 pathspec）→ 大小过滤（从暂存区剔除超阈值文件）→ commit
- 大小过滤实现取向：add 后用 `git diff --cached` 枚举新增 blob，超过阈值的 `git restore --staged` 剔除；避免全量 stat
- 保留裁剪触发：每日一次或每 N 次快照后（节流），按窗口规则裁剪 commit 链；实现方式（history rewrite / 段拼接）在实施时验证后定，需保证 refs 与 reflog 同步清理
- 存量瘦身：工作区管理 tab 手动触发（带确认）——对现有影子仓库按新规则重写历史 + `git reflog expire --expire=now --all && git gc --prune=now`，预计释放 ~1.2GB。不做自动触发（重写历史风险高，用户显式确认）

## 错误处理 / 边界情况

- 保留裁剪执行期间用户触发快照恢复：裁剪与快照共用按工作区串行队列，天然互斥
- 阈值/排除调整后，历史中已存在的大 blob：由「立即瘦身」手动消化；不做自动重写
- 关闭快照的工作区打开文件历史：双源合并逻辑退化为仅用户 git 源，无空态报错
- 大小过滤剔除的文件在下一次快照仍会被尝试（文件还在）：可接受，add+unstage 成本低；不做持久化跳过名单
- `personal` 工作区过滤后，`backups/personal/` 已有 3 份 zip 留待用户手动清理，不做代码清理

## 未决问题（实施时补）

- 保留裁剪的具体实现机制（rebase 重写 vs orphan 段拼接）——step2 实施时以最小风险方案验证
- 快照配置 UI 的 tab 归属（WorkspaceManagementTab 内嵌区块，实施时看布局）
- 瘦身按钮的进度反馈形式（同步等待 vs 后台任务 + toast）
