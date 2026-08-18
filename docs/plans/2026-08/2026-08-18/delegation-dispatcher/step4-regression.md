---
step: 4
title: 前端状态展示 + 回归走查 + 文档同步
status: pending
---

## 目标

新状态值（hang/interrupted）与复活过程的 UI 可见；全链路回归验收；文档同步。

## 依赖上下文（接力棒输入）

- 前置 step 产出：[step3-persistence-tools.md] 全链路已通，前端类型已含新 ChildStatus 值（Step 1 同步过）
- 本步焦点：前端消费端展示 + 整体验收 + 收尾

## 计划改动

- [ ] 前端 childStatus 消费端（执行时 grep `childStatusChanged` / `ChildStatus` 在 `components/` 与 `stores/` 的消费点，逐个补新值处理）：
  - [ ] 子会话状态徽标/角标：`hang` → 「无进展中断」（样式同 failed）、`interrupted` → 「重启中断」（可点击/提示可用 ResumeSession 调起——若状态组件无交互位，仅展示文案即可）
  - [ ] 复活过程：状态从 failed 回 running 时 `deliveriesAwaitChanged` 已有广播，确认 UI 计数正确刷新
  - [ ] `stores/` 中若有 ChildStatus 的 exhaustive switch/映射表，补新值防 fallback 兜底成错误样式
- [ ] 回归走查清单（dev 环境逐条过）：
  - [ ] 正常态：派遣 → 运行（idle 无误杀：长任务/长工具 10 分钟+ 活着）→ 交付 → 主会话收到
  - [ ] 瞬时失败：断网/改错 key 派遣 → failed → 自动复活（会话列表可见状态回 running）→ 成功交付，主会话全程只收到最终交付
  - [ ] 连续失败：MAX_RETRY 耗尽 → 主会话收到结构化通知（attempts/modelTried 正确）
  - [ ] quota 降级：profile 配两家供应商，一家 key 限流 → 自动降级复活，modelTried 含两家
  - [ ] 手动停止：StopSession → 不复活 → 通知 cancelled
  - [ ] 重启恢复：跑一半重启 → interrupted → ResumeSession 调起 → 接着干
  - [ ] 老链路无回归：CreateSessionBatch、outputPath claim 冲突、abortWaitsForParent（前端中断等待按钮）
  - [ ] delegation-state.json 不无限增长：done 条目保留合理（下版本再清理可接受，记录到已知限制）
- [ ] `docs/codebase-map.md` 同步：delegation-bridge 职责描述更新（调度站：检测/重调/降级/持久化）、delegation-tools 新增 ResumeSession、delegation-state.json 存储
- [ ] 记忆更新：`delegation-dispatcher-design` 主题补实施结果

## 验收路径

见回归走查清单——全部通过即本计划完成。

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 完成总结写回 plan.md（实际改动汇总、与原计划偏差）
