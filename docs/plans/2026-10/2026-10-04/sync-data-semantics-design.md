# 设备同步数据语义分类与真空地带补齐 设计

日期：2026-10-04
状态：方案已拍板，待实施
来源：本组会话三轮讨论（任务真空 → 工作区数据盘点 → snapshot 事故 → 自动化边界 → 分类模型）

## 1. 背景

四个独立发现指向同一系统性问题——**应用数据缺一份「同步语义」分类**，机器亲和/通用偏好/敏感/可同步混在默认行为里，撞一个漏一个：

1. **任务真空**：计划栏任务存 `<ws>/.dogear/tasks.json`（工作区磁盘根，`task-store.ts` TASKS_FILE），被 gitignore（`.dogear/` 整目录在用户 git 排除列表）且在同步根（configDir）之外，LAN 同步与用户 git 双双不覆盖 → 两端任务永不同步。registry 有 `ws-tasks` 条目（备份用 `__ws-external__` 虚拟路径）但**无 syncItemId**；push-guard 测试明确拒绝 `__ws-external__` 前缀。
2. **文章库真空（比任务更彻底）**：文章实体库存 `<ws>/.dogear/articles/`（`article/crud.ts`，每篇文章一个 UUID 目录：meta.json + 原文），registry 无条目、5 个备份分类（BACKUP_CATEGORY_KEYS）不含、同步白名单无 → **备份与同步双盲，丢失即永久丢失**。与 configDir `article-parser/`（解析历史/skill 模板，已有 syncItemId，会同步）是两个东西，勿混淆。
3. **snapshot 机器亲和事故**：settings.snapshot 按本端 wsid 键控（excludedPaths/disabledWorkspaces）+ exclusionScanDone 本端扫描标记，两端各自演化 → 顶层字段级三方合并每轮双改保本端（sync-state baseline 里 snapshot 只有 Windows 端 wsid 键，Mac 端键从未并入，非深度合并）。机器亲和数据不该作为可传播字段。
4. **planPath 不可移植**：任务 planPath 存绝对路径（`C:\dogear\docs\plans\...`），跨设备后失效，任务详情全 planError。

另有用户需求：允许用户勾选工作区任意子树进同步（用户文件默认不动，走用户自己的 git/网盘）。

## 2. 核心决策（已拍板）

### 2.1 数据语义分类：按写入者裁决

| 写入者 | 默认 | 依据 |
|---|---|---|
| 应用写的工作区数据（tasks/articles/…） | **默认同步** | 应用代码知道自己写什么，registry 声明即全集，无需从文件特征/git 推断 |
| 用户自己的文件（代码/文档/杂物） | 默认不动，**可勾选** | 只有用户知道；git 区 UI 提示「走你自己的 git」 |
| 生成物/缓存（dist/node_modules/…） | 默认排除 | 启发式可识别；自动识别二期做 |

**否决「git 跟踪=同步 / gitignore=不同步」提案**：
- git 跟踪文件走 LAN 同步 = 双 VC 打架（git pull/checkout 每次都触发文件级同步噪音，互相污染工作树）
- gitignore 语义是「不上传公共仓库」≠「不跨设备」（tasks.json 恰是被 gitignore 却最需跨设备的反例）
- 无 git 工作区（mystock/test 类）提案失效，不通用
- 结论：git 只作 UI 展示分组信号，不作裁决依据

### 2.2 settings 字段治理：A 白名单传播制

只有登记为「通用偏好」的顶层字段跨设备；**其余（含未来新增未知字段）一律保本端**。

- 选 A 弃 B（黑名单制）理由：A 的失败模式温和（忘登记 → 该字段不同步 → 用户发现 → 补登记），B 的失败模式正是 snapshot 事故重演（忘登记 → 机器亲和数据双向污染，难发现）
- 传播白名单草案（实施时逐字段核对内容后定稿）：`ai`、`basicToolPermissions`、`subAgent`、`failover`、`update`、`appearance`、`browserSearchEngine`、`enabledToolPacks`、`webAiSites`、`paymentBlockedHosts`
- 保本端：`snapshot`（本期整字段保本端，retention/maxFileSizeBytes 暂不跨设备——通用偏好就几个数字，两端各设一次成本极低，子字段粒度合并 YAGNI）、`backup`、`ui`、`profiles`、`browserProxyServer`、`migrated`、`webMcpApiKey`（敏感）、`syncOptions`（维持现有 rev-LWW 特判不动）
- 实现落点：`mergeFieldsThreeWay` 改为仅对白名单字段做三方合并，非白名单字段直接取本端；settingsBaseline 语义不变（记录合并落盘结果）

### 2.3 工作区数据进协议：`__ws-external__` 虚拟路径

- 路径形式：`__ws-external__/{wsid}/.dogear/tasks.json`、`__ws-external__/{wsid}/.dogear/articles/**`（backup-service 已有同形式先例，`data-registry.ts` EXTERNAL_ANCHOR_PREFIX）
- wsid 映射：复用 workspace-map 的 per-peer 映射表（对端 wsid ↔ 本端 wsid）；对端清单里映射不到本端工作区的条目跳过（本端无此工作区）
- **对称放行四处**（排除引擎既有模式）：清单生成（buildManifest 收集注册工作区的虚拟路径条目）/ 拉取过滤（diff）/ 应用（applyIncoming 反解落盘到本端工作区真实路径）/ push guard（现为明确拒绝，改为白名单路径放行）
- 合并策略：
  - tasks.json：条目级合并 `mergeArrayFile(tasks, id)`（同构先例：plans.json 的 MERGE_PATTERNS 条目，结构同为 `{version, tasks[]}`）
  - articles：文件级 mtime 裁决 + 删除墓碑（每篇独立 UUID 目录天然无冲突、文章基本只读，不做条目合并）
