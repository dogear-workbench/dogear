# 登录账号管理 设计

**背景**：数据中心「浏览器数据」面板是纯 cookie 视角：登录态判定靠 cookie 名启发式，既漏报（deepseek 凭据在 localStorage，列表完全不显示）也误报（匿名 session cookie 被判为「有会话」）；「登出」只清 cookie，对 localStorage 认证的站点无效。用户要的不是 cookie 管理器，而是**账号登录管理器**：管理「我在哪些站登录了账号」。

**目标**：
- 自动观测登录动作（而非猜测登录状态），维护「我的登录」清单
- 数据中心视图重组：登录区（登出 + 清除数据）/ 其他站点数据区（仅清除数据），明确提示可能不准确，支持移除误报
- 「登出」升级为彻底清除该域会话数据（cookie + localStorage + IndexedDB）并移出清单，对任何认证方式的站点都真正生效

**架构**：

核心机制 = 登录事件观测。主进程新增登录观测器，挂在全局浏览器分区（`persist:dogear-browser`）的 `session.webRequest` 上，应用启动时初始化，对网页 AI、内嵌浏览器、agent 任务的全部流量生效：

- **URL 特征**（onBeforeRequest）：POST 打到 `login / signin / auth / oauth` 类路径，或 OAuth 回调 URL 带 `code=` 参数 → 记「登录事件」候选
- **Set-Cookie 佐证**（onHeadersReceived）：登录请求前后短窗口内服务端种下长效 HttpOnly 凭据类 cookie → 提升置信度
- **从严原则**：宁漏勿误。漏记的站下次登录自然补上（重新登录 = 天然的手动添加路径）；误记需要用户手动清理

一次性初始化（首次上线跑一次，做完打标记永不重跑，防止复活用户删掉的误报）：

初始清单 = cookie 会话启发式命中的域 ∪ 网页 AI 站点列表中有 IndexedDB 存储痕迹的域（后者兜 deepseek 这类 localStorage 认证站点）。

排除的选项：
- 逐站探测登录态（隐藏 tab 访问用户信息接口）——每站定制、成本高，YAGNI
- 每次启动重跑启发式——用户删掉的误报会复活
- 手动标记为主——繁琐；观测 + 重登补录更自然
- cookies onChanged 监听——Electron 未暴露该 API，Set-Cookie 只能走 onHeadersReceived

**模块边界**：
- 新增 `electron/main/services/browser/login-observer.ts`：观测、判定、清单读写、一次性初始化迁移
- 改 `electron/main/services/browser/browser-data-service.ts`：数据聚合融合登录清单；登出动作改为彻底清除（复用 clearDomainData 核心）
- 改 `electron/main/tipc/browser-data.ts`：新增登出登录账号 / 移除登录条目路由
- 改 `app/data-center/browser-data-panel.tsx`：视图重组（我的登录区 + 其他站点数据区 + 准确性提示 + 移除入口）
- 改 `electron/main/main-app.ts`：启动时初始化观测器

**数据流**：
- webview 请求 → session.webRequest → login-observer 判定 → `.dogear/login-accounts.json`（`{domain, firstLoginAt, lastLoginAt, evidence}`）
- 数据中心打开 → tipc 聚合「cookie 域列表 + 登录清单」→ 面板分区渲染
- 登出 → 清该域全部存储（cookie + localStorage + IndexedDB）+ 移出清单
- 移除误报 → 仅移出清单，不动站点数据

**错误处理 / 边界情况**：
- agent 任务流量中的登录也进清单（账号确实登录了，不算误报），不需要就手动移除
- 清单不感知站内主动退出 / token 过期（不做登录态验证），顶部提示文案兜底
- 「登出」永远是本地清除，不调站点登出接口、不通知服务端
- 观测器自身异常只 console.error，绝不影响 webRequest 请求链路
- 初始化迁移失败下次启动可重试（标记在成功写入后打）

**未决问题**（实施时定）：
- URL 特征词表初版具体词条
- Set-Cookie「凭据类名字 + 长效」的具体判定参数（有效期阈值、短窗口大小，初定 10s）
- 面板提示与确认弹窗的最终文案
