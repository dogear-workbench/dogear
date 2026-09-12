---
step: 4
title: 开关乐观更新与设置全实时
status: pending
---

## 目标

能力开关改乐观更新消除全页闪烁；设置页去掉「保存并退出」改为全实时保存。

## 依赖上下文（接力棒输入）

- 前置 step 产出：[step3-detail-layout.md] 详情页布局已定稿
- 关键决策回顾：闪烁根因 = writeOverrides 的 setPackBusy + configVersion 全页传导（AbilityTab.tsx:64-80）；乐观更新 = 本地先翻转 → 后台落盘 → 失败回滚提示；设置项改防抖即写、退出无弹窗；RuleFileEditor 独立编辑态保存保持不变；用户已确认「反正下次消息才生效」

## 计划改动

- [ ] `app/settings/AbilityTab.tsx`：writeOverrides/handleToggleSkills 改乐观更新（本地 overrides 先行、IPC 失败回滚 + toast），去 packBusy/skillBusy 全局传导与 configVersion 递增刷新
- [ ] `app/settings/page.tsx`：删「保存并退出」按钮（:242）与未保存弹窗（:155）；local 草稿字段（基础设置/模型方案）改防抖即写；isDirty/handleSaveAndClose 逻辑退役
- [ ] 各设置控件 onChange 链路核对（模型选择/思考模式/权限模式等全部落实时）
- [ ] bunx tsc --noEmit / lint / build 全过；GUI 冒烟：拨开关无闪烁、改设置即时生效、规则编辑器保存不受影响

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