- 协议版本 `SYNC_PROTOCOL_VERSION` +1；握手版本不匹配时过滤 `__ws-external__` 条目（防旧端把它当普通路径落到 configDir 下成垃圾目录）

### 2.4 planPath 相对化

- tasks.json 的 planPath 改存**工作区相对路径**（`docs/plans/...`），读时 join 本端工作区根（getTaskDetail 等读侧）
- 存量一次性迁移：读写前把绝对路径转相对（在任务文件 lock 内做，version 2 → 3）；不在工作区根下的异常历史路径保持绝对不动
- 写侧（CreateTask/申报等）一律落相对路径
- plan 文档可得性预期：dogear 工作区 Mac 端有 clone（用户确认）；无 git 工作区（mystock/test）的 plan 文档靠用户勾选同步补，或接受 planError 降级（已有该概念）

### 2.5 用户勾选同步

- 存储：settings.syncOptions 新增 `userSyncPaths`（per-workspace 相对路径列表），随 syncOptions 走 rev-LWW 跨设备（**两端必须一致**，否则每轮 diff 互相拉扯）；改它时 syncOptionsRev++
- 勾选子树走 2.3 同一虚拟路径机制（`__ws-external__/{wsid}/{用户相对路径}/**`）
- 合并策略：整文件 LWW + 冲突副本（用户文件无法条目合并；配对即信任，敏感文件靠用户不勾 + UI 提示）
- UI：同步范围面板新增工作区目录树勾选
- 二期（本期不做）：生成物自动识别（exclusionScan 推广到勾选界面，dist/node_modules 自动置灰）

### 2.6 UI：同步范围分组展示（sync-settings.tsx）

分组：应用数据（默认✔，含新增「任务」「文章库」两项）/ 用户文件（勾选树）/ 生成物（置灰，二期自动识别）/ git 区（有 git 工作区时展示提示「走你自己的 git」，不可勾）。

## 3. 模块边界

| 文件 | 改动 |
|---|---|
| `electron/main/services/data-registry.ts` | ws-tasks 补 syncItemId；新增 ws-articles 条目（external: 'workspace-articles' 或泛化 external 机制） |
| `electron/main/services/sync/manifest.ts` | buildManifest 收集 `__ws-external__` 虚拟路径条目（registry + workspaces.json 注册表驱动） |
| `electron/main/services/sync/workspace-map.ts` | 映射扩展到虚拟路径条目（wsid 翻译，含用户勾选路径） |
| `electron/main/services/sync/apply.ts` | applyIncoming 虚拟路径反解落盘；settings 三方合并改白名单传播制；MERGE_PATTERNS 加 tasks.json 条目 |
| `electron/main/services/sync/push-guard.ts` | `__ws-external__` 白名单路径放行（仍拒未注册路径） |
| `electron/main/services/sync/protocol.ts` | SYNC_PROTOCOL_VERSION +1 |
| `electron/main/services/task-store.ts` | planPath 相对化（读写两侧 + version 2→3 迁移） |
| `electron/main/services/settings-types.ts` / `settings-service.ts` | syncOptions.userSyncPaths + 传播白名单清单常量 |
| `electron/main/services/sync/orchestrator.ts` | 虚拟路径条目的拉取/推送流（remoteRelPath 折算已有机制复用） |
| `app/data-center/sync-settings.tsx` | 分组 UI + 目录树勾选 |
| 相关测试 | exclude/push-guard/apply/settings-merge/task-store 各对应新增用例 |

## 4. 数据流（tasks.json 为例）

```
Win 端写任务 → C:\dogear\.dogear\tasks.json（相对 planPath）
  ↓ buildManifest：registry(workspaces.json) 驱动 → 清单加 __ws-external__/{winWsid}/.dogear/tasks.json
  ↓ diff（对端清单 wsid 经 workspace-map 翻译成虚拟路径比对）
  ↓ 拉取 → applyIncoming：__ws-external__/{wsid}/ → 经映射表得本端 wsid → workspaces.json 反解真实路径 → 条目合并落盘
Mac 端任务面板 → task-store 读 <mac 工作区根>/.dogear/tasks.json → planPath 相对 → join 本端根 → 读到 plan
```

## 5. 错误处理 / 边界

- 对端清单含本端未注册/已注销工作区的虚拟路径 → 跳过 + 警告（同 backup 的 resolveArchiveRelPath null 语义）
- 映射表无此对端 wsid → 跳过（本端没配对映射这个工作区）
- 版本不匹配握手 → 过滤虚拟路径条目（防旧端垃圾落盘）；旧端推来的虚拟路径被新端 guard 白名单校验拒绝
- tasks 合并任一侧 JSON 结构异常 → mergeFailed 进待处理冲突（现有降级路径）
- planPath 相对化迁移失败（不在工作区根下）→ 保持绝对路径，功能不回归
- articles 首次同步体积：工作区文章多时首轮传输量大（提示用户，非阻塞）
- 用户勾选了巨型目录（如 node_modules）→ 一期无自动识别，UI 靠展示目录大小提醒

## 6. 未决问题

- settings 18 顶层字段最终分类表：实施 step 内逐字段核对内容后定稿（草案见 §2.2）
- userSyncPaths 的 UI 目录树加载性能（大工作区）：实施时按需做懒加载
