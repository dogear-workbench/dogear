# 设置页布局对齐 + 能力 tab 重构 + 工作区 skill 配置修复 设计

**日期**：2026-08-27
**状态**：已与用户逐项拍板

## 背景

1. **布局不一致**：设置页是左侧竖排导航 + 右侧内容；数据中心已改为顶部下划线 tab + 内容居中（`mx-auto max-w-*`），设置页要对齐。
2. **能力 tab 组织冗长**：按能力域 6 张卡片（记忆系统/Agent协作/股票分析/代码工作流/文章/自定义），左右两栏平铺全部工具明细，不紧凑。
3. **workspaceId=null bug**（claude-cleanup step5 遗漏）：设置窗口是独立 BrowserWindow，`workspace-store` 在其中从未初始化，`AbilityTab` / `SubAgentTab` 的 `workspaceId` 恒为 null → `listToolPacks` 返回空、所有开关显示未挂载、`handleToggleSkill` 里 `if (!workspaceId) return` 静默失败。生产环境 config 里已有真实挂载（一个工作区挂 `stock-analysis`、另一个挂 6 个代码工作流 skill），但 UI 从未正确显示/操作过。
4. **自定义 skill 旧机制是每工作区一份副本**（`.dogear/workspaces/<id>/skills/`）。目标形态：可选 skill 和自定义 skill 在 `.dogear` 下只有一份文本，工作区只存挂载配置（`enabledSkills`），不再每工作区一个副本。生产环境工作区下无存量，无迁移负担。
5. **cross-session-review 死链路**：其功能已被调度器内置任务 `review`（「复盘报告」）完全替代——`review-prompt.ts` 的 `DEFAULT_REVIEW_PROMPT` 与该 skill 文本同源，工具列表硬编码，由调度器自动触发。且所有工作区从未启用过该 skill。

## 目标

1. 设置页布局对齐数据中心：顶部下划线 tab 导航 + 内容整体居中。
2. 能力 tab 重构：胶囊分「提示词 + Skill」「工具组」两个视图，默认前者；skill 行开关为主控联动工具包；条目下挂工具组徽标，点击跳转到工具组视图对应位置。
3. 修复设置窗口 workspaceId 获取（能力、子会话派遣两个 tab）。
4. 自定义 skill 全局化：扫描目录改为 `.dogear/skills/`（全局一份），废弃工作区 skills 目录机制。
5. 清理死链路与遗留：删 cross-session-review 模板；`.dogear/skills/article-parser/` 运行时目录搬家；清 `.dogear/skills/review/` 死遗留。

## 架构

### 1. 设置页布局（app/settings/page.tsx）

- `Tabs orientation="vertical"` → 水平下划线式（对齐 `data-center/page.tsx` 的 `TabsList variant="underline"`，顶部 `px-6`）。
- 各 TabsContent 内容包 `mx-auto` 容器居中，宽度沿用现状：基础设置/模型方案/子会话派遣/关于 `max-w-2xl`、工作区管理 `max-w-3xl`、能力 `max-w-3xl`。
- 顶部 header（返回 + 保存/取消/保存并重启会话）与 dirty 机制不变。

### 2. 能力 tab 信息架构（AbilityTab 重构）

```
能力 tab
├─ 顶部：工作区 Select（编辑目标工作区；getAll 列表，默认 getDefault()）
├─ 气泡胶囊（自绘 segmented，rounded-full）：「提示词 + Skill」（默认）｜「工具组」
│
├─ 视图 A：提示词 + Skill
│   ├─ 上段「内置 · 全局生效」：4 个提示词段（记忆引导/协作规范/组上下文/子会话契约）
│   │    只读查看（SegmentDetailDialog），无开关
│   ├─ 中段「可选 Skill · 按工作区挂载」：listSkillTemplates 的模板
│   │    （股票×2 / 文章×1 / 代码工作流×6，cross-session-review 已删）
│   └─ 下段「自定义 Skill · 按工作区挂载」：listSkills 中 source=custom（新全局目录扫描）
│        每行：名称 + 描述 + 挂载开关（主控联动）+ 关联工具组徽标 + 详情按钮
│
└─ 视图 B：工具组
    ├─ 常驻组（dogear-memory / delegation / group / reference）：无开关，
    │    标注注入条件，组行展开工具列表 → 工具点击开 ToolDetailDialog
    └─ 可选包（article / stock-quote / stock-analysis / stock-announcement / stock-picking）：
         分工作区开关（独立写 enabledToolPacks，微调用），同上展开
```

- **跳转定位**：点 skill 行的工具组徽标 → `setView('tools')` + 目标组 `scrollIntoView({ behavior: 'smooth' })` + `ring` 高亮动画（约 2s 后淡出）。
- **无域总开关**：旧 `DomainToggle` / `stockDomainOn` 等域概念删除，skill 行各自开关。
- `AbilityCard.tsx`（域卡片）不再使用，删除。

### 3. 开关联动规则（skill 开关为主控）

前端常量映射（编译期已知的域知识）：

```ts
const SKILL_PACK_MAP: Record<string, string[]> = {
  'stock-analysis': ['stock-quote', 'stock-analysis', 'stock-announcement'],
  'stock-picking': ['stock-picking'],
  'article-parser': ['article'],
  // 代码工作流 ×6：无关联包（复用基础工具），映射为空
};
```

