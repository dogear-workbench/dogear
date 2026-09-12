---
step: 2
title: 挂载矩阵
status: done
---

## 目标

详情页右栏「挂载情况」从工作区实例反查改为会话场景加载矩阵。

## 依赖上下文（接力棒输入）

- 前置 step 产出：[step1-backend-ownership.md] 包结构已重划（会话组包已存在、协作包含子会话契约段等）
- 关键决策回顾：工作区维度整个删掉；「子会话·默认」= 系统预设定死全开、标注不可改；其余 Profile 显示真实勾选状态；单元格 = ✓/✗ + 一句话原因

## 计划改动

- [x] `electron/main/tipc/ability.ts`：getAbilityMounts 改造为场景矩阵——行 = 主会话（固定）/ 子会话·默认（固定，标记系统预设）/ 各 Profile（读 settings.subAgent.profiles）/ 任务执行会话（固定）；列数据 = 该能力在各场景的加载结果 + 原因（包开关默认或 override / Profile 勾选 / 场景规则如「任务会话只注组头」）；RESIDENT_GROUP_IDS 等常量随 step1 结果对齐
- [x] `app/settings/ability/AbilityMountsSection.tsx`：重写为矩阵渲染（场景行 + 状态徽标 + 原因），删除工作区列表
- [x] `app/settings/ability/AbilityPackDetailPage.tsx` / 系统行为详情：接入矩阵；会话组包、系统行为卡同样适用
- [x] bunx tsc --noEmit / lint / build 全过

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
  - 「子会话·默认 = 定死全开」的落法：无 Profile 过滤维度的包（规则×2、core-profile、notes、group-context、agent-collab）只看包开关 ∩ 触发条件（即「定死」）；有细闸维度的包（memory/stock/article/browser/code-workflow）显示 default Profile 真实勾选结果（未勾 → ✗）——字面全开会展示假数据，行级「系统预设」徽标落实不可改；若需字面全开只改 buildMountRows 的 profileFilterReason 一处
  - 矩阵按「触发条件已满足」计算：占位组 ID 让属组条件放行，条件文字化进 reason，与拼装共用 resolveAbilities 单一真源
  - executor 行包级复用 main 解析（差异在段/工具细节，全部文字化进 reason）
  - 计划外直落点：ability-registry 删 buildProfileAbilityMount 及其测试组（旧数据结构连带，不留双轨）；AbilityTab 首页与 RulesPackDetailPage 文案同步「加载情况」；reference 勾选 UI 与类型字段清理（settings-types.ts / types/settings.ts / SubAgentTab）
  - 系统行为卡矩阵：SYSTEM_MOUNTS_PACK_KEY = '__system__'，常驻能力各场景恒加载，走同一 IPC
- 改动文件清单：electron/main/tipc/ability.ts、electron/main/agents/ability-registry.ts、electron/main/agents/ability-registry.test.ts、electron/main/agents/tool-registration-smoke.test.ts、electron/main/services/settings-types.ts、types/settings.ts、app/settings/SubAgentTab.tsx、app/settings/AbilityTab.tsx、app/settings/ability/AbilityMountsSection.tsx、app/settings/ability/AbilityPackSidebar.tsx、app/settings/ability/AbilityPackDetailPage.tsx、app/settings/ability/RulesPackDetailPage.tsx、app/settings/ability/SystemBehaviorDetail.tsx

### 给下一步的接力棒
- 关键签名 / 数据结构：
  - getAbilityMounts：input `{ key, workspaceId }` → `{ pack, rows }`；AbilityMountSceneRow = { kind: 'main'|'sub-default'|'profile'|'executor', id, label, system, loaded, reason, profileDisabled? }
  - 前端 AbilityMountsSection({ packKey, workspaceId, refreshKey }) 自包含，step3 右栏重排无需再动矩阵组件
- 下个 step 该从哪里继续：step3（详情页布局）——AbilityPackSidebar / AbilityPackDetailPage 结构层改右栏加宽与元素迁移；SystemBehaviorDetail 里 groupContext / subAgentContract 变量因 behaviors 恒 [] 永不渲染，可一并清理
- 待办或已知限制：矩阵 refreshKey 挂在 configVersion 上，step4 去掉 configVersion 递增时需换刷新信号（否则开关后矩阵显示旧态）；docs/codebase-map.md 相关条目未同步；workspace-rules / global-rules 两矩阵内容几乎相同（未与设计确认，未动）
