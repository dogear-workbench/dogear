---
step: 4
title: tab 预算与节奏控制
status: pending
---

## 目标

扩展通道接入站点策略的会话预算机制：open_tab 数量上限 + 操作节奏（最小间隔），防后台窗口膨胀与网站风控。

## 依赖上下文（接力棒输入）

- 站点策略：`electron/main/services/browser/site-policy.ts`（getSitePolicy / formatSitePolicySummary，内嵌通道在用的预算机制——先盘点其现有字段与生效点）
- 扩展通道命令出口：`electron/main/agents/tools/extension-tools.ts`（navigate/click/fill/open_tab 各工具的执行链）、`extension-command-shared.ts`（错误文案模式）
- 审计日志先例：browser-gateway 的 WARN 日志（click 命令结果等），预算触发也应留痕
- 错误返回约定：`isErrorResult`，文案要让 agent 可感知并可收敛（说明剩余预算）

## 计划改动

- [ ] 盘点 site-policy 现有预算字段与内嵌通道的生效点（若字段不足，设计扩展：如 maxTabsPerSession、minActionIntervalMs，含默认值）
- [ ] 扩展通道接入：open_tab 超 tab 上限返回明确错误；click/fill/navigate 节奏间隔不足时等待或报错（选其一并说明理由）
- [ ] 预算计数的作用域（会话级 vs 任务级）与重置时机，跟内嵌通道语义对齐
- [ ] 设置入口：若需用户可配，挂到站点策略现有 UI（不新建页面）
- [ ] 审计日志：预算触发/拒绝留 WARN 级日志
- [ ] 验证：真机或 dev-selftest 构造超预算场景

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 预算字段与默认值：
- 下个 step 该从哪里继续：
