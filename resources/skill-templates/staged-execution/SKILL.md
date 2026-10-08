---
name: staged-execution
description: 按已有分步实施计划（docs/plans/**/stepN-*.md）编排执行的主/子会话协议：step 状态流转、分派、回填打勾、每 step 一提交。触发：主会话读到 stepN-*.md 且用户意图是开始/继续实施；工程纪律按 code-discipline，协作协议按系统协作规范段。
---

# Staged Execution

本 skill 管分步实施的编排：step 状态流转、分派、回填打勾、每 step 一提交。派遣/等待/验收/复用按系统「主会话与子会话协作规范」段；工程纪律（实施前勘察 / 验收自检 / 提交规范）按 code-discipline。

## 铁律

**主会话不得直接 Edit/Write 业务代码。** 主会话只负责审核、分派、验收、回填计划文档、git commit，业务代码全部走子会话。违反这条 = 本 skill 失效。

## 何时触发 / 何时不触发

- **必须触发**：主会话读到 `docs/plans/**/stepN-*.md` 且用户意图是"开始实施 / 继续实施 / 跑下一步"；用户说「按计划来 / 按步骤实施 / 跑 step N」而当前 CWD 下有对应 plan
- **不触发**：单纯写/改 plan.md 或 stepN.md 内容（staged-impl 的规划阶段）；「解释一下 step N 什么意思」（纯问答）；修 bug、探索代码（用别的 skill）；已派子会话在跑、主会话等交付时（skill 已生效，不重复触发）

## 前置检查（进入本 skill 后立即做）

1. 确认 plan 位置：`docs/plans/YYYY-MM/YYYY-MM-DD/<feature>/`
2. 读 plan.md 的「全局决策」段（不读全文，只读这一节）
3. 读当前要执行的 stepN.md 全文
4. 确认 step 状态：`pending` 继续；`done` 停下确认；`in_progress` 说明上次没跑完，看「实施回填」段判断续做点

plan 不存在、step 缺失、依赖没就绪 → **停下问用户**，不要凭猜实施。

## 分派规则

### 默认：每 step 派 1 个子会话

task 描述包含三块（N 替换为实际步骤号）：
1. stepN.md 的完整路径
2. plan.md「全局决策」段原文
3. 交付要求：「按 stepN.md 的「计划改动」段实施代码；完成后把交付文档写到共享区 stepN-delivery.md；然后用 dogear__ListLinkedSessions 查派出者 sessionId，向其交付改动清单」

交付路径约定为 stepN-delivery.md，标题约定为「step N: <stepN.md 的 title>」。

### 例外：主会话可以自己做的情形

仅限微改动：改动 <20 行、只涉及 1 个文件、无跨模块影响、不新增文件。**其他一切情况必须派子会话，拿不准就派。**

### 什么时候分多个子会话

单 step 内明确列出 N 个**相互独立**的改动块（如"改 3 个 store 且互不依赖"）→ 可批量派出 N 个，每个独立交付路径。**有依赖的改动不并行**——依赖顺序 = 该拆成多个 step，不是拆成并行子会话。

## 执行循环（每 step 严格按序）

```
1. 主会话读 stepN.md（全文）+ plan.md「全局决策」段
2. 把 stepN.md status 改为 in_progress
3. 判定分派策略（默认单子会话；微改动自己做；独立多块 → 批量派）
4. 派出子会话，task 按「分派规则」三块拼
5. 等待子会话交付
6. 验收：按 code-discipline 验收自检 + 核对交付未越 stepN 范围
7a. 通过：从共享区读交付文档回填 stepN.md「实施回填」段 → status 改 done
    → plan.md 步骤索引 [ ] 改 [x] → commit（按 code-discipline 提交规范，
    仅 commit 该 step 计划改动 + stepN.md + plan.md）→ 汇报用户
    「Step N 完成 → 具体做了什么 → 下一步是 Step N+1」，等用户确认再进下一 step
7b. 不通过：小问题向子会话发消息让它修；大方向错 → 停掉子会话 + 分析原因
    + 重派或改 stepN.md；连续 3 次仍不通过 → 停下报告用户，不无限重试
```

## 失败处理

- **子会话超时 / 失败**：读交付（可能有部分产出）→ 判定原因（任务描述不清 / 依赖缺失 / 子会话钻牛角尖）→ 改 task 描述重派 / 改 stepN.md 拆更细 / 停下问用户
- **3 次连续失败 = 架构问题**：不要第 4 次派。停下告诉用户前 3 次分别怎么失败、怀疑是 plan 拆错 / step 描述不清 / 某技术假设不成立，建议回 staged-impl 重新拆分该 step
- **跨 step 连锁改动**：子会话说「改 stepN 时发现 stepN-1 的实现要跟着动」→ **不要自己扩大 scope**，停下汇报连锁点与建议（回改 stepN-1 新增补丁 step / 重排 plan），用户决定后再动
- **git 冲突 / 工作区脏**：每 step 开始前先 `git status`；工作区有非本流程该 commit 的未提交改动 → 停下问用户，别覆盖

## 与 staged-impl 的接力

| 阶段 | skill | 主要产物 |
|---|---|---|
| 规划 | staged-impl | plan.md + stepN.md（frontmatter status=pending，改动列表已列） |
| 执行 | **staged-execution** | 子会话交付 → 回填 stepN.md 实施回填段 → 打勾 plan.md → git commit |
| 完成 | staged-impl（收尾） | plan.md 末尾加「## 完成总结」 |

规划阶段发现 step 拆错 → 回 staged-impl 改 plan / step；执行阶段发现代码层面 bug → 走 systematic-debugging，修完继续本 skill。

## 分步反模式（看到自己在做就停）

- 「这个 step 简单，我主会话顺手就改了」→ 超出 20 行/单文件例外范围 = 违规
- 「子会话交付看着差不多，直接 commit 吧」→ 未按 code-discipline 验收自检核对 = 违规
- 「顺手把 stepN+1 也一起改了，效率高」→ 越界改动 = 违规，回滚
- 「commit 里带上这几天累积的改动一起提」→ 混提交 = 违规
- 「lint 挂了，加个 // eslint-disable 先过」→ 掩盖问题 = 违规
- 「子会话卡住了，我疯狂发消息指导它」→ 3 次不成 = 停下，不无限循环
- 用户信号对照（出现即回前置检查找跳过的环节）：「你自己怎么在写代码？」= 没派子会话；「改动跟 step 计划的不一样」= 越界；「commit 里怎么有那么多无关文件」= 混提交；「跑一下 lint / build 看看」= 验收跳步
