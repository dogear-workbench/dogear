---
step: 3
title: 支付黑名单 settings 化
status: pending
---

## 目标

支付黑名单域名列表用户可编辑（settings），与内置默认并集生效，成为域级唯一防线且可维护。

## 依赖上下文（接力棒输入）

- 现状（2026-10-03 核实）：`services/browser/site-policy.ts` 内 `PAYMENT_BLOCKED_HOSTS` 硬编码常量（约 50 个银行/支付域名）；`isPaymentBlocked(url)` host 精确/后缀匹配；`paymentBlockedHosts()` 已导出只读列表；调用点在 extension-tools / browser-tool-shared 等工具入口（navigate/click/fill）
- settings 体系：应用 settings.json（主进程读写 + tipc 通道 + 设置页），本工作区配置在 workspaces/*/config.json 之上另有全局 settings——按现有 settings IPC 通道走，不新建通道

## 计划改动

- [ ] settings schema：加 `paymentBlockedHosts?: string[]`（用户自定义列表，缺省空）
- [ ] `site-policy.ts`：
  - 模块级 `userPaymentBlockedHosts: Set<string>`，新增 `setPaymentBlockedHosts(list: string[])`（启动时由 settings 读取处注入）
  - `isPaymentBlocked` 用 内置常量 + 用户集合并集匹配；`paymentBlockedHosts()` 返回合并列表（设置页展示用）
- [ ] 主进程 settings 加载处：读 paymentBlockedHosts 注入 `setPaymentBlockedHosts`；settings 保存变更时重注入（热生效）
- [ ] 设置页：新增「支付黑名单」编辑区——默认列表只读展示 + 用户追加域名输入（域名格式校验），保存写 settings；无独立页面则挂在安全/浏览器相关分区

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
