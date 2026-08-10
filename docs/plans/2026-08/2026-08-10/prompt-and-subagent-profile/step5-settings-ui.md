---
step: 5
title: 设置页 UI 重构
status: done
---

## 目标

把 SubAgentTab 从单一配置页改为 Profile 管理器：列表 + 添加/编辑/删除，编辑界面含基础工具勾选和能力域勾选。

## 依赖上下文（接力棒输入）

- Step 2 产出：`SubAgentProfile` 类型、`AppSettings.subAgent.profiles` 结构（前端类型在 `app/types/settings.ts`）
- Step 4 产出：CreateSession 的 profile 参数语义
- 当前 SubAgentTab：`app/settings/SubAgentTab.tsx`（约 180 行，单一配置页）
- page.tsx 中引用：`app/settings/page.tsx:693-697`（TabsContent value="sub-agent"）

## 计划改动

### 5.1 SubAgentTab 重构为 Profile 管理器

- [x] `app/settings/SubAgentTab.tsx` 完整重写（~330 行）：
  - Profile 列表区：卡片形式（名称/描述/配置摘要/编辑删除按钮），默认 Profile 删除 disabled
  - 添加按钮：crypto.randomUUID() + createDefaultSubAgentProfile()，自动进入编辑模式
  - 编辑界面：内联展开，draft 模式（保存/取消），含名称/描述/模型/超时/6 基础工具/能力域 checkbox（memory/stock/article/groupFiles/reference + 固定交付通信 + 代码工作流 Skill 多选 + 自定义 Skill 多选）

### 5.2 Profile 增删改逻辑

- [x] 添加/编辑/删除 Profile 逻辑完整实现（draft 模式，commit/cancel）

### 5.3 Skill 列表数据获取

- [x] Skill 数据获取：useEffect 并行调用 listSkillTemplates + listSkills，筛选/排除 CODE_WORKFLOW_TEMPLATES

### 5.4 page.tsx 衔接

- [x] page.tsx 未改动（line 694 引用保持不变）
- [x] 旧常量（CONTEXT_MOUNT_OPTIONS / CACHE_POLICY_OPTIONS）随完整重写移除

## 验证

- `bun run dev:renderer` 前端编译通过
- 设置页"子会话派遣"Tab 显示 Profile 列表
- 可添加新 Profile（填写名称/描述、勾选基础工具/能力域）
- 可编辑默认 Profile
- 默认 Profile 删除按钮 disabled
- 保存后重新打开设置页，Profile 列表持久化

## 实施回填（做完后填）

### 实际改动
- `app/settings/SubAgentTab.tsx` 完整重写（~330 行）：Profile 列表卡片 + ProfileEditor 子组件 + draft 模式编辑
- 旧字段（cachePolicy/loadCoreProfile/loadSkills/loadArticleParse）零残留
- 前端构建通过（build:renderer ✓）

### 给下一步的接力棒
- 最终步骤，无后续接力
