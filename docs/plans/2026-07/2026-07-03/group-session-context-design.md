# 组会话上下文互通设计

## 背景

Phase 3 完成后组只是"UI 层的归类容器"，同组会话之间上下文完全隔离：
- 组内新建会话不知道组的背景，即使该组已有组卡
- 从一个正在进行的会话岔出新方向时，需要用户手动简述或引用旧会话
- 现有组卡只服务于「聊聊首页」和智能分类，从未喂回新会话

同时，跨会话读原文的机制散乱：组提炼有 CleanTranscript、首页复盘有 TraceSource，"引用某个历史会话"这个通用诉求既没有工具也没有统一 API。

## 目标

1. 组内新会话能低成本拿到组背景（组主题、进展、共识、未决），且**不主动注入**，agent 按需查询
2. 提供通用的「引用某个历史会话」能力，agent 拿到的是去噪后的清洗版本
3. 主 agent 上下文永远干净——所有"读会话原文 + 清洗 + 分析"的脏活由子会话消化后回摘要
4. 所有跨会话读原文的能力共享一个底层纯函数，砍掉散乱的 `_cleaned/` 留盘产物

## 架构

### 核心哲学：主会话极简 + 子会话消化

- 主 agent 只装 `DelegateTo` + `SubmitDelivery`（复用现有 delegation 基础设施）
- 所有"读组卡/兄弟会话/引用会话"的动作都通过派子会话完成
- 子会话跑完 SubmitDelivery 回精炼摘要，主 agent 只吃摘要

### 三个新产物

**a) `background.md`** — 组的结构化背景（新增）
- 位置：`<configDir>/workspaces/<wsId>/groups/<groupId>/background.md`
- 内容：YAML frontmatter + 4 个结构化字段
  ```yaml
  ---
  groupId: xxx
  updatedAt: 2026-07-03T14:00:00Z
  sourcesSeen: [...]  # 复用组卡字段
  ---
  topic: |         # 组的核心主题，一句话
  progress: |      # 目前进展，2-3 句
  keyDecisions:    # 已拍板不该重议的决策
    - ...
  openQuestions:  # 未决/搁置
    - ...
  ```
- 生成时机：**复用 GROUP_DIGEST_SESSION**，同一次任务里 agent 依次 `SaveGroupDigest` + `SaveGroupBackground`，零新增 worker、零额外触发链路

**b) 底层纯函数 `readCleanTranscript`**（新增）
- 位置：`electron/main/services/memory/transcript-cleaner.ts` 新增导出
- 签名：`readCleanTranscript(sessionId: string, options?: { tail?: number; range?: [number, number]; uuid?: string }): string`
- 一处实现，多处消费（下面 4 个上层工具都调它）

**c) 通用工具 `ReadReferenceSession`**（新增）
- 装在**子会话**工具集里（不给主 agent）
- 参数：`{ sessionId, options? }`
- 返回：去噪后的会话原文
- 是 `readCleanTranscript` 的第 4 个消费者（跟 CleanTranscript / TraceSource 并列）

### 架构清理：组卡合并进组自己的目录

当前：
- 组卡：`<configDir>/workspaces/<wsId>/digests/<groupId>.md`
- 组共享区：`<configDir>/workspaces/<wsId>/groups/<groupId>/shared/`

改成（新旧统一）：
- `<configDir>/workspaces/<wsId>/groups/<groupId>/digest.md`
- `<configDir>/workspaces/<wsId>/groups/<groupId>/background.md`（新增）
- `<configDir>/workspaces/<wsId>/groups/<groupId>/shared/`

一次数据迁移（`migration-p4.ts`），digest-store 路径改。旧 `_cleaned/` 目录彻底删除。

### 排除的选项及原因

- **主动注入组卡到 systemPrompt**：对不相关的新会话就是纯浪费 token；用户想岔到新方向时组背景反而是噪声
- **后台 worker 持续生成 live 摘要**：新增后台任务，用户明确说"感觉浪费资源"
- **主 agent 自己装 ReadReferenceSession 直接读原文**：会污染主上下文；用户明确要求"主会话只拿后面的内容"
- **父子都装 ReadSessionTail**：agent 会图省事总是直接读，分层设计名存实亡
- **子会话深挖只覆盖"活兄弟"，已关兄弟走组卡**：模型不一致，agent 要判断该走哪条；统一"全部走子会话消化"更简单
- **前端加"引用对话" chip UI**：当前小规模场景 agent 用 ListSiblingSessions + 关键词匹配足够精准，chip UI 是"agent 搜不准"的兜底，第一版不需要

