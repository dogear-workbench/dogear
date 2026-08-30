---
step: 2
title: plan 文档路径链接可点
status: done
---

## 目标

任务详情渲染 plan 文档时，正文里的相对路径（`docs/plans/**.md`、`components/**.tsx` 等）渲染为可点胶囊，md 点击弹浮窗预览；其余场景 MarkdownRenderer 行为不变。

## 依赖上下文（接力棒输入）

- 设计文档第三节「plan 链接修复」；背景：正文路径识别曾因「agent 提到的路径可能未落盘」被整体移除，本步只在 TaskDetail 场景开启
- 复用基础设施：`components/agent-chat/path-link.tsx`——`splitPathSegments` / `resolvePathInWorkspace`（白名单扩展名 + resolve 后限工作区内，前缀 lowercase 比较）、`PathChip`（点击走 markdown-preview-store.open 弹浮窗）、`useWorkspacePath`
- 当前 `components/MarkdownRenderer.tsx`：GFM + 代码高亮，p/li 文本仅搜索高亮
- TaskDetail 渲染处：`components/notes/TaskDetail.tsx`「计划文档」节 `<MarkdownRenderer content={detail.planContent} />`
- **开工先读**：`path-link.tsx` 全文 + `stores/markdown-preview-store.ts` 的 open 签名（确认支持哪些扩展名预览）；`resolvePathInWorkspace` 的入参（绝对 workspacePath 还是 Context）

## 计划改动

- [ ] `components/MarkdownRenderer.tsx` 加可选 props `{ workspacePath?: string }`：传入即开启路径链接，不传行为完全不变（全局调用点零改动）
  - 链接两种来源都处理：markdown 链接语法 `[text](relative/path.md)` 渲染出的 `<a>`（拦截 onClick preventDefault，resolve 成功且白名单内走浮窗，否则放行为普通不可点文本）；正文裸路径文本（含反引号外）按 path-link 规则识别为 PathChip
  - 路径解析失败/越出工作区/非白名单 → 回退纯文本，不渲染可点样式
- [ ] `components/notes/TaskDetail.tsx` 传 `workspacePath` 开启
- [ ] 验证 `detail.result`（结果摘要）不开启（agent 生成文本路径落盘率低，维持纯文本）

## 验收

- 打开 z48gab9u（笔记协作与页面重做）任务详情：plan 里引用的 step 文档相对路径可点并弹浮窗；`.tsx` 代码路径按白名单能力呈现（可预览扩展名可点，其余纯文本）
- 其他 MarkdownRenderer 调用点（Dashboard 报告、消息正文、result 摘要）渲染无任何变化
- lint + tsc 通过

## 实施回填（做完后填）

### 实际改动
- 与计划差异：裸路径胶囊复用 PathChip 组件而非重写；`<a>` 场景白名单与裸路径一致（md/markdown/txt/json）；非白名单路径链接回退为纯文本 span（不可点），外部 URL（scheme:开头）维持 window.open 现状
- 改动文件清单：
  - `components/agent-chat/path-link.tsx`：导出 ALLOWED_EXT_RE；新增 `useWorkspaceIdByPath(workspacePath)`（复用 workspacePathsCache 反查，focused workspace 直接命中）
  - `components/MarkdownRenderer.tsx`：props 新增可选 `workspacePath`；开启时 p/li 的 string 子节点走 splitPathSegments→PathChip（与搜索高亮互斥，路径场景无搜索词）；`<a>` 相对路径 resolve+白名单→胶囊开浮窗，失败→纯文本；不传时行为与之前完全一致（全局调用点零改动）
  - `components/notes/TaskDetail.tsx`：计划文档节 MarkdownRenderer 传 workspacePath；result 摘要不传（维持纯文本）

### 给下一步的接力棒
- 关键签名 / 数据结构：`<MarkdownRenderer content workspacePath? />`；`useWorkspaceIdByPath(path) → workspaceId | null`（异步缓存未命中时先 null 后重渲染）
- 下个 step 该从哪里继续：Step 3 Tiptap 核心替换（NoteEditor 正文区）
- 待办或已知限制：真机验收（点开任务详情看 plan 链接胶囊）待用户进行；路径链接胶囊样式与 PathChip 同源（teal 色系）
