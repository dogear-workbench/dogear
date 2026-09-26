---
step: 3
title: 数据中心面板视图重组
status: done
---

## 目标
面板改为「我的登录」区（登出 + 清除数据）与「其他站点数据」区（仅清除数据），加准确性提示与移除误报入口，收尾同步 codebase-map。

## 依赖上下文（接力棒输入）
- 前置 step 产出：[step2-aggregate-routes.md] listBrowserData 含 loginAccounts 字段，新路由签名以其实施回填为准
- 当前关键文件状态：`app/data-center/browser-data-panel.tsx` 现结构——顶部统计卡 + 「有会话 Cookie」区（logoutDomain 调用）+「其他域名」折叠区；`app/data-center/browser-domain-names.ts` 提供域中文名
- 关键决策回顾：登出=本地清除不通知服务端；agent 流量登录也进清单属正常，手动移除兜底；不做登录态过期检测，提示文案兜底

## 计划改动
- [x] `app/data-center/browser-data-panel.tsx` 视图重组：
  - 「我的登录」区：遍历 `overview.loginAccounts`，显示中文名/域名 + 最近登录时间 + 证据徽章；操作 = 「登出」（confirm 文案注明「本地清除该站全部会话数据（Cookie、本地存储、IndexedDB），不通知服务器」+ agent 风险提示）与「清除数据」；每条带「移除」入口（confirm 说明「仅移出登录清单，不动站点数据」）
  - 「其他站点数据」区：原 domains 中不在登录清单的域，只有「清除数据」；原「有会话 Cookie」启发式分区与徽章逻辑删除
  - 顶部常驻提示：「登录状态由系统自动检测，可能不准确；误报可点条目上的移除」
  - 移除 `logoutDomain` 相关调用；`browser-data-service.ts` 删除 `logoutDomain`、`BrowserDataOverview.domains` 旧字段及 tipc `logoutBrowserDomain` 路由（兼容期结束）
- [x] 同步 `docs/codebase-map/`（数据中心/浏览器功能文件，补 login-observer 与新路由描述）
- [x] 验证：lint + vite build 通过；手动走查——登录区三站可见、登出 deepseek 后网页 AI 内变未登录且从清单消失、移除某条仅清单变化、其他站点区无登出按钮、全部清除后登录区清空（自动化验证全过，手动走查待真机，见待办）

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
  1. **`BrowserDataOverview.domains` 字段与聚合逻辑未完全删除，而是剥离启发式保留精简版**（`BrowserDomainData` 缩为 `{ domain, cookieCount }`）：因计划同时要求「其他站点数据」区展示「原 domains 中不在登录清单的域」，全删 domains 则该区无数据源；实际删除的是旧链路中的启发式部分（`hasLoginHint` 字段、聚合中 `looksLikeLoginCookie` 判定）与登出链路（`logoutDomain` 函数 + `logoutBrowserDomain` 路由 + 面板调用点）
  2. **联动改了 `login-observer.ts`（计划外）**：其 `migrateInitialLoginAccounts` 原消费 `listBrowserData().domains[].hasLoginHint`，启发式删除后改调新增导出的 `loginHintDomains()`（同一启发式逻辑收拢在 service 内），同时解除 observer 对 listBrowserData 的依赖
  3. 顺带简化 `clearOriginsStorage`：删掉原仅 logoutDomain 使用的 `storages` 可选参数
  4. 统计卡第三格「站点 / Cookie」改为「登录站点 / Cookie」（loginAccounts.length），原 domains.length 无意义
- 改动文件清单：
  - `electron/main/services/browser/browser-data-service.ts` — 删 `logoutDomain`、`BrowserDomainData.hasLoginHint`；新增 `loginHintDomains(): Promise<string[]>` 导出；聚合去启发式；`clearOriginsStorage` 签名简化
  - `electron/main/services/browser/login-observer.ts` — 迁移段改用 `loginHintDomains()`
  - `electron/main/tipc/browser-data.ts` — 删 `logoutBrowserDomain` 路由
  - `app/data-center/browser-data-panel.tsx` — 视图重组：常驻准确性提示 +「我的登录」区（LoginRow：中文名/域名 + 证据徽章 + 最近登录时间；登出 logoutLoginAccount / 清除数据 / 移除 removeLoginAccount）+「其他站点数据」折叠区（OtherDomainRow 仅清除数据）；删会话 Cookie 启发式分区与徽章
  - `docs/codebase-map/browser.md` / `data-center.md` — 补 login-observer 条目、更新数据管理与面板描述

### 给下一步的接力棒
- 关键签名 / 数据结构：`BrowserDataOverview = { cacheSize, diskUsage, totalCookies, domains: { domain, cookieCount }[], loginAccounts: { domain, firstLoginAt, lastLoginAt, evidence }[] }`；渲染端 tipc 路由现六个：listBrowserData / logoutLoginAccount / removeLoginAccount / clearBrowserDomainData / clearBrowserCache / clearAllBrowserData
- 下个 step 该从哪里继续：本 step 为最后一步，无后续实施；手动走查清单见上方「验证」段（登录区三站可见/登出 deepseek/移除仅清单变化/其他区无登出/全部清除后清空），需真机确认
- 待办或已知限制：登录清单读取走文件直读，observer 有未落盘 debounce 修改（3s 窗口）时展示可能短暂滞后；登录态检测无过期检测，靠常驻提示 + 手动移除兑底
