---
step: 4
title: 数据中心浏览器数据面板
status: pending
---

## 目标

数据中心新增「浏览器数据」面板：按域名展示登录态与占用，支持按域登出/清除数据、清理缓存、全部清除，全部走二次确认。

## 依赖上下文（接力棒输入）

（待 Step 1 回填：全局分区名与获取方式。与 Step 2/3 无强依赖，可并行。）

已知：
- 数据中心五面板结构见 `docs/codebase-map/data-center.md`（执行时读，按现有面板模式加第六个）
- Electron API：`session.fromPartition(分区名)` → `cookies.getAll()` / `cookies.remove()` / `clearStorageData({origins?, storages?})` / `clearCache()` / `getCacheSize()`
- 确认弹窗：`stores/confirm-store.ts` 的 `showConfirm()`

## 计划改动

- [ ] 新增 `electron/main/services/browser/browser-data-service.ts` —
  - `listBrowserData()`：全局分区 cookies.getAll 按 domain 聚合（strip 前导点 + 内置多段后缀表归注册域，后缀表参考 plan.md 全局决策），返回 `[{domain, cookieCount, hasLoginHint}]` + 缓存大小 + 分区目录磁盘占用（异步 du）
  - `logoutDomain(domain)` / `clearDomainData(domain)`：从该域 cookie 构造 origins 集合（https://{host}）clearStorageData + 逐 cookie remove 兜底
  - `clearCache()` / `clearAll()`
- [ ] 新增 `electron/main/tipc/browser-data.ts` — 上述能力 IPC 路由（tipc 红线）
- [ ] 数据中心 — 「浏览器数据」面板：分区占用/缓存大小概览 + 域名列表（登录态标识、cookie 数）+ 每域「登出」「清除数据」+ 面板级「清理缓存」「全部清除」；全部 showConfirm，文案提示 agent 浏览器任务可能受影响；操作后刷新列表
- [ ] `bun run build:electron` + 手工验证

## 验证

- 面板能看到真实登录域名（如 chat.deepseek.com、xiaohongshu.com），数量与实际相符
- 「登出」某域 → 白嫖框/agent 访问该站变未登录；其余域不受影响
- 「清理缓存」→ 占用数字下降、站点功能正常
- 「全部清除」→ 域名列表清空、各站回到未登录
- agent 正在跑浏览器任务时操作，确认弹窗有风险提示

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
