---
step: 2
title: 数据聚合与 tipc 路由改造
status: done
---

## 目标
listBrowserData 输出登录清单视图数据，新增「登出登录账号」「移除登录条目」两个 tipc 路由，登出升级为彻底清除。

## 依赖上下文（接力棒输入）
- 前置 step 产出：[step1-login-observer.md] 新增 login-observer.ts，关键签名以其实施回填为准
- 当前关键文件状态：`electron/main/tipc/browser-data.ts` 现有路由 listBrowserData / logoutBrowserDomain / clearBrowserDomainData / clearBrowserCache / clearAllBrowserData；`browser-data-service.ts` 的 `clearDomainData(domain)` 已实现清 cookie + storage 全类型
- 关键决策回顾：兼容策略——listBrowserData 新增 `loginAccounts` 字段、保留原 `domains` 字段，step3 面板切换后才删旧字段；登出登录账号 = clearDomainData 核心 + 清单移除条目

## 计划改动
- [x] `browser-data-service.ts`：
  - `BrowserDataOverview` 新增 `loginAccounts: LoginAccountView[]`（`{ domain, firstLoginAt, lastLoginAt, evidence }`，来自清单文件）
  - 新增 `logoutLoginAccount(domain)`：调 `clearDomainData` 核心 + login-observer 移除清单条目
  - 新增 `removeLoginAccount(domain)`：仅移清单条目不动数据；`logoutDomain` 保留至 step3 移除
- [x] `electron/main/tipc/browser-data.ts`：新增 `logoutLoginAccount({ domain })` / `removeLoginAccount({ domain })` 路由
- [x] 验证：build:electron + lint 通过；前端 `client.logoutLoginAccount` 类型可引用

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
  - 计划只提了 browser-data-service / tipc 两处，实际多改了 `login-observer.ts`：按 Step 1 接力棒要求在外部不动 `saveLoginAccounts`，新增 `removeLoginAccountEntry(domain)` 扩展接口（操作内存态清单 + 立即落盘，不走 debounce），`removeLoginAccount` 转发到它
  - `loginAccounts` 聚合按 `lastLoginAt` 倒序（最近登录在前），计划未指定，属展示层补充决策
- 改动文件清单：
  - `electron/main/services/browser/login-observer.ts`：新增 `removeLoginAccountEntry(domain): Promise<boolean>`（条目不存在返回 false；try-catch + console.error）
  - `electron/main/services/browser/browser-data-service.ts`：新增 `LoginAccountView` 接口；`BrowserDataOverview` 新增 `loginAccounts: LoginAccountView[]`；`listBrowserData` 并行聚合清单（`loadLoginAccounts()` + try-catch 降级空数组）；新增 `logoutLoginAccount(domain)`（`clearDomainData` 核心 + 移除清单条目）、`removeLoginAccount(domain)`（仅移条目）；`logoutDomain` / `logoutBrowserDomain` 按计划保留未动
  - `electron/main/tipc/browser-data.ts`：新增 `logoutLoginAccount` / `removeLoginAccount` 两路由（`input<{ domain: string }>`，与现有写法一致）
- 验证：`bun run build:electron` 通过；`bun run lint` 零错误且三个改动文件无新增 warning；渲染端 `client` 经 `createClient<Router>` 自动推导新路由类型

### 给下一步的接力棒
- 关键签名 / 数据结构：
  - 渲染端：`client.listBrowserData()` 返回新增 `loginAccounts: { domain, firstLoginAt, lastLoginAt, evidence: 'oauth-callback' | 'login-post' | 'init-heuristic' | 'init-webai-storage' }[]`（按 lastLoginAt 倒序）；`client.logoutLoginAccount({ domain })` → `{ removedCookies, origins }`；`client.removeLoginAccount({ domain })` → `boolean`（false = 清单无此条目）
  - 主进程：`removeLoginAccountEntry` 立即落盘不 debounce；`logoutLoginAccount` 先清数据后移条目，清数据失败则条目保留（可重试）
- 下个 step 该从哪里继续：step3 面板切换——`app/data-center/browser-data-panel.tsx` 数据源从 `overview.domains` 切到 `overview.loginAccounts`，登出按钮改调 `client.logoutLoginAccount`，然后删除旧字段链路（`BrowserDataOverview.domains`、`BrowserDomainData`、`logoutDomain`、`logoutBrowserDomain` 路由、面板中 `logoutBrowserDomain` 调用点）
- 待办或已知限制：
  - 清单读取在 `listBrowserData` 中每次都读文件（`loadLoginAccounts` 直读不走内存态），若 observer 有未落盘的 debounce 修改，展示可能滞后最多 3s，可接受
  - login-observer ↔ browser-data-service 存在静态循环导入（ESM 函数声明，运行时调用安全，与 Step 1 动态 import 初始化不冲突）
