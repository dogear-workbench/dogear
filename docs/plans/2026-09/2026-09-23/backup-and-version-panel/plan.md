# 应用数据备份与版本面板 实施计划

**目标**：文件历史面板两处体验修复 + 应用数据分类备份机制（可配可手动可恢复）+ 数据中心「版本与备份」区块。

**架构思路**：备份为独立 backup-service（zip 全量轮换，内建轻量调度：启动检查 + 30 分钟 tick，目录时间戳即到期状态，零额外存储），不接入 scheduler（其任务唯一形态是跑 agent 会话，备份纯本地操作不该过模型）。配置存 settings.json `backup` 节，每分类独立开关/频率/保留份数。UI 入口集中在数据中心「版本与备份」区块。设计全文见 [../backup-and-version-panel-design.md](../backup-and-version-panel-design.md)。

**涉及模块**：`electron/main/services/backup-service/`（新增）、settings 配置节、tipc backup/git-summary 路由、`app/data-center/` 新区块、`components/FileHistoryPanel.tsx` + `lib/line-diff.ts` + `components/file-history/HistoryDiffView.tsx`。

## 步骤索引

- [x] [Step 1: 文件历史面板修复](./step1-history-panel-fix.md) — 右侧版本详情头放全 + diff hunk 折叠模式
- [x] [Step 2: backup-service 服务层](./step2-backup-service.md) — 分类定义、zip 打包、轮换、恢复、内建调度，脚本全链路验证
- [x] [Step 3: settings 备份配置节 + tipc 路由](./step3-settings-ipc.md) — 配置读写 + backup 五个路由 + git 状态汇总路由
- [x] [Step 4: 数据中心「版本与备份」区块](./step4-datacenter-panel.md) — 用户仓库/影子/备份三分区展示与操作

## 全局决策

- **分类 key**（kebab-case）：`notes-groups`（notes/ + groups/ + dashboard.md）、`memory`（工作区 memory/ + 全局 memory/）、`tasks`（tasks.json）、`sessions`（sessions/）；settings/logs 不出现在可备列表
- **scope**：workspace 级分类按工作区各自备份（遍历所有工作区），tasks 与全局 memory 归 `global` scope；zip 存 `.dogear/backups/<workspaceId|global>/<key>-<YYYYMMDD-HHmmss>.zip`
- **频率**：`daily | weekly | monthly | manual` 四档；同分类两个 scope 共用一份配置
- **默认配置**：notes-groups/memory/tasks = 开·daily·保留 10 份；sessions = 开·monthly·保留 10 份（用户可改，策略不写死）
- **到期判断零状态**：扫备份目录最新文件名时间戳 vs 频率间隔，不存 lastFiredAt
- **恢复纪律**：恢复前同分类自动预备份当前状态，预备份失败则中止恢复
- **串行队列**：同 scope+key 的备份/恢复操作串行（沿用影子仓库 `enqueue` 队列模式，见 `electron/main/services/git-service/shadow.ts:33`）
- **zip 实现**：复用已有依赖 `adm-zip`（package.json 已有，零新依赖）
- **红线**：不绕过 tipc、渲染层不碰文件系统、UI 确认统一 `showConfirm`
- 每个 step 完成后 `bun run lint` + `bun run build:electron`（涉及主进程时）通过，且只 add 本计划相关文件

## 完成总结（2026-09-23）

四个 step 全部落地并逐 step 提交（5e06617d / d67e1eb8 / 57baae41 / d9a0b3d1，另 5db2acb1 修上计划遗留的 FileHistoryPanel tsc 错误）：

1. **文件历史面板**：右侧版本详情头（徽标/含秒时间/完整消息/hash/差异统计），diff 折叠为 hunk 段按需展开（buildHunks 输出层折叠，LCS 不动）
2. **backup-service**：四分类（notes-groups/memory/tasks/sessions）zip 全量轮换备份，串行队列、零状态到期调度（30 分钟 tick）、恢复前自动预备份失败即中止，46 项断言验证通过
3. **settings + tipc**：backup 配置节（四分类开关/频率/保留份数，缺省补默认非法值归一）+ backup 五路由 + getWorkspaceGitSummary（git 缺失降级），28 项断言验证通过
4. **数据中心「版本与备份」tab**：用户仓库/影子安全网只读展示 + 四分类备份配置与操作（立即备份/列表展开/恢复 showConfirm/全部备份/打开目录），codebase-map 已同步

**待人工验证**（子会话无法跑 GUI）：详情头排版与折叠交互、备份全链路点击（改配置→立即备份→列表→恢复→刷新）、openBackupDir shell 行为、git 两区显示与 `git status` 对照。

**已知限制**：restoreBackup 预备份 keep 固定 10；sessions（~239M）同步打包阻塞主进程数秒（UI 已 loading 缓解）；全部备份多项失败 toast 单行可读性一般。后续可选方向见设计文档「未决问题」。
