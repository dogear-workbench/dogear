---
step: 2
title: 数据聚合与 tipc 路由改造
status: pending
---

## 目标
listBrowserData 输出登录清单视图数据，新增「登出登录账号」「移除登录条目」两个 tipc 路由，登出升级为彻底清除。

## 依赖上下文（接力棒输入）
- 前置 step 产出：[step1-login-observer.md] 新增 login-observer.ts，关键签名以其实施回填为准
- 当前关键文件状态：`electron/main/tipc/browser-data.ts` 现有路由 listBrowserData / logoutBrowserDomain / clearBrowserDomainData / clearBrowserCache / clearAllBrowserData；`browser-data-service.ts` 的 `clearDomainData(domain)` 已实现清 cookie + storage 全类型
- 关键决策回顾：兼容策略——listBrowserData 新增 `loginAccounts` 字段、保留原 `domains` 字段，step3 面板切换后才删旧字段；登出登录账号 = clearDomainData 核心 + 清单移除条目

## 计划改动
- [ ] `browser-data-service.ts`：
  - `BrowserDataOverview` 新增 `loginAccounts: LoginAccountView[]`（`{ domain, firstLoginAt, lastLoginAt, evidence }`，来自清单文件）
  - 新增 `logoutLoginAccount(domain)`：调 `clearDomainData` 核心 + login-observer 移除清单条目
  - 新增 `removeLoginAccount(domain)`：仅移清单条目不动数据；`logoutDomain` 保留至 step3 移除
- [ ] `electron/main/tipc/browser-data.ts`：新增 `logoutLoginAccount({ domain })` / `removeLoginAccount({ domain })` 路由
- [ ] 验证：build:electron + lint 通过；前端 `client.logoutLoginAccount` 类型可引用

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
