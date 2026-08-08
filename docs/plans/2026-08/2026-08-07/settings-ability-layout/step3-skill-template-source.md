---
step: 3
title: Skill 模板源统一
status: done
---

## 目标

创建 `resources/skill-templates/` 目录，将所有内置 Skill 模板统一为文件源。改造 `listSkillTemplates()` / `subscribeSkillTemplate()` 从此目录读取。改造恢复按钮逻辑。

## 依赖上下文（接力棒输入）

- 前置 step 产出：[step1/step2] 工具描述和提示词已改完
- 关键文件状态：
  - `electron/main/services/stock-analysis-skills-service.ts` — TS 常量 `STOCK_ANALYSIS_SKILL_MD` + `TEMPLATES` Record
  - `electron/main/services/article-parser-skills-service.ts` — TS 常量 `COMMON_MD` 等多个文件
  - `electron/main/services/memory/review-skill-service.ts` — TS 常量 `SKILL_MD`
  - `.claude/skills/` — 6 个代码工作流 Skill（brainstorming / codebase-map / doc-sync / staged-execution / staged-impl / systematic-debugging）

## 计划改动

### 创建模板源目录

- [ ] `resources/skill-templates/brainstorming/SKILL.md` — 从 `.claude/skills/brainstorming/SKILL.md` 复制
- [ ] `resources/skill-templates/codebase-map/SKILL.md` — 同上
- [ ] `resources/skill-templates/doc-sync/SKILL.md` — 同上
- [ ] `resources/skill-templates/staged-execution/SKILL.md` — 同上
- [ ] `resources/skill-templates/staged-impl/SKILL.md` — 同上
- [ ] `resources/skill-templates/systematic-debugging/SKILL.md` — 同上
- [ ] `resources/skill-templates/stock-analysis/SKILL.md` — 从 `STOCK_ANALYSIS_SKILL_MD` 常量提取
- [ ] `resources/skill-templates/article-parser/SKILL.md` — 从 article-parser-skills-service.ts 的常量提取
- [ ] `resources/skill-templates/cross-session-review/SKILL.md` — 从 review-skill-service.ts 的 `SKILL_MD` 提取

### 改造模板服务

- [ ] 新建 `electron/main/services/skill-template-service.ts`（或改造 stock-analysis-skills-service.ts 为通用版本）：
  - `listSkillTemplates()`：遍历 `resources/skill-templates/` 返回所有模板的 name + description
  - `subscribeSkillTemplate(workspacePath, name, overwrite)`：从模板源复制到工作区 `.claude/skills/<name>/SKILL.md`
  - `restoreSkillTemplate(workspacePath, name)`：同 subscribe 但强制覆盖（恢复按钮用）
  - `getTemplateContent(name)`：读取模板源内容（浮窗详情用）
  - 模板源路径解析：开发时 `path.join(process.cwd(), 'resources/skill-templates/')`，打包后用 app 资源目录
- [ ] `tipc/claude-config.ts` — IPC 路由适配新服务
- [ ] 新增 IPC：`getSkillContent(name)` 返回模板源全文（浮窗用）

### 迁移旧逻辑

- [ ] `stock-analysis-skills-service.ts` — 删除 TS 常量 `STOCK_ANALYSIS_SKILL_MD` + `TEMPLATES`，`listSkillTemplates` / `subscribeSkillTemplate` 改为调用新服务
- [ ] `review-skill-service.ts` — `ensureReviewSkillInitialized()` 改为从模板源复制（或保留运行时写入 `.dogear/skills/` 逻辑，但模板内容从文件读）
- [ ] `article-parser-skills-service.ts` — 同上处理
- [ ] 删除 `.claude/skills/` 下的 6 个代码工作流目录（已迁移到 resources）

### 构建配置

- [ ] `electron-builder.yml` 或 `package.json` — 确保 `resources/skill-templates/` 打包进 app

## 实施回填（做完后填）

### 实际改动

**新建文件**：
- `resources/skill-templates/` 下 9 个模板目录（6 个代码工作流 + stock-analysis + article-parser 含 common.md + platforms/wechat.py + cross-session-review）
- `electron/main/services/skill-template-service.ts` 通用服务（listSkillTemplates async / subscribeSkillTemplate / restoreSkillTemplate / getTemplateContent）

**改造文件**：
- `stock-analysis-skills-service.ts` 改为纯 re-export（保持 IPC import 兼容）
- `review-skill-service.ts` 删除 SKILL_MD 常量，改为 getTemplateContent('cross-session-review')
- `article-parser-skills-service.ts` 删除 3 个常量，改为从模板源读取
- `tipc/claude-config.ts` import 改源 + listSkillTemplates async + 新增 getSkillContent 路由
- `electron-builder.yml` extraResources 追加 skill-templates 打包

**主会话处理**：
- 删除 `.claude/skills/` 下 6 个代码工作流目录（brainstorming / codebase-map / doc-sync / staged-execution / staged-impl / systematic-debugging）

验证：`bun run build:electron` 编译通过。

### 给下一步的接力棒

- `listSkillTemplates()` 现在是 async，Step 4 前端调用需 await
- IPC 新增了 `getSkillContent(name)` 路由，Step 4 浮窗用这个拿模板源全文
- `subscribeSkillTemplate` 和新增的 `restoreSkillTemplate` 可用，Step 4 恢复按钮调 restoreSkillTemplate
- article-parser 有附属文件（common.md / platforms/wechat.py），subscribe 已处理
- `.claude/skills/` 下 6 个代码工作流已删除，开发环境暂时没有这些 Skill（Step 4 前端做好订阅 UI 后可恢复）
