# 子会话复用与交付闭环 设计

**日期**：2026-08-28
**状态**：设计已拍板，待写实施计划

## 背景

主会话派遣子会话后极少复用，需要深挖时总是另起新会话。调研确认这不是模型能力问题，而是产品把路封死了：

1. **提示词封路**：全库唯一「复用 vs 新建」引导只覆盖「stopped 未交付 → ResumeSession」（`session-append-templates.ts:32`）；ListLinkedSessions 工具描述明确写着「已交付 → 已完成，不要重派或调起」（`delegation-tools.ts:28`），把交付后复用的路口亲手关掉。
2. **机制半封路**：子会话交付并跑完当前轮后 session 释放，SendMessage 返回 `target_inactive` 且消息直接丢弃（`delegation-bridge.ts:803`）；重启后 ResumeSession 因内存 childStates 丢失而报错不可用（`delegation-tools.ts:410-455` 校验链）。
3. **验收空档**：调度系统全部兜底（超时/transient 重试/quota failover/终态通知）都在「能不能跑完」维度；`delivery=true` 是子会话单方面宣称，无任何验收环节，「送达」和「合格」被混为一个语义。
4. **强制留痕**：子会话契约模板写死「完整交付内容写到共享区 outputPath，SendMessage 只放摘要」（`session-append-templates.ts:63-65`），通讯型任务（问一个问题、快速验证）也被迫留文件。

## 目标

- 复用 vs 新建的**判断权归模型**：产品只负责把路修通（机制）+ 把判断依据写清（提示词），不做倾向性硬编码。
- 交付语义从「终态」变「阶段性交付」：验收不合格可向原子会话追问返工。
- 交付形态弹性化：文件交付与通讯交付并存，不强制留痕。

**非目标**：不改调度兜底（超时/重试/降级/终态通知——不涉及会话层，agent 不参与）；不做系统自动质量评分（验收是主会话模型的事）。

## 架构

三部分改动，可独立实施：

### A. 机制开路（delegation 层）

1. **SendMessage 自动调起已停机直派子会话**：目标 stopped（无论是否已交付）且为本会话直派子会话时，`deliverMessage` 不再返回 `target_inactive`，改为复用 `resumeChild` 通道重开同一 JSONL，并把 SendMessage 的消息内容直接作为唤醒消息。**不复用**现在「你因中断停止，请从中断处继续」的固定提示词（`delegation-resume.ts:51`）——追问语境下那是错误提示。
2. **重启后 ResumeSession 降级恢复**：内存 childStates 查不到时，降级用磁盘 `contractMetadata.parentSessionId` 判断直派关系，允许恢复（re-claim outputPath、重挂计时器等同现有 resumeChild 逻辑）。
3. **CreateSession outputPath 可选化**：`z.string().min(1)` → optional。不填 = 通讯型交付（答案在 SendMessage 正文）。delegation-bridge 的 outputPath claim/release 逻辑对空值兼容。

### B. 提示词层（判断框架与验收闭环）

1. **ListLinkedSessions 描述改中性**（`delegation-tools.ts:28`、`:90`）：删「已交付 → 不要重派或调起」，改「已交付；如需深挖可直接向它发消息（系统会自动调起）」。
2. **主会话协作规范新增「子会话复用判断」段**（`session-append-templates.ts` MAIN_AGENT_DELEGATION_APPEND）：
   - 追问深挖（调研结果展开、验证结论）→ 优先原子会话，它的上下文还在
   - 失败/超时 → 先向原子会话发消息查询情况，它对自己的进度最清楚；盲目重派会丢掉已积累的上下文
   - 新任务与原子会话上下文无关（如一次性实施已完成）→ 新派
   - 追问链已很长、上下文价值稀释（auto-compact 有损压缩累积损耗）→ 换新会话从共享区产出起步
3. **子会话契约模板弹性化**（`session-append-templates.ts` subAgentContractFor）：
   - 交付形态二选一：复杂产出写共享区文件 / 简单问答直接在交付消息正文，按任务性质判断
   - 交付自述义务：交付消息结构化声明——目标达成情况 / 未完成或跳过部分 / caveats / 交付物形态与位置（「共享区 xxx.md」或「本消息正文」）