## 模块边界

### 新增文件

- `electron/main/services/memory/background-store.ts` — background.md 读写（对称于 group-digest-store.ts）
- `electron/main/services/memory/migration-p4.ts` — 目录迁移 + `_cleaned/` 清理
- `electron/main/agents/tools/reference-tools.ts` — 子会话工具集：`ReadReferenceSession` / `ReadGroupBackground` / `ListSiblingSessions`
- `electron/main/tipc/background.ts` — background.md 相关 IPC（读取给设置页展示等）

### 修改文件

- `electron/main/services/memory/transcript-cleaner.ts` — 新增 `readCleanTranscript(sessionId, options?)` 纯函数导出；删除带副作用的 `cleanTranscript` 和 `_cleaned/` 落盘逻辑
- `electron/main/services/memory/group-digest-store.ts` — 路径改为 `groups/<groupId>/digest.md`
- `electron/main/services/memory/group-digest-prompt.ts` — 提示词增加"同时产出 background.md"的指令
- `electron/main/agents/tools/group-digest-tools.ts` — 新增 `SaveGroupBackground` 工具，供 GROUP_DIGEST_SESSION agent 一次任务内产出两个产物
- `electron/main/agents/tools/digest-tools.ts` — `CleanTranscript` 内部改用 `readCleanTranscript`
- `electron/main/agents/tools/review-tools.ts` — `TraceSource` 内部改用 `readCleanTranscript`
- `electron/main/agents/query-based-session.ts` — 会话创建时按"组内非首个"判定动态注入 systemPrompt append
- `electron/main/tipc/conversations.ts` — 创建会话时把当前 conversation 所属 group 的 `groupName` + `isFirstInGroup` 传给 QueryBasedSession
- `electron/main/services/conversation-service.ts` — 提供"某 group 是否有其他 conversation"的查询

### 不动的部分

- `delegation-tools.ts`（DelegateTo / SubmitDelivery 已完整支持子会话链路）
- 组提炼的触发链路（脏检查/夜间/关会话）
- 前端 UI（第一版无 UI 变更）
- CLAUDE.md / reference-store（不承载会话引用）

## 数据流

### 主会话侧调用链

```
用户："继续昨天那个 stock 分析"
  ↓
主 agent 看到 systemPrompt append 提示
  ↓
DelegateTo("梳理组「stock 分析」的背景 + 兄弟会话最新进展")
  ↓
[主上下文成本：一次工具调用 + 一次 SubmitDelivery 摘要]
  ↓
主 agent 拿到摘要，开始工作
```

### 子会话侧完整流程

```
子 agent 用指定模型（可 haiku）跑：
  ReadGroupBackground(groupId) → { topic, progress, keyDecisions, openQuestions }
    ↓ 判断相关
  ReadGroupDigest(groupId) → 完整卡
    ↓
  ListSiblingSessions(groupId) → [{sessionId, title, lastActivity, isActive}, ...]
    ↓ 发现 isActive 兄弟
  ReadReferenceSession(siblingSessionId, { tail: 20 }) → 去噪后最近对话
    ↓
  消化分析
    ↓
  SubmitDelivery("组主题是 X，已定 A/B，未决 C，兄弟昨天聊到 D，你可以从 E 接")
```

### background.md 生成流程

```
GROUP_DIGEST_SESSION 任务被触发（脏检查/关会话/夜间 03:00）
  ↓
agent-worker.handleGroupDigestSessionTask 起 agent
  ↓
agent 读会话（CleanTranscript）→ 分析
  ↓
agent 顺序调用：
  SaveGroupDigest({ groupId, digest内容 })     ← 沉淀详细组卡
  SaveGroupBackground({ groupId, structured 4字段 })  ← 沉淀简短背景
  ↓
两个文件同时更新，updatedAt 一致
```

### readCleanTranscript 消费拓扑

