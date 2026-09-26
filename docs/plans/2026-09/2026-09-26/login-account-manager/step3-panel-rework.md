---
step: 3
title: 数据中心面板视图重组
status: pending
---

## 目标
面板改为「我的登录」区（登出 + 清除数据）与「其他站点数据」区（仅清除数据），加准确性提示与移除误报入口，收尾同步 codebase-map。

## 依赖上下文（接力棒输入）
- 前置 step 产出：[step2-aggregate-routes.md] listBrowserData 含 loginAccounts 字段，新路由签名以其实施回填为准
- 当前关键文件状态：`app/data-center/browser-data-panel.tsx` 现结构——顶部统计卡 + 「有会话 Cookie」区（logoutDomain 调用）+「其他域名」折叠区；`app/data-center/browser-domain-names.ts` 提供域中文名
- 关键决策回顾：登出=本地清除不通知服务端；agent 流量登录也进清单属正常，手动移除兜底；不做登录态过期检测，提示文案兜底

## 计划改动
- [ ] `app/data-center/browser-data-panel.tsx` 视图重组：
  - 「我的登录」区：遍历 `overview.loginAccounts`，显示中文名/域名 + 最近登录时间 + 证据徽章；操作 = 「登出」（confirm 文案注明「本地清除该站全部会话数据（Cookie、本地存储、IndexedDB），不通知服务器」+ agent 风险提示）与「清除数据」；每条带「移除」入口（confirm 说明「仅移出登录清单，不动站点数据」）
  - 「其他站点数据」区：原 domains 中不在登录清单的域，只有「清除数据」；原「有会话 Cookie」启发式分区与徽章逻辑删除
  - 顶部常驻提示：「登录状态由系统自动检测，可能不准确；误报可点条目上的移除」
  - 移除 `logoutDomain` 相关调用；`browser-data-service.ts` 删除 `logoutDomain`、`BrowserDataOverview.domains` 旧字段及 tipc `logoutBrowserDomain` 路由（兼容期结束）
- [ ] 同步 `docs/codebase-map/`（数据中心/浏览器功能文件，补 login-observer 与新路由描述）
- [ ] 验证：lint + vite build 通过；手动走查——登录区三站可见、登出 deepseek 后网页 AI 内变未登录且从清单消失、移除某条仅清单变化、其他站点区无登出按钮、全部清除后登录区清空

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
