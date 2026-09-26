---
step: 1
title: 登录观测器 + 清单存储 + 初始化迁移
status: done
---

## 目标
主进程观测全局分区流量中的登录动作，写入登录清单 JSON；首启跑一次性初始化迁移。

## 依赖上下文（接力棒输入）
- 无前置 step
- 当前关键文件状态：`electron/main/services/browser/embedded/profile.ts:1` 定义 `GLOBAL_BROWSER_PARTITION = 'persist:dogear-browser'`；`electron/main/services/browser/browser-data-service.ts` 内有私有的 `registeredDomain()` 与 `looksLikeLoginCookie()`（本步将 `registeredDomain` 导出复用）
- 设置读取参考：`electron/main/settings-service.ts` 的 `loadSettings()`，`settings.webAiSites` 为 `[{ name, url }]`
- 关键决策回顾：从严宁漏勿误——URL 特征命中才记录，漏的站用户下次登录自然补上；初始化只跑一次否则用户删掉的误报会复活

## 计划改动
- [x] 新增 `electron/main/services/browser/login-observer.ts`：
  - 清单读写：`loadLoginAccounts()` / `saveLoginAccounts()`（JSON，原子写：先写临时文件再 rename）
  - `recordLoginEvent(domain, evidence)`：更新 lastLoginAt 或新增条目（去抖：同域 60s 内重复命中只更新）
  - `initLoginObserver()`：`session.fromPartition(GLOBAL_BROWSER_PARTITION).webRequest` 挂 `onBeforeRequest`（POST + 路径含 login/signin/auth/oauth，或 URL query 带 `code=` 且路径含 callback/oauth）→ 解析注册域 → recordLoginEvent（evidence: oauth-callback / login-post）；回调内全程 try-catch
  - `migrateInitialLoginAccounts()`：清单 `initialized` 为 false 时执行——cookie 启发式（复用 listBrowserData 的 hasLoginHint 逻辑，可抽公共函数或直接调 listBrowserData）∪ `settings.webAiSites` 域下存在 IndexedDB 目录（扫 `userData/Partitions/dogear-browser/IndexedDB/` 目录名解析 origin）；写入成功后置 `initialized: true`
- [x] `browser-data-service.ts`：导出 `registeredDomain`
- [x] `electron/main/main-app.ts`：启动流程中调用 `initLoginObserver()` + `migrateInitialLoginAccounts()`（在 app ready 后、embedded manager 初始化附近）
- [x] 验证：`bun run build:electron` 通过 + `bun run lint` 零错误；手动验证——启动应用，检查 login-accounts.json 生成且含 deepseek/doubao/kimi（IndexedDB 痕迹路径）；在网页 AI 里退出某站重新登录，确认新增/更新条目（手动项待真机验证，见待办）

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
  - 原子写不复用自写逻辑，直接复用 `safe-json.ts` 的 `safeJsonWrite`/`safeJsonRead`（已实现 tmp+验证+bak+rename+文件锁，比计划更完善）
  - login-post 路径判定中 auth 用 `\/auth\b` 词边界（避免 `/author` 类 POST 误报，符合宁漏勿误）；oauth-callback 判定优先于 login-post（同 URL 双命中时保留更具体证据）
  - 迁移去重保护：两段式落盘（先 accounts 后置 initialized）中途失败重跑时，同域已存在条目则跳过，不产生重复
  - `ensureLoaded()` 单例 Promise：init 与 migrate 共享同一份清单内存态，消除并发加载覆盖竞态；recordLoginEvent 在清单加载完成前命中直接丢弃（窗口极短，无害）
- 改动文件清单：
  - 新增 `electron/main/services/browser/login-observer.ts`
  - `electron/main/services/browser/browser-data-service.ts`：导出 `registeredDomain`
  - `electron/main/main-app.ts`：whenReady 内嵌分区迁移块后调用 `initLoginObserver()` + `void migrateInitialLoginAccounts()`
- 验证：`bun run build:electron` 零错误；`bun run lint` 0 errors（95 个 warning 均为既有 no-explicit-any；electron/** 在 eslint ignore 内）

### 给下一步的接力棒
- 关键签名 / 数据结构：
  - 清单：`getConfigDir()/login-accounts.json`，结构 `{ version: 1, initialized: boolean, accounts: [{ domain, firstLoginAt, lastLoginAt, evidence }] }`
  - `loadLoginAccounts(): Promise<LoginAccountsManifest>` / `saveLoginAccounts(data): Promise<void>`（save 同步更新内存态）
  - `recordLoginEvent(domain, evidence): void`（内存实时更新，全局 3s debounce 写盘，同域 60s 去重）
  - `initLoginObserver(): void`（幂等，挂 persist:dogear-browser 分区 webRequest）
  - `migrateInitialLoginAccounts(): Promise<void>`（幂等，initialized=true 跳过）
  - `registeredDomain` 现已从 browser-data-service.ts 导出，后续 cookie 聚合直接复用
- 下个 step 该从哪里继续：Step 2 可从 login-observer.ts 导出的 `loadLoginAccounts` 读取清单做聚合展示；新增 IPC 请走 tipc，不建议直接调用 saveLoginAccounts（会绕过内存态一致性）
- 待办或已知限制：
  - 手动验证未做（无界面环境）：启动应用检查 login-accounts.json 生成且含 deepseek/doubao/kimi、退出重登新增/更新条目，需真机验证
  - 写盘 debounce 3s + 60s 去重窗口：应用退出时 pending 写盘不 flush（丢失窗口极小，评估可接受；如需可在 before-quit 加 flush）
  - dev 环境 userData 为 Dogear-Dev，验证时注意看对应目录