- **开 skill**：`enabledSkills ∪= {name}`；`enabledToolPacks ∪= 关联包`（要用都用）。
- **关 skill**：`enabledSkills -= {name}`；`enabledToolPacks -= (该 skill 关联包 − 其他已启用 skill 的关联包并集)`（不误伤共享包）。
- **工具组视图的包开关**：只写 `enabledToolPacks`，不做反向推断。
- 写入统一走 `client.updateWorkspaceConfig({ workspaceId, config })`（现状已有），返回 merged config 后刷新本地标注。

### 4. workspaceId 修复（能力 + 子会话派遣）

- 两个 tab 挂载时各自 `client.getAll()` + `client.getDefault()`：工作区列表进 Select，默认选中 default；**本地 state，不依赖 workspace-store**（设置窗口无主页面初始化链路）。
- 无工作区（零工作区首启）：分工作区段显示引导文案、开关禁用；提示词段与常驻工具组不受影响照常显示。
- 主窗口切换工作区后设置窗口不自动跟随：打开时拉一次即可，Select 可手动切换，符合数据中心交互习惯。

### 5. 自定义 skill 目录全局化

- `skill-service.ts`：custom 扫描目录 `.dogear/workspaces/<id>/skills/` → `getConfigDir()/skills`；`listSkills(workspaceId)` 签名不变（enabled 标注仍需 workspaceId）。
- `pi-session.ts:394`：`customSkillsDir` 同步改 `getConfigDir()/skills`；`filterSkillsForSubAgent` 的 `scanDirs.custom` 同步。
- `~/.claude/skills`（user 级）保持不变。
- 旧工作区 skills 目录不迁移、不扫描（生产环境无存量）。

### 6. article-parser 运行时目录搬家

- `.dogear/skills/article-parser/` → `.dogear/article-parser/`（wechat.py、history.jsonl、common.md、SKILL.md 等整目录）。
- `article-parser-skills-service.ts`：`getArticleParserSkillsDir()` 改新路径；`ensureSkillsInitialized()` 开头做一次性迁移——旧目录存在且新目录不存在时 `rename` 整目录，顺带删除 `.dogear/skills/review/` 死遗留；旧目录不存在则跳过。
- 引用方（article-service.ts、article-parse-tools.ts payload 的 skillsDir）自动跟随 service 返回值，无散落路径。

### 7. cross-session-review 删除

- 删 `resources/skill-templates/cross-session-review/` 目录（开发目录直接删；生产安装目录随下次发版更新）。
- `pi-session.ts:145`：`if (entry.name === 'cross-session-review') return ab.memory === true` 特判删除。
- `AbilityTab`：`MEMORY_SKILL_NAMES` 及记忆域 skill 渲染段删除。
- `skill-loader.ts:82`：工具描述中示例文案换为 `article-parser / brainstorming`。
- 子会话 Profile 的 `enabledAbilities.skills` 若历史配置含 cross-session-review，过滤时自然不命中（模板已删），无需清理逻辑。

## 模块边界

| 文件 | 改动 |
|------|------|
| `app/settings/page.tsx` | 布局改顶部 tab + 居中容器 |
| `app/settings/AbilityTab.tsx` | 重构：双胶囊视图 + 工作区 Select + 联动开关 + 跳转定位（超 300 行拆 `AbilitySkillView` / `AbilityToolGroupView`） |
| `app/settings/AbilityCard.tsx` | 删除 |
| `app/settings/SubAgentTab.tsx` | workspaceId 改本地初始化（getAll + getDefault） |
| `electron/main/services/skill-service.ts` | custom 目录全局化 |
| `electron/main/agents/pi-session/pi-session.ts` | customSkillsDir 改路径 + 删 cross-session-review 特判 |
| `electron/main/services/article-parser-skills-service.ts` | 运行时目录搬家 + 一次性迁移 + 清死遗留 |
| `electron/main/agents/pi-session/skill-loader.ts` | 描述文案 |
| `resources/skill-templates/cross-session-review/` | 删除 |

## 数据流

- **能力页加载**：`getAll` + `getDefault` → workspaceId；并行 `getRegisteredTools`（活跃会话的工具明细，无会话为空）+ `listToolPacks(workspaceId)` + `listSkillTemplates()` + `listSkills(workspaceId)` + `getSystemPromptSegments()` + `getWorkspaceConfig(workspaceId)`。
- **切换工作区**：Select onChange → 重拉 packs / skills / config（提示词段、模板、常驻组与工作区无关，不重拉）。
- **skill 开关**：本地按联动规则算出下一组 `enabledSkills` + `enabledToolPacks` → `updateWorkspaceConfig` → 用返回的 merged config 更新标注状态。
- **渲染期会话注册变化**：不监听，保持现状（进入 tab 时拉一次）。

## 错误处理 / 边界情况

- **零工作区**：可选/自定义段显示「请先创建工作区」引导，开关禁用；内置段正常。
- **无活跃会话**：`getRegisteredTools` 为空 → 工具组视图条目显示「会话启动后才有工具明细」现状文案；组本身的开关/描述仍可操作。
- **`.dogear/skills/` 不存在**：扫描返回空列表，不报错。
- **迁移冲突**：新目录已存在（重复启动）则跳过 rename，幂等；rename 跨盘失败等异常 catch 后仅记日志、保留旧目录继续用旧路径逻辑兜底（getArticleParserSkillsDir 以旧目录存在性回退）。
- **生产环境历史 config**：已有挂载直接被新 UI 正确显示，无需数据迁移。

## 未决问题

- 提示词段区/工具组区的分组标题措辞（「内置 · 全局生效」「按工作区挂载」等），实施时按视觉稿微调。
- 工具组视图内常驻组与可选包的排序（暂定常驻在前、可选在后，可选按 tool-packs.ts 声明序）。
