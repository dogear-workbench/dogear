# Step 3: tipc 路由与设置 UI

## 目标

setSyncOptions 接受新字段；数据中心「设备同步」设置面板新增「同步范围」分组与两个专项开关（带说明提示）。依赖 Step 2 的字段与 SYNC_ITEM_IDS。

## 改动

### 1. `electron/main/tipc/sync.ts`

- `setSyncOptions` 的 zod schema 扩展：`disabledSyncItems`（string[]，enum 校验到 SYNC_ITEM_IDS）、`syncConflictCopies` / `syncShadowGit`（boolean）、`syncOptionsRev`（number，可选——rev 由主进程维护，不接受前端直写）。
- 确认 getSyncOptions（或设置读取路由）把新字段带出到渲染层。

### 2. `src/.../data-center/sync-settings.tsx`

- 新增「同步范围」分组：
  - 12 项开关（目录 7 + 文件 3 + stocks/feishu 2）；stocks/feishu 从现有独立开关位置迁入此列表（底层键不变，仅呈现统一）；每项配简短说明（如 plans.json=任务数据、article-parser=文章库解析记录、site-knowledge=站点知识）。
  - `settings.json` 置灰 + 标「必选」徽标，tooltip：「同步配对与范围配置本身，关闭会导致设置无法跨设备统一」。
  - 关闭 `workspaces` 时二次确认（影响面大：全部工作区会话/笔记/记忆不跨设备）。
- 两个专项开关（分组外或分组尾部独立小区块）：
  - 「同步影子快照仓库（shadow-git）」默认关。说明：「影子快照是本机文件历史的 git 安全网，默认不跨设备；开启后快照历史将跨设备共享，但两端并发快照时可能产生 git 内部文件冲突甚至损坏，建议保持关闭」。
  - 「同步冲突留底副本（.conflict-*）」默认关。说明：「同步冲突时自动保留的败方完整内容副本，默认仅留在产生冲突的设备上供手动换回，不跨设备传播」。
- 修改即调 setSyncOptions；保存后按钮态/成功反馈沿用现有动线。

### 3. 同步结果面板（`sync-result.tsx`，可选小改）

- 若本轮同步因 excludes 跳过拉取/应用条目，结果里以「已按范围设置跳过 N 项」提示（不逐条列，防噪音）。

## 验收

1. [x] UI 全部 12+2 开关可切换并持久化（代码级核对动线 + 真实代码链路脚本；未起 GUI 避免桌面弹窗干扰，可后续 `bun run dev` 人工复验）。
2. [x] settings.json 不可关（required → Switch 置灰恒开 + 必选徽标 tooltip）；关 workspaces 有确认弹窗。
3. [x] 说明文案完整显示（12 项 description 来自 SYNC_ITEM_IDS；两个专项开关文案与任务书逐字一致，含 shadow-git 风险提示）。
4. [x] 单机 dev 端到端（fallback：链路脚本 sanitize→applySyncOptionsPatch→excludesFromSyncOptions→buildManifest 11 断言全 PASS，关 article-parser 后清单无条目；拉取/应用侧对称过滤由 step1 单测覆盖）。
5. ⏳ 双机验收遗留：依赖 Mac 真机（A 端改开关 → 同步 → B 端 rev-LWW 收敛；两端新版本后 shadow-git 不再互传），与 lan-sync step5 同一约束，可合并执行，不阻塞代码合入。

## 实施记录（2026-09-29）

- 状态：✅ 完成（除双机项）。bun test 373 pass / 0 fail，双 tsc 与 eslint 通过。
- 实现方式：SYNC_ITEM_IDS 由渲染层直接 import settings-types.ts（纯文件无 electron/node 依赖，文件头自证 + Worker 线程导入先例），未新增 tipc 路由；setSyncOptions 加手动白名单防呆层（项目 tipc 无运行时校验的风格），syncOptionsRev 不接受前端直写；sync-result 范围跳过只汇总「已按范围设置跳过 N」不逐条列。
- 偏差备注：① stocks/feishu 的 description 原文自引「下方独立开关」迁列表后失真，已更新为原独立开关提示文案；② SCOPE_SKIP_REASONS 在渲染层复制了两处 reason 文案（manifest.ts / apply.ts 含 node 依赖不宜渲染层 import），已注释标注同步义务，后续可提纯共享模块；③ 防呆层错误类型字段静默丢弃（视为未提供），与现状风格一致。

## 收尾

- 三步完成后：勾选 plan.md 步骤索引；git commit（分层：step1 引擎 / step2 设置 / step3 UI 各一笔或合并一笔，message 注明「同步范围可配置化」）。
- 若双机验收因 Mac 不可用受阻，标注遗留（同 lan-sync step5 处理方式），不阻塞代码合入。
