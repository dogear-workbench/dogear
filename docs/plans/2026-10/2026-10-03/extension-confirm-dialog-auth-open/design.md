# 扩展通道 P1.5：确认弹窗 + 授权放开 设计

**日期**：2026-10-03
**来源**：P1 真机验证四轮教训 + 域名授权 redesign 讨论笔记 + P0 遗留支付黑名单

## 背景

1. **确认 UI 不可见**（P1 验证 D3 定性）：提交确认横幅只渲染在伴随面板（`companion/BrowserPanel.tsx:303`），用户不开面板就永远看不到确认请求。四轮验证中用户每次都在浏览器里手动完成搜索，agent 傻等 5 分钟超时，工具回报与事实矛盾。P0 拍板的「会话内 inline 确认卡」在子会话（后台 SDK 会话）场景下同样不可见——用户根本不看那个会话流。
2. **授权清单阻碍自动化**：agent 探索时无法预知访问哪些域名，预授权清单违背「独立窗口内全自动探索」的定位。P1 后风险模型已变：agent 导览全落独立后台窗口 + 提交确认 + 支付黑名单两道动作级护栏已就位，域级授权防的东西一半已被接管（用户已拍板方案 2：独立窗口内全放开）。
3. **支付黑名单不可维护**（P0 遗留）：`PAYMENT_BLOCKED_HOSTS` 是 site-policy.ts 硬编码常量，settings 动态扩展一直未排期。授权放开后支付黑名单成为唯一域级防线，必须可维护。

## 目标

- 提交确认/人工等待以**应用级模态弹窗 + 主窗口置前抢焦点**方式直接打扰用户，不放二级栏
- 域名授权机制整体退役（三处校验 + 授权 UI + 存量数据）
- 支付黑名单 settings 化，用户可编辑

## 架构

### 确认弹窗（拦截链路零改动，只改呈现层与 outcome 枚举）

- **呈现**：渲染层新组件 `HumanInterventionDialog`（shadcn Dialog 模态）挂在 App 根，监听 `browser-store.ts` 的 `humanInterventions`（现有 tipc 广播链路不变）。有 pending 即弹模态。
- **置前**：`tipc/browser.ts:70` 的 `setHumanInterventionBroadcaster` 注入处，检测到**新增** pending（对比上次广播列表）时调主进程 `getMainWindow()` 做 `show + focus`（Windows 抢焦点）。不碰 human-intervention.ts（纯 service 不碰窗口）。
- **三按钮**（guard_submit + confirmMode）：
  - 确认执行 → `resolveHumanIntervention(id, 'user', 'approved')` → 工具 `executeClick(true)` 代劳（链路已有）
  - 拒绝 → `denied`（链路已有）
  - **已手动操作** → `InterventionResult` 扩展 `'manual'`，工具层新分支返回「用户已手动完成提交，请重新 observe_page 确认页面状态后继续」
- **登录/密码/验证码类**（不可代劳）：弹窗为「请在浏览器中完成 {label}」提示 + 单按钮「完成后继续」（现有 outcome 语义不变）
- **超时收口**：`waitForInterventionResult` 超时分支补 `resolveHumanIntervention(id, 'auto')` 清 pending——现状超时不清卡（残留横幅 bug），弹窗形态下会永挂，必须修。

**排除的选项**：独立置顶小窗（alwaysOnTop BrowserWindow）——dialog + 抢焦点已满足「马上打扰」，成本更低；伴随面板横幅移除——保留双通道无害。

### 授权退役（动作级护栏成为唯一防线）

| 退役点 | 位置 |
|--------|------|
| open_tab 目标域校验 | `extension/src/tab-commands.js:96` navigation_blocked 分支 |
| 命令执行域校验（扩展侧） | `extension/src/background.js:361` permission_denied 分支 |
| 命令执行域校验（gateway 侧） | `browser-gateway.ts` sendExtensionCommand 的 isOriginAuthorized + validateNavigateTarget 的授权段（URL 合法性/协议检查保留） |
| 授权 UI 与存储 | popup 授权管理、background 的 authorizedOrigins 读写、permission_state 帧发送 |
| gateway 状态字段 | currentStatus.authorizedOrigins + applyPermissionState 处理 |

- **协议零破坏**：permission_state 帧定义保留在 nm-protocol 双副本中（旧版扩展发帧新 gateway 忽略即可），只删发送方与消费方。
- **存量清理**：扩展 background 顶层一次性 `storage.local.remove('authorizedOrigins')`（幂等）。
- **保留的域级防线**：支付黑名单（navigate/click/fill 工具入口检查，下一步 settings 化）。
- 扩展版本 bump 0.3.0 → 0.4.0（权限模型变更，用户可感知）。

### 支付黑名单 settings 化

- `settings.json` 新增 `paymentBlockedHosts?: string[]`（用户列表，与内置默认并集生效）
- `site-policy.ts`：`setPaymentBlockedHosts(user)` 注入 + `isPaymentBlocked`/`paymentBlockedHosts()` 用合并列表；启动时读 settings 注入
- 设置页新增「支付黑名单」编辑区（列表编辑 + 保存），复用现有 settings IPC

## 错误处理 / 边界

- 弹窗超时自动收起（超时清 pending → broadcast 空列表 → dialog 关闭）
- 多会话并发触发：raise 已按 tabId 去重（同 tab 只保留最新），弹窗单实例渲染列表第一条
- 主窗口置前失败（窗口已销毁）静默降级，不影响广播
- 授权退役后 `permission_denied` 错误码与映射保留（协议层不删，只是不再触发；组空态 `EMPTY_GROUP_MESSAGE` 分支保留）

## 未决问题

无（细节已全部拍板：弹窗=dialog+抢焦点、超时 5 分钟、横幅保留、授权全退、黑名单并集）。
