---
step: 6
title: 站点档案展示
status: pending
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
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
