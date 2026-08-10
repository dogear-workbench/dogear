---
step: 5
title: 设置页 UI 重构
status: pending
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

- [ ] `app/settings/SubAgentTab.tsx` 完整重写：
  - **Profile 列表区**：
    - 卡片形式列出 `local.subAgent.profiles` 中所有 Profile
    - 每张卡片：名称（粗体）、描述、配置摘要（基础工具数/能力域数/模型/超时）
    - 卡片右侧：编辑、删除按钮（默认 Profile 不可删）
  - **添加按钮**：顶部或列表末尾，点击进入编辑界面
  - **编辑界面**（内联展开或弹窗）：
    - 名称：文本输入
    - 描述：textarea
    - 模型：ModelSelector（allowUnset）
    - 超时：数字输入（1-180）
    - 基础工具：6 个 checkbox（Read/Write/Edit/Bash/Glob/Grep）
    - 能力域：
      - 记忆系统（checkbox）
      - 股票分析（checkbox）
      - 文章（checkbox）
      - 代码工作流 Skill：多选列表，每项 name + 一句话描述（从 skill 模板列表获取）
      - 自定义 Skill：多选列表（从 `client.listSkills` 获取，排除模板 skill）
      - 交付通信（固定，仅展示说明文字）
      - 共享区文件（checkbox）
      - 引用回溯（checkbox）

### 5.2 Profile 增删改逻辑

- [ ] 添加 Profile：生成新 id（`crypto.randomUUID()` 或递增），push 到 profiles 数组
- [ ] 编辑 Profile：更新对应 id 的 Profile 对象
- [ ] 删除 Profile：从 profiles 数组移除（默认 Profile 的删除按钮 disabled）
- [ ] 所有修改通过 `setLocal((prev) => ({ ...prev, subAgent: { profiles: ... } }))`

### 5.3 Skill 列表数据获取

- [ ] 代码工作流 Skill 列表：调用 `client.listSkillTemplates()` 获取模板列表，筛选 `CODE_WORKFLOW_TEMPLATES`（brainstorming/codebase-map/doc-sync/staged-execution/staged-impl/systematic-debugging）
- [ ] 自定义 Skill 列表：调用 `client.listSkills({ workspaceId })` 获取已安装 skill，排除所有模板 skill 名

### 5.4 page.tsx 衔接

- [ ] `app/settings/page.tsx`：TabsContent value="sub-agent" 的 props 传递保持不变（`local` + `setLocal`）
- [ ] 移除旧的 CONTEXT_MOUNT_OPTIONS / CACHE_POLICY_OPTIONS 相关常量（在 SubAgentTab 内部）

## 验证

- `bun run dev:renderer` 前端编译通过
- 设置页"子会话派遣"Tab 显示 Profile 列表
- 可添加新 Profile（填写名称/描述、勾选基础工具/能力域）
- 可编辑默认 Profile
- 默认 Profile 删除按钮 disabled
- 保存后重新打开设置页，Profile 列表持久化

## 实施回填（做完后填）

### 实际改动
- （待填）

### 给下一步的接力棒
- （最终步骤，无后续接力）