4. **主会话验收步骤**：收到交付 ≠ 接受交付。读交付物、对照任务目标检查 → 三分支：接受 / SendMessage 向原子会话追问返工 / 重派。同步修改现有提示词里「交付以收到 delivery 消息为准」类把送达和合格划等号的措辞。

### C. Profile 配置调整（用户手动改 settings，不涉代码）

- 「探索」：description 补「交付默认在消息正文，复杂报告才写共享区」；article 开关按需（涉及文章库调研时开）。
- 「默认」：开 `reference` 能力（复用闭环中实施子会话被追问返工时需要拉组背景/兄弟会话原文）。
- 实施 Profile 模型档位是否从 GLM-5.3-Flash 提一档：用户自行权衡（返工成本 vs 模型差价）。

### 排除的选项

- **纯提示词方案**（只改引导不修机制）：机制封死时提示词是空头支票，模型照做后第一次 SendMessage 吃闭门羹，行为立刻退回另起炉灶。
- **delivery 时 outputPath 文件存在性硬校验**：通讯型交付正当，强制留痕是形式主义；「忘了写文件」由交付自述 + 主会话验收自然暴露（声明了文件却读不到 → 追问）。
- **系统自动验收/质量评分**：验收是模型判断，不是代码能处理的。
- **按任务内容预设 Profile 场景模板**：任务多样性无限，列表膨胀后选择困难从「怎么写 task」转移到「选哪个 Profile」，净收益为负。Profile 只固化「行为规范和交付形态」，不固化「任务内容」。

## 模块边界

| 文件 | 改动 |
|---|---|
| `electron/main/agents/delegation-bridge.ts` | deliverMessage 自动调起分支；resumeChild 支持自定义唤醒消息；outputPath 可选兼容；重启降级恢复入口 |
| `electron/main/agents/tools/delegation-tools.ts` | ListLinkedSessions 描述；ResumeSession 校验链（内存缺失 → 磁盘降级）；CreateSession schema outputPath 可选 |
| `electron/main/agents/session-append-templates.ts` | MAIN_AGENT_DELEGATION_APPEND 增复用判断段 + 验收步骤；subAgentContractFor 契约弹性化 + 交付自述义务 |
| `electron/main/agents/delegation-resume.ts` | 唤醒消息模板参数化（区分「中断续跑」与「追问唤醒」） |
| 用户 `settings.json` | Profile description / reference 开关（手动） |

## 数据流（验收闭环）

```
主会话派单（CreateSession，outputPath 可选）
  → 子会话执行
  → 子会话交付（SendMessage delivery=true，附结构化自述：达成/未完成/caveats/交付物形态）
  → 主会话验收：读交付物（共享区文件 / 消息正文），对照任务目标
      ├─ 合格 → 接受，继续主线
      ├─ 有缺口 → SendMessage 追问返工 → 自动调起原子会话 → 新一轮交付
      └─ 方向全错 → 重派新会话
```

## 错误处理 / 边界情况

- **自动调起时 JSONL 丢失**：走正常报错路径（文件不存在），返回明确错误信息。
- **孙子会话防护不受影响**：自动调起只对「自己的直派子会话」生效，校验链与现有 hasDirectContractChannel 一致。
- **并发 SendMessage 到同一停机会话**：第一次触发调起后 session 已 attach，后续消息走 queued 模式排队，无竞态。
- **outputPath 为空时**：不 claim 路径占用、markChildDelivered 的路径释放逻辑跳过空值。
- **交付自述是提示词约束**：模型可能漏写 → 主会话验收时发现无自述可直接追问，不构成硬故障。
- **「探索」Profile 的只读是软约束**：bash 可绕过写操作。已知且接受（引导而非沙箱）。

## 未决问题

- 问题 2（「另起会话但 agent 懂我」的语境继承）尚未讨论完，不在本设计范围，另立设计。
- 「股票」Profile 处于停用状态，恢复与否与本次改动无关。
- 实施 Profile 模型档位待用户定夺。
