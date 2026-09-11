# 派发-唤醒链路与任务结算修复 实施计划

**目标**：任务完成只走申报制；父会话在子会话运行期间必然存活（不依赖 UI）；父会话意外销毁时交付/终态自动调起送达；存活状态对用户可见。

**架构思路**：删队列「一轮=完成」兜底改申报制+interrupted 兜底；delegation-bridge 以 retain/release 管理父会话保活（粒度=有无 running 直属子会话）；child→parent 注入遇 target_inactive 对称复用自动调起；主进程广播存活集合驱动 UI 竖线与侧边等待动效。排除：队列修正条件继续判成功（代码无法区分真完成与忘申报）、离线投递箱（调起语义更直接，YAGNI）。设计全文见 `../delegation-lifecycle-fix-design.md`，根因证据见共享区 `investigate/delegation-task-review-bug.md`。

**涉及模块**：task-queue.ts、delegation-bridge.ts、tools/delegation-tools.ts、pi-session-manager.ts、renderer-broadcast.ts、conversation-store.ts、ConversationRow.tsx、AgentChat.tsx/StreamingIndicator

## 步骤索引

- [x] [Step 1: bridge 保活（retain/release）](./step1-bridge-retain.md) — running 直属子会话存在期间父会话不被销毁
- [x] [Step 2: 队列结算改申报制](./step2-queue-settle.md) — 删兜底 completeTask；轮结束未申报且无 running 子会话 → interrupted + 引导
- [x] [Step 3: child→parent 自动调起](./step3-resume-parent.md) — 交付/终态注入遇 target_inactive 自动拉起父会话
- [x] [Step 4: 存活可视化](./step4-alive-visual.md) — 存活集合广播 + 列表竖线存活态 + 等待动效挪侧边

## 全局决策

- review（完成）唯一入口 = 申报路径（ReportTaskResult → task-store.ts:270）；队列不再写 review
- 保活与 childStates 同生命周期（内存态）；不引入新持久化
- 调起复用 rehydrate + resume 既有模式，不新建投递箱存储
- 轮结束置 interrupted 用最简版（无宽限期），观察误伤再调（设计文档未决问题）
- 所有广播走既有 renderer-broadcast try/catch 包裹模式，失败不影响主链

## 完成总结（2026-09-11）

4 步全部实施完毕并逐 step 提交（3f26eda / af5e5d4 / 1823189 / c03d392），lint 0 errors、build 全通过、delegation + task-queue + 渲染层测试 73 pass 0 fail。

- Step 1 bridge 保活：PiSessionManager 独立 holds 计数（acquireHold/releaseHold），delegation-bridge 在 spawnChild 成功后持有父会话、全部子会话终态释放；销毁判定 = refCount==0 ∧ !isHeld ∧ !running
- Step 2 申报制结算：删队列「一轮=完成」兜底与 result 提取死代码；轮结束三态（非 success → interrupt；有 running 子会话 → 不结算等注入续跑；未申报无子会话 → interrupted + 申报引导）
- Step 3 自动调起：resumeParentAndDeliver（attach 直拉 + reacquireParentHolds 重挂保活 + 注入）覆盖子会话交付与失败型终态两条送达链，target_inactive 不再静默丢弃；回执文案消除误导
- Step 4 存活可视化：存活集合（内存 ∧ running/被保活）sorted-join diff 全量广播 + 冷启动查询；列表竖线 emerald 常亮（pending 蓝 > running 橙 > 存活绿）；等待交付动效迁至 minimap 同列侧边轨道（点击即中断），主聊天流无等待文案

遗留（各 step 交付文档已记）：父会话调起路径无 hang 防护（低概率观察）；申报成功后的系统通知缺口（建议补在 task-tools 申报分支）；无宽限期最简版 interrupted 误伤闲聊场景待观察。
