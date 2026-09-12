---
step: 4
title: 开关乐观更新与设置全实时
status: done
---

## 目标

能力开关改乐观更新消除全页闪烁；设置页去掉「保存并退出」改为全实时保存。

## 依赖上下文（接力棒输入）

- 前置 step 产出：[step3-detail-layout.md] 详情页布局已定稿
- 关键决策回顾：闪烁根因 = writeOverrides 的 setPackBusy + configVersion 全页传导（AbilityTab.tsx:64-80）；乐观更新 = 本地先翻转 → 后台落盘 → 失败回滚提示；设置项改防抖即写、退出无弹窗；RuleFileEditor 独立编辑态保存保持不变；用户已确认「反正下次消息才生效」

## 计划改动

- [x] `app/settings/AbilityTab.tsx`：writeOverrides/handleToggleSkills 改乐观更新（本地 overrides 先行、IPC 失败回滚 + toast），去 packBusy/skillBusy 全局传导与 configVersion 递增刷新
- [x] `app/settings/page.tsx`：删「保存并退出」按钮与未保存弹窗；local 草稿字段（基础设置/模型方案）改防抖即写；isDirty/handleSaveAndClose 逻辑退役
- [x] 各设置控件 onChange 链路核对
- [x] bunx tsc --noEmit / lint / build 全过；GUI 冒烟待用户验收（无 GUI 环境，清单见交接）

## 实施回填（做完后填）

### 实际改动
- 与计划差异（均已主会话验收定性接受）：
  - 计划外改 stores/settings-store.ts：saveSettings 判断 IPC 返回 error 并 throw——原实现失败也本地 set 假成功，全实时下会永不重试，属「写失败提示」必要支撑
  - deleteProfileById 加 showConfirm 确认（confirm-store）：原靠「取消」兑底防误删，全实时后立即生效需确认
  - memo 收敛：SegmentBlock/CoreProfileView/SkillMarkdown 三处 Markdown 正文 memo 化，消除 step3 预警的「重解析闪烁面」
  - 矩阵刷新信号 configVersion → mountsRefreshKey，bump 放落盘成功后（避免与落盘 IPC 并发拉到旧值）
  - 防抖统一 500ms 不按控件分级（点击类延迟无感）
- 改动文件清单：app/settings/AbilityTab.tsx、app/settings/ability/AbilityPackCard.tsx、app/settings/ability/AbilityPackDetailPage.tsx、app/settings/ability/AbilityPackSidebar.tsx、app/settings/ability/RulesPackDetailPage.tsx、app/settings/page.tsx、stores/settings-store.ts

### 给下一步的接力棒
- 关键签名 / 数据结构：
  - persistConfig(patch)：乐观 set → updateWorkspaceConfig 落盘 → 成功 bumpMounts()；失败重拉 getWorkspaceConfig 回滚 + toast
  - mountsRefreshKey: number（bump = 落盘成功后 / 切换工作区后）；AUTOSAVE_DELAY_MS = 500；savedSnapshotRef 防同步回滚；卸载 flush 不丢尾编辑
- 下个 step 该从哪里继续：无（本计划最后一步）；收尾 = docs/codebase-map.md 同步 + GUI 冒烟（见下）
- 待办或已知限制：
  - GUI 冒烟六点清单：①拨开关即时翻转且 Markdown 不闪、矩阵落盘后刷新；②异常场景开关回滚 + toast；③设置改项 500ms 落盘、退出无弹窗、返回值保留；④模型方案 tab 连续输入不丢尾字符；⑤删模型方案有确认弹窗；⑥主题/字号延迟约 0.5s 应用（预期）
  - SubAgentTab 删 Profile 无确认（与模型方案不对称，后续统一）；persistConfig 回滚与切工作区理论竞态（与原实现同等，未加固）；build:renderer 既有失败（@xterm/headless，非本计划引入）；BasicToolsSection 直写不设防抖（UX二轮自治即时保存，互不干扰）
