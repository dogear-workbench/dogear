# 登录账号管理 实施计划

**目标**：数据中心从「cookie 管理器」升级为「账号登录管理器」——自动观测登录动作维护「我的登录」清单，登录区支持彻底登出，其他站点只保留清除数据。

**架构思路**：主进程登录观测器挂全局分区 `session.webRequest`（URL 特征为主、Set-Cookie 佐证、从严宁漏勿误），清单落 `.dogear/login-accounts.json`；一次性初始化迁移（cookie 启发式 ∪ 网页 AI 站点有 IndexedDB 痕迹）；数据中心按清单分区渲染。排除逐站探测登录态（每站定制成本高）与每次启动重跑启发式（误报复活）。

**涉及模块**：
- 新增 `electron/main/services/browser/login-observer.ts`
- 改 `electron/main/services/browser/browser-data-service.ts`
- 改 `electron/main/tipc/browser-data.ts`
- 改 `app/data-center/browser-data-panel.tsx`
- 改 `electron/main/main-app.ts`（启动挂载观测器）
- 完成后同步 `docs/codebase-map/`（并入 step3 收尾）

## 步骤索引

- [x] [Step 1: 登录观测器 + 清单存储 + 初始化迁移](./step1-login-observer.md) — 观测登录事件写入清单 JSON，跑一次性初始化
- [x] [Step 2: 数据聚合与 tipc 路由改造](./step2-aggregate-routes.md) — listBrowserData 融合登录清单，新增登出/移除路由，登出升级为彻底清除
- [x] [Step 3: 数据中心面板视图重组](./step3-panel-rework.md) — 「我的登录」区与「其他站点数据」区，准确性提示与移除入口，收尾同步 codebase-map

## 全局决策

- **清单文件**：`userData/.dogear/login-accounts.json`（与 settings.json 同级），结构 `{ version: 1, initialized: boolean, accounts: [{ domain, firstLoginAt, lastLoginAt, evidence }] }`；evidence 枚举 `oauth-callback | login-post | init-heuristic | init-webai-storage`（Set-Cookie 仅佐证不单独成证据）
- **域名归一化**：复用 `browser-data-service.ts` 的 `registeredDomain`（step1 将其导出），清单与 cookie 聚合用同一套注册域逻辑
- **从严判定**：URL 特征命中才记录（POST + `/login|/signin|/auth|/oauth` 路径，或回调 URL 带 `code=`）；Set-Cookie 只影响置信不改判定；同域重复命中仅更新 `lastLoginAt`
- **兼容策略**：step2 的 `listBrowserData` 采用「新增 `loginAccounts` 字段、保留原 `domains` 字段」，step3 面板切换后删除旧字段——保证每个 step 交付时应用可构建可用
- **错误处理**：观测器与清单读写全程 try-catch，异常只 `console.error`，绝不影响 webRequest 链路；初始化标记 `initialized: true` 在成功写入清单后落盘
- **主进程改动需 `bun run build:electron` 重新编译**；每步交付前 `bun run lint` 零错误 + 构建通过
- 不写注释（项目硬约束），WHY 非显而易见时一行

## 完成总结

三步全部完成（2026-09-26）：

- **Step 1**（315afa4f）：新增 `login-observer.ts`——全局分区 webRequest 从严观测登录动作（oauth-callback / login-post），去抖写入 `.dogear/login-accounts.json`；首启跑 cookie 启发式 ∪ 网页 AI IndexedDB 痕迹一次性迁移（initialized 标记防误报复活）；main-app.ts 启动挂载
- **Step 2**（20d100a8）：`BrowserDataOverview` 新增 `loginAccounts` 字段（lastLoginAt 倒序）；新增 `logoutLoginAccount`（clearDomainData 彻底清除 + 移清单条目）与 `removeLoginAccount`（仅移条目）及对应 tipc 路由；observer 扩展 `removeLoginAccountEntry` 保持内存态一致性
- **Step 3**：面板重组为「我的登录」（登出/清除数据/移除三操作，证据徽章 + 最近登录时间）与「其他站点数据」（仅清除数据）两区，常驻准确性提示；删除旧链路（logoutDomain / logoutBrowserDomain / hasLoginHint 启发式），启发式收拢为 `loginHintDomains()` 供迁移用；`domains` 剥离启发式保留精简版（其他站点区数据源）；codebase-map 已同步

**待真机验证**：启动后 login-accounts.json 生成且含 deepseek/doubao/kimi；登出某站后网页 AI 内变未登录且从清单消失；移除条目仅清单变化；全部清除后登录区清空。dev 环境 userData 为 Dogear-Dev。
