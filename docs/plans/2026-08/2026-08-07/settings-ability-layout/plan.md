# 设置页能力 Tab 重组 + 工具描述治理 实施计划

**目标**：将设置页从 13 个 Tab 重组为更聚焦的结构，所有能力（提示词 + 工具 + Skill）在「能力」Tab 以能力域卡片展示；统一 Skill 模板源；治理工具描述中越界的行为约束。

**架构思路**：
- 设置页：基础工具权限移入「基础设置」；新建「能力」Tab 吞收原「工具与权限」+「Skill 管理」+「系统提示词」三个 Tab 的内容；后台任务工具归到「会话摘要」Tab
- Skill 模板：统一到 `resources/skill-templates/`，所有内置模板走订阅模式 + 恢复按钮
- 工具描述：精简为纯功能说明，约束移到提示词（只留警告级），不搬常识

**涉及模块**：
- 前端：`app/settings/page.tsx`、`ToolsAndPermissionsTab.tsx`、`SystemPromptPreviewTab.tsx`、`SkillTab.tsx`
- 工具：`electron/main/agents/tools/*-tools.ts`（14 个文件 61 个工具描述）
- 提示词：`electron/main/agents/session-append-templates.ts`、`electron/main/agents/tool-pack-guide.ts`
- Skill：`electron/main/services/skill-service.ts`、`stock-analysis-skills-service.ts`、`article-parser-skills-service.ts`、`memory/review-skill-service.ts`
- 模板源：`resources/skill-templates/`（新目录）
- 构建：`electron-builder.yml` 或 `package.json` 打包配置

## 步骤索引

- [x] [Step 1: 工具描述治理](./step1-tool-description-cleanup.md) — 精简 61 个工具描述，约束移到提示词
- [x] [Step 2: 提示词补充](./step2-prompt-enhancement.md) — 记忆/协作/股票三处提示词补警告级约束
- [x] [Step 3: Skill 模板源统一](./step3-skill-template-source.md) — 创建 resources/skill-templates/，迁移所有内置模板
- [x] [Step 4: 能力 Tab 前端](./step4-ability-tab.md) — 重写能力 Tab 组件，能力域卡片 + 浮窗
- [x] [Step 5: 设置页 Tab 重组](./step5-settings-restructure.md) — Tab 合并/删除/重命名，基础工具移入基础设置

## 全局决策

- 工具描述治理原则：工具只回答「是什么、怎么调」；提示词只留警告级（易错/易忘），不搬常识
- Skill 模板源统一到 `resources/skill-templates/<name>/SKILL.md`，开发时读源文件，构建时打包
- 能力域卡片左右分栏：左侧提示词全文/Skill 索引，右侧工具组列表
- 浮窗只放 SKILL.md 全文，提示词短内容平铺不弹窗
- 后台任务工具（review/digest/category/group-digest）展示在「会话摘要」Tab，不进能力 Tab
- 窄屏降级方案：左右分栏在窄屏改为上下堆叠（实施时用 CSS flex-wrap 或 media query）

## 完成总结

5 个 step 全部完成，6 次 git commit：

1. **工具描述治理**（Step 1）：11 个工具文件、41 处 description 精简，删除越界的行为约束/工作流/使用场景
2. **提示词补充**（Step 2）：新增记忆系统提示词段、补充协作/股票警告级约束，从工具描述删除的约束在新家落位
3. **Skill 模板源统一**（Step 3）：9 个模板迁移到 `resources/skill-templates/`，新建通用 `skill-template-service.ts`，3 个旧服务改造为文件源读取
4. **能力 Tab 前端**（Step 4）：新建 AbilityCard / SkillDetailDialog / AbilityTab 三组件，6 个能力域卡片分组渲染
5. **设置页 Tab 重组**（Step 5）：Tab 从 13 个减到 11 个，基础工具权限移入基础设置，删除 3 个旧 Tab 组件

**验证**：lint 0 errors、build:electron 和 build:renderer 均通过。运行时交互验证留给用户。

**遗留事项**：
- 运行时验证：打开设置页确认基础设置/能力两个 Tab 的 UI 与功能正常
- 代码工作流 Skill 需通过能力 Tab 的「订阅」按钮重新写入工作区 `.claude/skills/` 后才能在会话中加载
- `stock-analysis-skills-service.ts` 是薄壳 re-export，后续可清理为 IPC 直接从 `skill-template-service.ts` 导入
