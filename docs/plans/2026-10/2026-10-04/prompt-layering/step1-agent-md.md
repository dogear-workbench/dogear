---
step: 1
title: agent.md 内容层三处
status: done
---

## 目标

用户级 agent.md 复活为跨工作区纯人格层；general.md 模板同步去重；dogear 工作区 agent.md 删除与用户级重复的条目。

## 依赖上下文（接力棒输入）

- 设计定稿：[../prompt-layering-design.md](../prompt-layering-design.md)「架构」节的四层表与「错误处理」节
- 路径常量见 plan.md「全局决策」末两条
- 注入语义已确认：pi-session.ts:476 两级拼接注入（工作区级在前），无需改代码

## 计划改动

- [ ] 新建 `/Users/dream/Library/Application Support/dogear/.dogear/agent.md`，全文如下（逐字写入，勿增删）：

```markdown
# 通用偏好

## 交流

- 使用中文回答
- 简洁直接，不堆砌废话；简单问题直接回答，不加多余标题和小节
- 不清楚的地方直接说「不确定」或「需要查证」，不要胡编内容来填补空白

## 思考与决策

- 偏好先规划再实现：重要的事先想清楚方案再动手
- 重要决策要多方面权衡，不只看一个维度
- 任何观点都要有证据或引用支撑，不靠「我觉得」
- 拿不准时先问，不要带着 50% 的把握就动手

## 工作方式

- 根因优先：遇到问题先查根因，不用绕过手段屏蔽问题
- 独立的工具调用并行发出以提升效率
```

- [ ] 重写 `resources/agent-templates/general.md` 为与上面完全相同的内容（模板=用户级出厂态，保持一致；原文件「子会话使用」节迁给系统段，Step 3 处理）
- [ ] 编辑 dogear 工作区 agent.md（路径见 plan.md）：「硬约束」第一条
  - 改前：`- 改一个功能要全面考虑对其他模块的影响；拿不准的先问，不要带着一半把握动手`
  - 改后：`- 改一个功能要全面考虑对其他模块的影响`
  - 理由：「拿不准先问」上移用户级；其余条目（不写注释/不留半成品/300 行/代码引用格式）为代码工作区特有，保留
- [ ] 若用户级 agent.md 写入被禁写区拦截：停下报告，改为在交付文档中给出全文由用户经设置页粘贴（不要静默跳过）

## 实施回填（做完后填）

### 实际改动
- 与计划差异：第 3 处（工作区 agent.md 硬约束第一条去重）未完成——workspaces/ 子树在应用数据禁写区，子会话与主会话的文件工具均被拒（permission_denied），plan 未预见；已转用户经应用 UI 处理（TrackUserActions），改动为纯去重无信息丢失，不阻塞后续步骤
- 改动文件清单：
  - 新建 `/Users/dream/Library/Application Support/dogear/.dogear/agent.md`（逐字写入，diff 零差异，未被禁写区拦截）
  - 重写 `resources/agent-templates/general.md`（与用户级完全一致；旧版「子会话使用」节已移除）

### 给下一步的接力棒
- 关键事实（实际写入路径、是否有拦截）：用户级 agent.md 可写已复活；workspaces/ 子树对文件工具只读
- 下个 step 该从哪里继续：Step 2（skill 层三文件）
- 待办或已知限制：① 工作区 agent.md 硬约束第一条仍含「拿不准的先问…」后半句，待用户经 UI 删除；② general.md 旧版「子会话使用」3 条原文存于共享区 20261005-step1-delivery.md，Step 3 迁移系统段时取用