```
                    ┌── CleanTranscript (组提炼 agent 专用)
                    │
readCleanTranscript ├── TraceSource (首页复盘 agent 专用)
   (纯函数)         │
                    ├── ReadReferenceSession (所有会话的子会话专用)
                    │
                    └── [未来扩展]
```

## systemPrompt append 内容

### A. 通用引用会话提示（所有会话 append）

```
【引用历史会话】
如需引用某个具体历史会话的内容作为参考，用 DelegateTo 派子会话去消化并交回摘要。
子会话会读去噪后的原文、分析、只回给你精炼版本。不要自己读会话原文——会污染你的上下文。
```

### B. 组背景提示（组内非首个会话追加）

```
【当前会话组】
你处在会话组「{groupName}」内，该组已有其他兄弟会话。
需要了解组之前的进展、结论、待办、或某个兄弟会话最近动向时，用 DelegateTo 派子会话去梳理。
子会话有 ReadGroupBackground / ListSiblingSessions / ReadGroupDigest / ReadReferenceSession 等专用工具，
会返回一份摘要给你。别自己去看。
```

### 注入判定

| 会话类型 | append 内容 |
|---|---|
| 非组内 | 只 A |
| 组内首个（当前 group 里只有它自己） | 只 A |
| 组内非首个 | A + B |

**注入时机**：会话创建时写入 conversation 的 systemPrompt append 字段（follow 现有 preset+append 模式），不是运行时动态拼接。

**`{groupName}` 是动态值**：会导致不同组的 append 前缀不同、prompt cache 命中率略低；但组内会话之间共享同一段前缀，且组名对 agent 判断"我该不该 DelegateTo"很重要——权衡后值得。

## 错误处理 / 边界情况

- **子会话读会话失败**（sessionId 无效 / 文件不存在）：`readCleanTranscript` 返回空字符串 + 明确错误信息，子会话 SubmitDelivery 时如实回报"未找到该会话"给主 agent
- **background.md 尚未生成**（组只有 1 个会话，还没触发过组提炼）：`ReadGroupBackground` 返回 null / 明确"组背景尚未生成"，子会话可以只依靠 ListSiblingSessions + ReadReferenceSession 现场汇总
- **组卡与 background.md 不同步**（极端情况下两个写入之间 crash）：以 updatedAt 较早那个为准，下一次 GROUP_DIGEST_SESSION 会重新生成两个
- **迁移失败**（`digests/<groupId>.md` → `groups/<groupId>/digest.md`）：migration-p4.ts 幂等，失败留原文件不删，下次启动继续尝试；参考 migration-p3.ts 的做法
- **子会话跑得很慢**（用户等不及）：现有 delegation 已支持 cancel / timeout，复用即可
- **组内非首个判定的时序**：会话创建那一刻查 group.conversations 数量；如果创建过程中并发新建另一个会话有微秒级偏差，无所谓——判错也就是多/少 append 一段，不影响功能

## 数据迁移影响范围

**迁移动作**：
1. `<configDir>/workspaces/<wsId>/digests/<groupId>.md` → `<configDir>/workspaces/<wsId>/groups/<groupId>/digest.md`
2. `<configDir>/workspaces/<wsId>/digests/_cleaned/` → **删除**（用户已确认砍留盘）
3. `<configDir>/workspaces/<wsId>/digests/_archive/` → 保留原地（Phase 3 迁移前的旧组卡备份，不动）
4. 迁移完成后如果 `digests/` 目录空了 → 删除；如果还有 `_archive/` → 保留 `digests/` 目录

### 需要同步改路径的模块（读写组卡的所有点）

**Service 层**：
- `group-digest-store.ts` — 所有 readGroupDigest / saveGroupDigest / listGroupDigests / deleteGroupDigest 路径改
- `group-digest-scanner.ts` — isGroupDirty 里比对的 digest 文件路径改
- `group-digest-trigger.ts` — 传给 agent 的 groupDigestPath 参数、活动状态里的 path、`digest-activity.json` 里已存的 recent 路径需要迁移或直接清空重来
- `review-scanner.ts` — 首页报告脏检查依赖组卡 updatedAt，走新路径
- `category-trigger.ts` — chainCategorize 传给 CATEGORIZE_SESSION 的 groupDigestPath 参数

