# 执行历史侧边面板 + 子会话 Profile 开关 设计

## 背景

1. **导航 bug**：设置页是不参与路由的全屏 overlay，执行历史是独立 hash 路由 `#/run-history`。从设置页跳历史（`closeSettings()` + `hash='#/run-history'`）后，历史页「返回设置」只调 `openSettings()` 不回改 hash，导致关闭设置 overlay 后底层仍停在 run-history 页面——用户"又回到历史记录里去"。
2. **体验改进**：历史记录独立成页过重，改为设置页内右侧滑出面板。
3. **子会话 Profile 开关**：用户自建的 SubAgentProfile 需要启用/停用开关，停用后 agent 侧不可见、不可派遣；默认 Profile 恒可用，不给开关。

## 目标

- 执行历史以右侧 Sheet 呈现，删除独立路由，导航 bug 根治
- 非默认 SubAgentProfile 支持 `enabled` 开关：停用后系统提示词索引不列出、CreateSession 指定它时报错

## 架构

### 任务 1：执行历史侧边 Sheet

- 新建 `app/settings/scheduler/HistorySheet.tsx`：shadcn Sheet（右侧滑出，宽约 `sm:max-w-2xl`），内容为现 `app/run-history/page.tsx` 主体——计划/状态筛选下拉、「正在运行」小节、`HistoryEntryCard` 列表、「加载更多」cursor 分页、60s 显示 tick
- `app/run-history/HistoryEntryCard.tsx` 与 `app/run-history/utils.ts` 移动到 `app/settings/scheduler/` 下（HistorySheet 复用），更新 import
- 删除 `app/run-history/page.tsx` 与 `src/App.tsx` 中 `/run-history` 路由（`*` 兜底 Navigate to `/` 自然接管旧 hash）
- `SchedulerPanel.tsx`：「查看执行历史」按钮改为 `setHistoryOpen(true)`，删掉 `closeSettings + hash` 跳转；Sheet 打开时按需 `loadHistory()`
- **轮询**：SchedulerPanel 本身在挂载期间持续轮询 activity（10s），Sheet 打开时设置页必在挂载，Sheet 内不重复起轮询，只读 store
- 排除的选项：保留独立路由 + 修 hash 回退——用户已拍板侧边样式，保留双入口徒增维护面

### 任务 2：SubAgentProfile 开关

数据模型：`SubAgentProfile` 增加可选字段 `enabled?: boolean`（缺省 = 启用）；默认 Profile（id='default'）不设此字段、UI 不渲染开关、恒可用。

生效点（仅两处，resume 路径不动）：

1. **agent 可见性**：`session-append-templates.ts` 的 `buildSubAgentProfileIndex` 过滤 `p.enabled === false`（default 恒列出）——主会话系统提示词里的 Profile 表不再含停用项
2. **新派遣硬约束**：`delegation-bridge.ts` `startChild` 的 profile 解析：
   - `spec.profile` 命中但 `enabled === false` → throw `子会话 Profile「{name}」已停用`
   - 未指定时的回退链：default → 第一个启用的 → 兜底 `createDefaultSubAgentProfile()`（default 恒启用，兜底仅为防御）

不改动的路径：
- `conversation-runtime-service.ts:109` 子会话 resume 按 `contractMetadata.subAgentProfileId` 查找并回退 default——停用只挡新派遣，已派出会话照常运行
- `delegation-tools.ts` CreateSession 的 profile 参数为自由字符串，schema 不变，报错文案由 startChild 抛出
- `settings-service.ts` normalize：`enabled` 为可选未知字段，缺省视为启用，无迁移逻辑

## 模块边界

| 文件 | 改动 |
|------|------|
| `src/App.tsx` | 删 run-history 路由 |
| `app/run-history/*` | 删除目录（HistoryEntryCard/utils 迁至 scheduler/） |
| `app/settings/scheduler/HistorySheet.tsx` | 新建，历史面板主体 |
| `app/settings/scheduler/SchedulerPanel.tsx` | 按钮改开 Sheet |
| `app/settings/SubAgentTab.tsx` | 列表行加 Switch（非 default）；停用行置灰 +「已停用」徽标；编辑器 draft 同步 enabled |
| `types/settings.ts` | `SubAgentProfile.enabled?: boolean` |
| `electron/main/services/settings-types.ts` | 镜像同字段 |
| `electron/main/agents/session-append-templates.ts` | `buildSubAgentProfileIndex` 过滤停用项 |
| `electron/main/agents/delegation-bridge.ts` | `startChild` profile 解析拒绝停用项、回退链跳过停用项 |

## 数据流

- 历史面板：SchedulerPanel 挂载 → startActivityPolling（已有）→ 点「查看执行历史」→ Sheet open + `loadHistory(planFilter?)` → scheduler-store（`scheduler-store.ts` 的 history 分页逻辑零改动）
- Profile 开关：SubAgentTab Switch → settings dirty → 保存落 `settings.json` → 主会话**下次启动**时按新 settings 拼系统提示词（运行中会话不热更新，与现有行为一致）；startChild 每次派遣现读 settings（`loadSettings()`），立即生效

## 错误处理 / 边界情况

- 停用 profile 时存在运行中的同 profile 子会话：不中断、resume 不受影响，仅新派遣被拒
- CreateSession 传停用 profile 名：工具层返回 isError 文案「子会话 Profile「x」已停用」，agent 可改用其他 profile 或不指定
- 旧 hash `#/run-history` 残留（用户书签/重启恢复）：`*` 路由 Navigate to `/` 接管
- Sheet 内 planFilter 变更 → `loadHistory(planId)` 复用现有 IPC，无新后端

## 未决问题

无。
