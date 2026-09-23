---
step: 4
title: 数据中心「版本与备份」区块
status: done
---

## 目标

数据中心新增「版本与备份」区块：用户仓库/影子安全网状态只读展示 + 备份分类配置与操作（开关、频率、立即备份、列表、恢复、打开目录）。

## 依赖上下文（接力棒输入）

- 前置 step 产出：[step3-settings-ipc.md] 六个 tipc 路由与 settings backup 节（接力棒记录请求/响应类型）
- 当前关键文件状态：
  - `app/data-center/` 既有分区结构（动手前先读 index/布局文件，新区块沿用既有区块组件形态与间距风格）
  - 恢复操作必须走 `showConfirm`（confirm-store），禁 window.confirm
- 关键决策回顾：备份策略不写死——每分类独立开关/频率/保留份数全暴露给用户；git 两区只读展示（提交仍走 agent）；本轮不做影子历史全局浏览、不做单文件恢复

## 计划改动

- [ ] 新增 `app/data-center/version-backup/`（或沿用数据中心既有目录惯例）：区块组件三分区布局
  - 用户仓库区：isRepo → 分支 + 未提交数；非仓库/无 git → 灰色提示文案
  - 影子安全网区：快照数 + 最近时间 + 体积（人性化显示）
  - 备份区：每分类一张卡（名称/范围摘要、开关 Switch、频率 Select 四档、保留份数、最近备份时间、份数、「立即备份」）；全局操作「全部备份」「打开备份目录」
- [ ] 备份文件列表：按分类展开（或 Dialog），列出 zip（时间/大小），行操作「恢复」（showConfirm 确认 → restoreBackup → toast+刷新状态）
- [ ] 配置变更即保存（onChange → settings 写入，防抖或失焦保存，沿用数据中心既有编辑模式）
- [ ] 备份进行中状态：按钮 loading、完成后刷新该分类状态；失败 toast 明细
- [ ] 区块挂载进数据中心页面导航/布局（找到既有区块注册点）
- [ ] 手动验证清单写入实施回填：改开关/频率/份数 → 立即备份 → 列表出现 → 恢复（confirm）→ 状态刷新；git 两区显示与实际一致（本工作区 isRepo=true 可对照 `git status`）
- [ ] `bun run lint` + `bun run build` 通过；更新 `docs/codebase-map/`（数据中心分域 + chat 分域的 FileHistoryPanel 条目如有遗漏一并补）

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
  1. 备份列表用行内展开（chevron 切换）而非 Dialog，与卡片式布局更契合；列表展开时每次重新拉取（恢复后自动刷新）
  2. git 两区不做工作区筛选，直接按全部已注册工作区聚合成行（用户仓库/影子安全网各一卡），git 缺失时两卡统一显示「未安装 git」（getGitCapability 判断）
  3. 「立即备份」按钮在分类禁用时禁用（title 提示先开开关）而非隐藏，保留可发现性；runBackup 显式点名本就不检查 enabled，双保险
  4. 前端 `types/settings.ts` 补了 backup 节类型镜像（BackupSettings/BackupCategorySetting 等，与主进程 settings-types 同形），否则 settings-store 的 AppSettings 读不到 backup 节
  5. 备份状态行 scope 可能是非注册工作区目录（如 personal），名称映射 nameById 回退显示 scope 原文
  6. tipc 响应窄化：`'error' in r && r.error` 组合条件会阻断 TS 窄化（error 为空串时 else 分支无法排除 error 成员），统一改为先 `'error' in r` 单独窄化再判空
- 改动文件清单：
  - `app/data-center/version-backup/backup-meta.ts`（新增）：分类元数据/默认配置、频率标签、tipc client 返回类型推导（BackupScopeStatus/BackupRunItem/BackupEntry/WorkspaceGitSummary）、字节与时间格式化
  - `app/data-center/version-backup/GitSummarySection.tsx`（新增）：用户仓库/影子安全网两卡，按工作区聚合只读展示 + 手动刷新
  - `app/data-center/version-backup/CategoryCard.tsx`（新增）：分类卡（Switch/频率 Select/保留份数 Input 失焦保存 + 每 scope 状态行/到期徽标/立即备份 + 备份列表展开/恢复）
  - `app/data-center/version-backup/VersionBackupPanel.tsx`（新增）：面板根（状态加载+30s 可见轮询、配置写回 settings-store、runBackup 单项/全量、openBackupDir、结果 toast 明细）
  - `app/data-center/page.tsx`：新增「版本与备份」tab 挂载
  - `types/settings.ts`：backup 节类型镜像
  - `docs/codebase-map/data-center.md` + `index.md`：版本与备份条目与关键词
- 自动验证：`bun run lint` 0 errors；`bun run build`（vite + tsc electron）通过；`npx tsc --noEmit -p tsconfig.json` 渲染层类型检查通过；step3 验证脚本重跑 28/28 PASS（路由契约回归）；真实数据只读探测确认状态行 scope 分布与 UI fallback 逻辑匹配

### 手动验证清单（需真人点击 Electron 界面逐项确认）
- [ ] 数据中心出现「版本与备份」tab，进入后 git 两区按工作区显示分支/未提交数/快照统计（本工作区 isRepo=true，可对照 `git status` 输出核对分支与未提交数）
- [ ] 改某分类开关 → 设置持久化（重启后保留），调度器生效（切手动后「已到期」徽标消失）
- [ ] 改频率/保留份数 → 保存成功且状态行下次到期变化；保留份数输入非法值（0/负数/小数）失焦后归一为 ≥1 整数
- [ ] 点「立即备份」→ 按钮 loading → 完成 toast（文件名+体积）→ 状态行份数/最近时间刷新 → 展开列表出现新 zip
- [ ] sessions 分类立即备份 → 数秒阻塞期间按钮保持 loading，完成后正常刷新
- [ ] 禁用分类后「立即备份」按钮置灰且 title 提示
- [ ] 「全部备份」→ 跳过禁用分类，完成 toast 汇总成功/无内容项数
- [ ] 列表行「恢复」→ showConfirm 弹窗（含预备份提示）→ 确认后 toast 显示预备份文件名 → 列表刷新出现预备份、状态刷新
- [ ] 「打开备份目录」→ 系统文件管理器打开 backups 根目录（依赖 shell，脚本无法覆盖）

### 给下一步的接力棒
- 关键签名 / 数据结构：前端消费 tipc 类型全部用 `Extract<Awaited<ReturnType<typeof client.xxx>>, { 成员: unknown }>` 从 Router 推导（backup-meta.ts），主进程路由改动自动反映，无需手动镜像（settings backup 节除外，已在 types/settings.ts 镜像）
- 下个 step 该从哪里继续：plan.md 五个 step 已全部落地；后续可选方向见设计文档「未决问题」（影子历史全局浏览入口、单文件恢复、sessions 压缩等级调优）
- 待办或已知限制：
  - restoreBackup 预备份 keep 固定 10（step3 遗留，服务层签名未透传用户 keep）
  - sessions 备份同步打包阻塞主进程数秒，UI 已用 loading 缓解但未改服务层异步化
  - 手动验证清单待真人确认（尤其 openBackupDir 的 shell 行为）
  - 全部备份失败 toast 的 description 多项错误用 \n 拼接，sonner 单行渲染时多项错误可读性一般