**Tool 层**（agent 用的 MCP 工具）：
- `group-digest-tools.ts` — ReadGroupDigest / SaveGroupDigest 落盘路径
- `review-tools.ts` — ListDigests / ReadDigest 走新路径
- `category-tools.ts` — ListCategories 里返回的样例组标题需要能读到新路径

**IPC 层**：
- `tipc/digest.ts` — listGroupDigests / readGroupDigest / triggerGroupDigest / getGroupDigestActivity 全部依赖新路径

**前端**（通过 IPC 间接依赖，只要后端改对不用动代码）：
- `app/settings/memory/DigestsPanel.tsx` — 列组卡 + 详情视图
- `app/settings/memory/SmartCategoryPanel.tsx` — 归档过滤和分类计数不直接读文件，不影响

### 不受影响的模块

- `dashboard-watcher.ts` — 监听 dashboard.md，路径未变
- `smart-category-store.ts` — 读 smart-categories.json，不直接读组卡文件
- `group-shared-service.ts` — 组共享区路径本来就是 `groups/<groupId>/shared/`，不变
- `notes-store.ts` — 读 `_notes/` 子目录，位置不变
- 组提炼提示词模板（group-digest-prompt.md）等全局配置，位置不变

### 迁移执行要点（写在 migration-p4.ts 里）

- **幂等**：检测新路径 `groups/<groupId>/digest.md` 存在即跳过；旧路径不存在也跳过
- **原子性**：先 copy 到新路径，成功后再删旧路径（不用 rename 避免跨挂载点问题）
- **顺序**：必须在 app.whenReady 里、在 group-digest-trigger 启动扫脏之前跑完，否则并发写会撞车
- **锁**：迁移期间给 group-digest-trigger 一个 startup gate，migration 完成才放行
- **旧 `digest-activity.json` 里的 recent path**：可选清空（简单）或路径重写（复杂）；建议清空，反正只是最近活动展示
- **失败处理**：单个组卡迁移失败留原地、日志报错、继续下一个；不整体回滚——旧路径的组卡代码在迁移未完成前仍能读（灰度切换靠代码路径判断）
- **迁移前后自检**：迁移后跑一遍 `listGroupDigests`，数量应等于迁移前 + 之前就在新路径的
- **打包分发时的用户历史数据**：老用户升级时会实际跑迁移，测试要覆盖"有 N 个旧组卡"的场景

### 潜在踩雷点

- **`group-digest-trigger.ts` 里的 `in-flight` 去重是按 groupId 做的**，迁移不影响这个键；但 `recent` 环形里存了 path 字段，需要注意
- **智能分类的 `groupDigestPath` 参数**：CATEGORIZE_SESSION 任务 payload 里带这个路径，迁移期间的任务如果传的还是旧路径，agent 读文件会失败——所以 startup gate 必须先于 category-trigger 启动
- **测试盲区**：项目不写单测，全靠 build + lint + 手测；迁移这种一次性动作 build 过不了任何东西，必须**手测**——建议实施时手工造几个旧格式组卡验证
- **回滚不可行**：一旦迁移跑完并删了旧文件，回退代码到旧路径逻辑就读不到组卡了。所以实施时如果想稳，可以先只做"双写不删"版本发一个中间态，观察一版后再删旧路径清理逻辑；但按项目"不做兼容层"原则，也可以直接 one-shot 迁移

## 未决问题

留给实施阶段：

1. **子会话的默认模型**：走 `settings.subAgent.modelSelection` 还是新增独立配置项？倾向直接复用 subAgent，用户可以在设置里选 haiku 省钱
2. **background.md 的 SaveGroupBackground 工具签名**：是否需要在 frontmatter 记录 `derivedFrom: digestVersion` 之类的溯源字段？倾向不加（updatedAt 一致就够了）
3. **ListSiblingSessions 是否要过滤掉当前会话本身**：应该过滤，实施时确认
4. **迁移时机**：跟随 app.whenReady 里的迁移串，前面已有 migration-p3
5. **`isActive` 判定阈值**：兄弟会话"多久内活跃"算 active？倾向读 SDK JSONL 的 mtime，5 分钟内为 active
6. **DelegateTo 的子会话是否需要独立的 systemPrompt**：可能需要新增一个"你是组背景梳理助手"的 preset，避免子会话也 append 组背景提示导致递归
