---
name: staged-execution
description: 按已有实施计划（docs/plans/**/stepN-*.md）分派子会话执行、验收、提交的纪律 skill。自动触发：主会话读到 stepN-*.md 且用户意图是"开始/继续实施"时必须先进本 skill；用户已经派子会话跑起来后不再重复触发。跟 staged-impl 接力：staged-impl 管"怎么规划"，本 skill 管"怎么执行"。
---

# Staged Execution

有实施计划是一回事，让 agent 按纪律实施是另一回事。本 skill 定义主/子会话在实施阶段的分工、分派规则、验收流程和提交纪律。

## 铁律

**主会话不得直接 Edit/Write 业务代码。** 主会话只负责审核、分派、验收、回填计划文档、git commit。业务代码全部走子会话。

违反这条 = 本 skill 失效。

## 何时触发 / 何时不触发

**必须触发**（自动进入本 skill）：
- 主会话读到 `docs/plans/**/stepN-*.md` 且用户意图是"开始实施 / 继续实施 / 跑下一步"
- 用户说「按计划来 / 按步骤实施 / 跑 step N」而当前 CWD 下有对应 plan

**不触发**：
- 单纯写/改 plan.md 或 stepN.md 内容（那是 staged-impl 的规划阶段）
- 用户说「解释一下 step N 什么意思」（纯问答）
- 修 bug、探索代码（用别的 skill）
- 已经派了子会话在跑、主会话在等交付时（skill 已生效，不重复触发）

## 前置检查（进入本 skill 后立即做）

1. **确认 plan 位置**：`docs/plans/YYYY-MM/YYYY-MM-DD/<feature>/`
2. **读 plan.md 的「全局决策」段**（不读全文，只读这一节）
3. **读当前要执行的 stepN.md 全文**
4. **确认 step 状态**：frontmatter 里 `status: pending`？如果是 `done` 停下确认；如果是 `in_progress` 说明上次没跑完，看「实施回填」段判断续做点

如果 plan 不存在、step 缺失、依赖没就绪，**停下问用户**，不要凭猜实施。

## 主/子分工

| 角色 | 职责 | 禁止 |
|---|---|---|
| **主会话** | 读 plan / 读 step / 决定分派策略 / 派子会话 / 等交付 / 验收 / 回填 stepN.md / 打勾 plan.md / git commit | 直接 Edit/Write 业务代码 |
| **子会话** | 按 task 描述改代码 / 把交付文档写到共享区 / 向派出会话交付结果 | 越 step 边界改动 |

## 分派规则

### 默认：每 step 派 1 个子会话

派出子会话，task 描述包含以下三块（按模板填写，N 替换为实际步骤号）：
1. stepN.md 的完整路径
2. plan.md「全局决策」段原文
3. 交付要求：「按 stepN.md 的「计划改动」段实施代码；完成后把交付文档写到共享区 stepN-delivery.md；然后用 ListLinkedSessions 查派出者 sessionId，向其交付改动清单」
交付路径约定为 stepN-delivery.md，标题约定为「step N: <stepN.md 的 title>」

### 例外：主会话可以自己做的情形

**仅限**下列微改动，主会话可以直接 Edit：
- 改动 <20 行
- 只涉及 1 个文件
- 无跨模块影响
- 不新增文件

**其他一切情况必须派子会话。** 拿不准就派。

### 什么时候分多个子会话

- 单 step 内明确列出 N 个**相互独立**的改动块（如"改 3 个 store 且互不依赖"）
- 可以批量派出 N 个，每个独立交付路径
- **有依赖的改动不并行**——依赖顺序 = 该拆成多个 step，不是拆成并行子会话

## 执行循环（每 step 严格按序）

```
1. 主会话读 stepN.md（全文） + plan.md「全局决策」段
2. 主会话把 stepN.md status 改为 in_progress
3. 主会话判定分派策略（默认单子会话；微改动自己做；独立多块 → 批量派）
4. 派出子会话，task 描述按上面「分派规则」的三块拼
5. 等待子会话交付
6. 主会话验收（下节详述）
7a. 验收通过：
    - 从共享区读交付文档，把关键内容回填到 stepN.md 的「实施回填」段
    - 把 stepN.md status 改为 done
    - plan.md 步骤索引对应 [ ] 改 [x]
    - git commit（下节详述）
    - 汇报用户「Step N 完成 → 具体做了什么 → 下一步是 Step N+1」，等用户确认再进下一 step
7b. 验收不通过：
    - 小问题：向子会话发消息让它修
    - 大方向错：停掉子会话 + 分析原因 + 重派或改 stepN.md
    - 连续 3 次仍不通过：停下报告用户，不无限重试
```

