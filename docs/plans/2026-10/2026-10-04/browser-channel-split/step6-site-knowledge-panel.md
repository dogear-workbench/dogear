---
step: 6
title: 站点档案展示
status: done
---

## 目标

数据中心「浏览器数据」面板新增站点档案区块：域名列表 + 档案全文查看 + 删除，用户首次可见 agent 沉淀了哪些站点知识。

## 依赖上下文（接力棒输入）

- 设计定案：[design.md](./design.md) 目标 3（站点档案进数据中心浏览器面板，不改存储结构）
- 关键现状：
  - `electron/main/services/browser/site-knowledge-service.ts`：站点档案存储（`.dogear/site-knowledge/{domain}.md` 两区：正式地图 + 探索发现）、normalizeDomain / appendSiteFinding——目前只有 agent 工具读写
  - `electron/main/tipc/browser-data.ts`：数据中心浏览器数据路由（list / logoutLoginAccount / clear domain / clear all 等）
  - `app/data-center/browser-data-panel.tsx`：现面板（域名列表按登录态分组折叠 + 中文名映射）
  - 站点档案与登录清单的域名口径可能不一致（档案按 normalizeDomain，登录清单按注册域聚合）——列表各自独立渲染，不做合并
- 关键决策回顾：只加展示，不动 site-knowledge 存储与 agent 工具语义；「有哪些手册」= 档案 md 全文查看（Markdown 渲染）。

## 计划改动

- [ ] `site-knowledge-service.ts`：补列表接口（扫描目录 → domain + mtime + 大小，normalizeDomain 排序）与读取/删除接口（删除走回收站语义则对齐项目删除惯例，实施时看现状定——纯文件删除即可）
- [ ] `tipc/browser-data.ts`：新路由 listSiteKnowledge / readSiteKnowledge / deleteSiteKnowledge（权限对齐同文件既有路由）
- [ ] `app/data-center/browser-data-panel.tsx`：新增「站点档案」区块——域名列表（含更新时间）、点开看档案全文（复用 MarkdownRenderer）、删除按钮（走 confirm-store showConfirm，红线禁 window.confirm）
- [ ] 空态文案：尚无档案时引导（agent 探索站点后自动沉淀，可先跑一次小红书/知乎调研试试）
- [ ] 验证：dev 打开数据中心浏览器面板，列表/查看/删除全链路；与登录账号区块互不影响

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
  1. 读取接口未新增服务层函数——既有 `readSiteKnowledge(domain)`（含 8KB 截断）直接暴露为 tipc 路由
  2. 删除选纯文件删除（`fs.rmSync`）：grep 确认项目无回收站惯例（无 shell.trashItem），按计划授权走纯删除
  3. 列表/删除接口放 `site-knowledge-service.ts` 而非 browser-data-service（站点知识内聚归属；存储与 agent 工具语义未动）；`browser-data-service.ts` 零改动
  4. 前端查看形态用 Dialog（对齐 ToolDetailDialog 既有模式）复用 MarkdownRenderer；列表刷新并入既有 useVisiblePolling 轮询（load 改 Promise.all 并拉两接口），未另起轮询
- 改动文件清单：
  - `electron/main/services/browser/site-knowledge-service.ts`：新增 `SiteKnowledgeEntry`、`listSiteKnowledge()`（扫目录 → normalizeDomain 过滤 → mtime + size → 域名排序）、`deleteSiteKnowledge(domain): boolean`；`knowledgeDir()` 提取
  - `electron/main/tipc/browser-data.ts`：新路由 `listSiteKnowledge` / `readSiteKnowledge` / `deleteSiteKnowledge`（裸 procedure，权限对齐同文件既有路由）
  - `app/data-center/browser-data-panel.tsx`：新增「站点档案」独立 Card（域名行：中文名映射 + 域名 + 更新时间 + 大小；点行开 Dialog 看全文；删除走 showConfirm）；空态引导文案（agent 站点调研沉淀）；viewTokenRef 防关闭后迟到响应重开 Dialog；`lastLoginText` 重命名 `relativeTimeText`

### 给下一步的接力棒
- 关键签名 / 数据结构：`SiteKnowledgeEntry { domain, updatedAt(mtimeMs), size(bytes) }`；tipc 入参均为 `{ domain }`
- 下个 step 该从哪里继续：按 plan.md 顺序接 step 7（若有）；站点档案链路已闭环（agent 写 → 用户看/删），无遗留代码待办
- 待办或已知限制：真机验证未跑（见共享区 step6 交付文档遗留问题区）；档案全文查看沿用服务层 8KB 截断语义
