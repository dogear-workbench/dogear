---
step: 3.5
title: 组卡引用保真度校验
status: done
---

## 目标

`SaveGroupDigest` 落盘前校验 `items[].sources` 里每个 `sessionId#uuid` 是否真实存在于对应会话的逐字稿，不存在就拒绝保存并精确回告 agent 哪几条错、错在哪。

这是**插入步**，不属于原 pi 迁移计划。起因见 step3 回填：真实提炼产出的组卡 `group_a2153547` 有 40 条引用，9 条 uuid 全库不存在（编造）、2 条张冠李戴。触碰项目「AI 提炼要保真」硬约定，且 step4 的 review 链路会把编造引用沉淀进记忆，污染面更大，所以先堵这个口再往下切。

## 依赖上下文

**为什么用代码校验而不是改提示词**：uuid 是否存在是**确定性事实**，一次文件读取就能判定，不该靠模型自觉。符合项目「价值判断交给 agent，代码只做确定性低成本 IO」的分工。提示词改了也只是降低概率，不能保证。

**校验口径必须与 agent 所见一致**：agent 看到的 uuid 来自 `CleanTranscript`，而 `cleanMessagesFromLines`（`transcript-cleaner.ts:42`）会过滤掉 `isSidechain` / `isMeta` / 内容为空的行。所以校验要复用**同一个函数**产出的 uuid 集合，不能用「JSONL 全量 uuid」——后者会放过「引用了一条 agent 根本看不到的消息」这种情况，那同样是编造。

**现成的钩子**：`createGroupDigestToolDefs(workspaceId, workspacePath, groupId, dirtyConversations, ...)` 的 `workspacePath` 参数目前**接了但没用**（`group-digest-tools.ts:42`），正好是读逐字稿要的东西，不用改签名。

**张冠李戴要能自动纠正**：step3 实测的 `e298fe44` 属于 `dde7f8c1` 却被记到 `4f3e41bc` 名下。这种情况校验器应该在错误信息里**直接给出正确的 sessionId**，agent 改一个字段就对了，比让它重新查证便宜得多。查找范围限定在本次 `items` 引用到的会话集合内，不扫全库。

## 计划改动

### 1. 新建 `electron/main/services/memory/source-fidelity.ts`

```ts
/** sessionId → 该会话去噪后所有消息的 uuid 集合 */
export async function buildSessionUuidIndex(
  workspacePath: string,
  sessionIds: string[],
): Promise<Map<string, Set<string>>>;

export interface SourceProblem {
  itemIndex: number;
  itemText: string;        // 截断到 40 字，够 agent 定位是哪条
  sessionId: string;
  uuid: string;
  kind: 'session_missing' | 'uuid_not_found' | 'wrong_session';
  correctSessionId?: string;  // kind='wrong_session' 时给出
}

/** 纯函数：拿索引校验 items，返回所有问题 */
export function validateItemSources(
  index: Map<string, Set<string>>,
  items: Array<{ text: string; sources: Array<{ sessionId: string; uuid: string }> }>,
): SourceProblem[];
```

- [x] `buildSessionUuidIndex`：对每个 sessionId 读一次 JSONL（`getSessionJsonlPath`）→ `cleanMessagesFromLines` → 收 uuid 进 Set。**每个会话只读一次**（items 里同一会话会被引用几十次，不能每条都读）。文件不存在时该 sessionId 映射到空 Set，由 `validateItemSources` 报 `session_missing`
- [x] `validateItemSources`：逐条查。uuid 不在本会话集合里时，**再到索引内其它会话找一遍**——找到就报 `wrong_session` 并带上 `correctSessionId`，找不到才报 `uuid_not_found`
- [x] 纯函数与 IO 分离（同 `transcript-cleaner.ts` 的既有风格），但按项目约定**不写单测**

### 2. 改 `group-digest-tools.ts` 的 `SaveGroupDigest` handler

- [x] 在 `args.groupId` 校验之后、`readGroupDigest` 之前插入校验段
- [x] 收集 `args.items` 里所有不重复的 sessionId → `buildSessionUuidIndex` → `validateItemSources`
- [x] 有问题时 `return { isError: true }`，**不落盘**、不调 `onDigestSaved`。错误文案要包含三块：
  1. 逐条列出问题（item 序号 + 文本片段 + 无效的 `sessionId#uuid` + 问题类型）
  2. `wrong_session` 的直接给出正确 sessionId，提示改这一个字段即可
  3. 修复指引：「请调 CleanTranscript 重新查证该会话的真实 uuid；若确实查不到对应消息，删掉这条 source；某条 item 的 sources 全部无效时删掉整条 item」
- [x] 无问题时走原有逻辑，一行不改
- [x] `items` 为空数组时跳过校验（不报错）

### 3. 提示词兜底

- [x] `group-digest-prompt.ts` 的 `DEFAULT_GROUP_DIGEST_PROMPT` 里补一句：sources 的 uuid 必须逐字复制 `CleanTranscript` 输出里 `## [role · ts · uuid]` 的 uuid，不得凭记忆重构。**注意**：该模板首次缺失时才播种到 `<configDir>/group-digest-prompt.md`，用户已有的那份不会被覆盖——所以改代码里的默认值只对新环境生效，本机要手动同步一次（主会话做）