## 验收清单

主会话拿到子会话交付后，逐条核对：

- [ ] 确认共享区有交付文档，读其内容，格式合理（改动清单 + 关键签名 + 遗留问题）
- [ ] 交付里声称改的文件用 Read 抽查 2-3 个关键点（**用 Read 抽查而非重读全文**）
- [ ] 有没有超出 stepN.md 计划改动范围的文件被动过？超出 = 不通过
- [ ] 有没有留 `// TODO` / 半成品 stub？（违反项目 agent.md 硬性约定 = 不通过）
- [ ] `bun run lint` 通过（如果 stepN 涉及 TS 代码）
- [ ] `bun run build:electron` 通过（如果改了 electron/ 下的文件）

**验收失败的常见征兆**：
- 交付说明含糊、只写「已完成」没细节
- 声称改的文件实际没变
- 顺手重构了 step 范围外的代码

## 提交规范

**时机**：验收通过后自动 commit，不等用户催、不批量攒。

**只 commit 该 step 涉及的文件**：
- 用 `git status` + `git diff --stat` 核对，仅 add stepN 计划改动 + 更新的 `stepN.md` + `plan.md`
- 混入无关文件（比如别的 step 顺手动的、编辑器临时文件）→ 停下问用户

**message 模板**：
```
<type>(<模块>): <stepN 标题精简版>

<1-2 句说这一步做了什么，用户视角>

plan: <feature-name>/step<N>
```

`<type>` 用项目常用的 feat/fix/refactor/docs/chore。`<模块>` 参考项目现有 commit history 的命名（agent/review/digest/group/model 等）。

**永远不加 `--no-verify`，永远不 `--force`**（跟项目全局纪律一致）。

## 失败处理

### 子会话超时 / 失败
- 读子会话交付（可能有部分产出）
- 判定原因：任务描述不清 / 依赖缺失 / 子会话钻牛角尖
- 决定：改 task 描述重派 / 改 stepN.md 拆更细 / 停下问用户

### 3 次连续失败 = 架构问题
不要第 4 次派。停下告诉用户：
- 前 3 次分别怎么失败的
- 你怀疑是 plan 拆错了 / step 描述不清 / 某个技术假设不成立
- 建议用户回 staged-impl 重新拆分该 step

### 跨 step 连锁改动
子会话回来说「改 stepN 的时候发现 stepN-1 的实现要跟着动」——
- **不要自己扩大 scope**
- 停下汇报用户：具体连锁点、建议是回改 stepN-1（新增补丁 step）还是重排 plan
- 用户决定后再动

### git 冲突 / 工作区脏
每 step 开始前先 `git status`。如果工作区有未提交改动（不是上一个 step 该 commit 的）→ 停下问用户，别覆盖。

## 与 staged-impl 的接力

| 阶段 | skill | 主要产物 |
|---|---|---|
| 规划 | staged-impl | plan.md + stepN.md（frontmatter status=pending，改动列表已列） |
| 执行 | **staged-execution** | 子会话交付 → 回填 stepN.md 实施回填段 → 打勾 plan.md → git commit |
| 完成 | staged-impl（收尾） | plan.md 末尾加「## 完成总结」 |

规划阶段发现 step 拆错 → 回 staged-impl 改 plan / step；执行阶段发现代码层面 bug → 走 systematic-debugging，修完继续本 skill。

## 反模式（看到自己在做就停）

- 「这个 step 简单，我主会话顺手就改了」→ 超出 20 行/单文件例外范围 = 违规
- 「子会话交付看着差不多，直接 commit 吧」→ 未做验收清单核对 = 违规
- 「顺手把 stepN+1 也一起改了，效率高」→ 越界改动 = 违规，回滚
- 「commit 里带上这几天累积的改动一起提」→ 混提交 = 违规
- 「lint 挂了，加个 // eslint-disable 先过」→ 掩盖问题 = 违规
- 「子会话卡住了，我疯狂发消息指导它」→ 3 次不成 = 停下，不无限循环

## 用户信号说明你走错了

- 「你自己怎么在写代码？」 → 你没派子会话，回头分派
- 「这个改动跟 step 计划的不一样」 → 越界了，回滚
- 「commit 里怎么有那么多无关文件」 → 混提交，重新分割
- 「跑一下 lint / build 看看」 → 你跳过了验收清单，补做


看到这些信号：停，回本 skill 前置检查，找出跳过的环节。
