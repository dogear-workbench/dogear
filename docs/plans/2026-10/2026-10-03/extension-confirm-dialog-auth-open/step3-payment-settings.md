---
step: 3
title: 支付黑名单 settings 化
status: done
---

## 目标

支付黑名单域名列表用户可编辑（settings），与内置默认并集生效，成为域级唯一防线且可维护。

## 依赖上下文（接力棒输入）

- 现状（2026-10-03 核实）：`services/browser/site-policy.ts` 内 `PAYMENT_BLOCKED_HOSTS` 硬编码常量（约 50 个银行/支付域名）；`isPaymentBlocked(url)` host 精确/后缀匹配；`paymentBlockedHosts()` 已导出只读列表；调用点在 extension-tools / browser-tool-shared 等工具入口（navigate/click/fill）
- settings 体系：应用 settings.json（主进程读写 + tipc 通道 + 设置页），本工作区配置在 workspaces/*/config.json 之上另有全局 settings——按现有 settings IPC 通道走，不新建通道

## 计划改动

- [x] settings schema：加 `paymentBlockedHosts?: string[]`（用户自定义列表，缺省空）
- [x] `site-policy.ts`：
  - 模块级 `userPaymentBlockedHosts: Set<string>`，新增 `setPaymentBlockedHosts(list: string[])`（启动时由 settings 读取处注入）
  - `isPaymentBlocked` 用 内置常量 + 用户集合并集匹配；`paymentBlockedHosts()` 返回合并列表（设置页展示用）
- [x] 主进程 settings 加载处：读 paymentBlockedHosts 注入 `setPaymentBlockedHosts`；settings 保存变更时重注入（热生效）
- [x] 设置页：新增「支付黑名单」编辑区——默认列表只读展示 + 用户追加域名输入（域名格式校验），保存写 settings；无独立页面则挂在安全/浏览器相关分区

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
  1. `paymentBlockedHosts()` 保持 `readonly string[]` 返回，语义升级为合并列表（内置在前、滤重）；区分来源靠新增 `builtinPaymentBlockedHosts()` + tipc `getBrowserActionPolicy` 新增字段
  2. `*.example.com` 输入归一为 `example.com` 存储（拦截谓词本就含自身与子域，归一无损）；前端校验与主进程 normalize 同一规则
  3. 设置保存无独立按钮，走设置页现有防抖全量自动保存机制（AUTOSAVE 500ms）
  4. 顺手补漏：`ExtensionStatusLine.tsx` 删 `status.authorizedOrigins` 展示块（11 行）——step2 删了类型字段但漏删 UI 引用，导致渲染层 tsc 3 errors（HEAD 既有，git stash 验证）；同时挂 settingsChanged 事件使生效黑名单展示保存后即时刷新
- 改动文件清单：site-policy.ts、settings-types.ts、settings-service.ts（load/save 双链注入 + normalize）、settings-normalize.test.ts（+5 用例）、tipc/browser.ts（policy 加 builtin 字段）、types/settings.ts 双副本同步、app/settings/PaymentBlockedHostsSection.tsx（新）、BehaviorTab.tsx（挂载）、ExtensionStatusLine.tsx；验证 lint 0 errors / build:electron 通过 / 渲染层 tsc 0 errors / bun test 492 pass 0 fail

### 给下一步的接力棒
- 关键签名 / 数据结构：`AppSettings.paymentBlockedHosts?: string[]`；`setPaymentBlockedHosts(hosts: string[])`；`isPaymentBlocked(url)` 签名语义不变；tipc `getBrowserActionPolicy` 返回 `{ levels, paymentBlockedHosts(合并), builtinPaymentBlockedHosts(内置) }`
- 下个 step 该从哪里继续：step4 真机验证，全部改动已 commit，需 `bun run release` + `bun run serve-updates` + 用户应用内更新 + 扩展重载（0.4.0）
- 待办或已知限制：手工改 settings.json 不触发展示刷新（拦截行为下次 loadSettings 生效）；Worker 线程 loadSettingsFromDir 不注入（isPaymentBlocked 调用方全在主进程，无影响）；真机验证留 step4