## 验收

- [x] `bun run build:electron` + `bun run lint` 通过
- [x] 对 `group_a2153547`（已知有 9 条编造 + 2 条张冠李戴）触发重新提炼，观察：校验是否拦下、agent 收到错误后是否修正、最终落盘的组卡保真度是否 100%
- [x] 用 step3 回填里的 uuid 索引脚本复测，确认新组卡 0 编造 0 张冠李戴
- [x] 确认拦截不会导致死循环：agent 修不好时应在 `maxTurns=30` 内收敛，组卡宁可不存也不存错的
- [x] 主会话链路不受影响（`createGroupDigestTools` 走 `toSdkServer`，签名未变）

## 已知风险

- **可能拦下历史遗留的坏引用**：增量更新时 agent 会从 `ReadGroupDigest` 沿用旧条目，其中的坏引用这次会一并被拦。这是预期行为（脏数据本就该清），但会让第一次重新提炼多跑几轮。若观察到反复失败，考虑只校验本轮 `dirtyConversations` 涉及的会话——**先不做**，等实测。
- **校验口径过严的可能**：如果 agent 引用的是 `CleanTranscript` 里确实存在、但被我复用的 `cleanMessagesFromLines` 过滤掉的消息，会误报。两边同源同函数，理论上不会，但实测时留意 `uuid_not_found` 里有没有看起来合理的。

## 实施回填（做完后填）

### 实际改动

**改动文件清单**

| 文件 | 性质 |
|---|---|
| `electron/main/services/memory/source-fidelity.ts` | 新建，78 行（`buildSessionUuidIndex` + `validateItemSources`） |
| `electron/main/agents/tools/group-digest-tools.ts` | +31 行：`formatFidelityError` 文案组装 + `SaveGroupDigest` handler 里的 8 行校验段 |
| `electron/main/services/memory/group-digest-prompt.ts` | 改 1 行默认文案 |
| `<configDir>/group-digest-prompt.md` ×2 | 主会话手工同步（AppData 打包版 + 项目根开发版），已播种的不会被代码覆盖 |

**与计划的唯一差异**：`buildSessionUuidIndex` 返回 `Map<string, Set<string> | null>` 而非 `Map<string, Set<string>>`。空 Set 无法区分「文件缺失」和「文件存在但去噪后无消息」，用 `null` 才能让 `session_missing` 报得准。

`bun run build:electron` 0 error；`bun run lint` 0 error / 83 warning，与改动前逐字一致，无新增。

**实测中补的一处计划外改动**（`group-digest-scanner.ts` + `group-digest-trigger.ts`，+18/-9）：设置页的「重新提炼」按钮原先也要过脏检查，组不脏就静默跳过，导致本步根本没法复测。给 `findDirtyGroup` 加 `force` 参数——`triggerByGroup` 传 `true`，跳过脏判定并把 `dirtyConversations` 换成**全量 main 会话**（手动重跑的语义是「明知不脏也要整组重看一遍」，只给增量会话会让 agent 看不到要修的旧引用）。自动扫脏 / 关会话触发两条路径不传该参数，行为不变。

### 拦截效果实测

对 `group_a2153547` 手动触发重新提炼（GLM sonnet，60.8s，`outcome: saved`），用全库 uuid 索引（19695 uuid / 166 会话 JSONL）复测：

| | step3 旧组卡 | 本次新组卡 |
|---|---|---|
| 引用总数 | 40 | 33 |
| 正确 | 29 | **33** |
| 张冠李戴 | 2 | 0 |
| 编造 | 9 | 0 |
| 保真 | 73% | **100%** |

**100% 不是靠删引用换来的。** 按会话拆开看，出问题的两个旧会话 `dde7f8c1` + `4f3e41bc` 引用数 14 → 13（只少 1 条），正确数却从 7 涨到 13——agent 收到错误后回去重新查证补对了 uuid，而非走「查不到就删掉」的兜底路径。这同时证伪了「已知风险 2：校验口径过严导致误报」——若误报，会表现为这两个会话的引用被成批删空。

- 触发重提炼后校验命中几条：**无法直接观测**。logger 只落盘 WARN/ERROR，工具返回的 `isError` 不写日志。上面是从「正确引用数不降反升」反推的。要直接观测，需在 `run-once.ts` 里把工具 error 打成 WARN——**step4 顺手加**，review 链路的引用面更大，届时需要可观测性
- agent 是否自行修正：**是**，且 13/13 全对
- 最终组卡保真度：**100%（33/33）**

**连带验收掉的 step3 遗留项**（原记在「搁置」里）：
- 停止按钮（`agent.abort` 路径）：15:52 那次 `outcome: error / "已取消" / 9.9s`，正常中断
- 不死循环：60.8s 收敛，未触及 `maxTurns=30`
- `SaveGroupBackground` 同步落盘，`chainCategorize` 正常触发（`decision: match`，走阈值匹配 0 LLM，未上 LLM 分支）
