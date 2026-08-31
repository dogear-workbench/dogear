# 体验优化四件套 设计

**日期**：2026-08-31
**背景**：日常使用反馈的四类体验问题——左侧列表「一眼认不出哪个是哪个」、亮色主题长时间阅读不舒适、Edit 工具无差分视图、dogear__ 自定义工具渲染与 Bash 无差别。

**目标**：列表视觉层级对齐用户心智（话题是查找锚点）；提供两套阅读优先的配色；Edit 显示行级差分；dogear__ 业务动作工具渲染为「成果卡片」。

---

## ① 左侧列表视觉层级翻转

**架构**：话题标题从 `text-xs text-muted-foreground` 升格为主视觉：13px / `text-foreground` / `font-medium`。会话行（ConversationRow）**原地不动**——不缩字号、不动图标与按钮浮层布局，层级差由话题变强自然形成。话题卡片增强容器感：hover / selected 态加重。

**排除**：会话行加首条消息摘要（方案 B）——信息密度顾虑，用户明确担心信息爆炸，观察使用后再议；AI 给每个会话起名（方案 C）——依赖提炼时机、额外 LLM 成本，YAGNI。

**模块边界**：`components/group-list/GroupCard.tsx`（标题样式 + 卡片态）、`components/conversation-list/RecentVirtualGroup.tsx` / `SmartSection.tsx` / `ManualSection.tsx`（分组标题样式如需对齐）。

## ② 两套阅读优先主题 + 切换开关

**架构**：重调现有 CSS 变量组（弃用现 `.dark` 的 #0C0C0C 纯黑）：

| 变量 | 暖纸亮 | 墨蓝暗 | 参照 |
|------|--------|--------|------|
| background | `#F6F1E7` | `#1E242C` | iA Writer / GitHub Dark Dimmed |
| foreground | `#33302B` | `#C6CBD2` | 对比度均 ~10:1（阅读舒适区 7~11:1） |
| card | `#FCF9F2` | `#252C36` | |
| border | 跟随暖调 | `#343D49` | |

- 主色燃烧橙 `#E8590C` 两套保留，暗色下微调亮化（实施时定）
- 长文区 `.font-reading` 局部再降正文对比（UI 元素保持清晰）
- 切换：亮 / 暗 / 跟随系统（`nativeTheme.shouldUseDarkColors` 监听 + 标题栏联动），入口在设置页基础 tab，`AppSettings` 加字段，经 `broadcastSettingsChanged` 多窗口同步
- 硬编码调色板类清理（现 284 处）：核心区域（工具块、状态徽章、卡片底、消息区）一期必须清，边角分批；策略是换成语义变量或 `dark:` 变体

**排除**：暖纸外的中间色（雾灰/深蓝夜）——架构无差别随时可加；字体选择开关（二期候选）；主题色 accent 自选（产品识别色不动）。

**模块边界**：`src/globals.css`（变量组重调 + `@custom-variant dark` 已有）、`types/settings.ts` + `electron/main/`（设置字段）、设置页基础 tab、各组件硬编码色清理（分批清单实施时列）。

## ③ Edit 行级差分（零依赖自写）

**架构**：不用 git（渲染层不能起子进程，`diff --no-index` 需解析输出，进程编排成本 > 收益）、不引 jsdiff（决定性理由：其 `diffWords` 按空格分词，连续中文被当作单个词，词级高亮对中文退化为整行；`diffChars` 则碎片化。前后缀裁剪法对中文天然细粒度，本项目场景中文为主）。

- LCS 行级差分纯函数（~100 行）：oldText/newText 按行拆分 → 统一 diff 输出（上下文行淡显 / 删除行红底 `−` / 新增行绿底 `+`）
- 行内词级高亮：公共前后缀裁剪法（一行内相同的头尾不变，中间标变化），中文与代码标识符场景均细粒度
- 收起态标题行摘要升级：`文件名 · +12 −3 行`（替换多处时合计）
- 样式匹配 Editorial 风格，支持 `dark:` 适配

**模块边界**：新文件 `components/agent-chat/tool-renderers/line-diff.ts`（纯函数）+ `FileChangeRenderer.tsx`（edit 分支改用行级差分渲染）+ `ToolBlock.tsx` 摘要函数。

## ④ dogear__ 成果卡片 + 跳转

**架构**：dogear__ 业务动作工具与 Bash 的本质区别是「产出了用户关心的实体」，渲染为成果卡片：收起态标题行业务语义（「派遣子会话 · 任务摘要」「保存记忆 · 标题」），展开态结构化摘要（非 KeyValueList），配 lucide 简笔彩色图标，`headerActions` 放跳转按钮。

一期工具与设计：

| 工具 | 图标（lucide） | 收起态 | 跳转 |
|------|---------------|--------|------|
| `dogear__CreateSession` / `CreateSessionBatch` | Network（与会话列表子会话图标一致） | 派遣子会话 · 任务摘要前段 | `client.getById` → `openOrFocusConversation` |
| `dogear__SaveMemory` | Brain | 保存记忆 · title | 无（数据中心无深链，卡片展示足够） |
| `dogear__CreateNote` / `UpdateNote` / `AppendNote` | StickyNote | 创建/更新笔记 · 卡片标题 | 切笔记 tab + `setActiveNoteId` |
| `dogear__CreateTask` / `ExecuteTask` | ListTodo | 挂载/执行任务 · 任务标题 | `task-focus-store` 深链（通知同款基建） |

- 查询类工具（List/Read/Recall 系列）保持 ToolDetailShell 现状
- `ToolBlock.tsx` 路由表扩展 + `TOOL_ICONS` 补条目；每工具一个 renderer 文件（`tool-renderers/`）

**错误处理 / 边界情况**：
- Edit 差分：oldText/newText 为空（纯增/纯删）全行单色；超长块（>500 行）截断显示前 N 行差分并提示；LCS 对超长输入退化处理（按整块替换显示）
- 跳转：目标实体已被删除（笔记/任务）时按钮隐藏或 toast 提示；子会话 getById 失败静默降级为无跳转
- 主题：跟随系统模式下「暖纸/墨蓝」二态切换，无中间态；nativeTheme 不可用时回退手动
- 硬编码色清理遗留页（数据中心/设置）在暗色下的对比度问题，分批修不阻塞上线

**未决问题**（实施时定）：
- 暗色下主色橙是否需要单独亮化变体
- CreateSessionBatch 的多会话卡片布局（一卡多行 vs 多卡）
- 硬编码色清理的批次划分与验收口径
