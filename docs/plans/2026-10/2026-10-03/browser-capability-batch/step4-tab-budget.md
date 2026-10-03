---
step: 4
title: tab 预算与节奏控制
status: done
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
  1. tab 预算用「存活数」语义而非累计计数：上限检查读 gateway 维护的 `status.tabs.length`（close_tab 释放后可再开），不用 per-conversation Map 累计——累计计数下 close 不返还额度会让 agent 无路可走，违背「可感知可收敛」；且零新增状态、断连重连随 gateway 自动重置。会话隔离由扩展通道 ownership 独占保证（同一时间仅一个会话能 open_tab）
  2. 节奏选「等待」不选报错：与策略站点 delayMs「自动等待」语义一致（instructions 明说等待属正常节奏控制）；报错会诱导 agent 重试循环反而加速触发风控；间隔上限 2s 等待成本可忽略
  3. 节奏只覆盖 navigate/click/fill 三个写操作（任务范围），observe/find/read_* 等 DOM 读取不产网络流量不纳入；open_tab 不纳入（已有 tab 上限 + navigateGate 延迟 + 创建开销天然限速）；scroll 未纳入（任务未列，待真机反馈）
  4. 新机制只挂扩展层，不改 policyGate 本身——它被内嵌通道 3 处共用（browser-action-tools/browser-atom-tools/browser-search-service），改它会波及内嵌行为
  5. 设置入口不加：站点策略整体无 per-site 配置 UI（P0 硬编码决策），新常量同模式；单独建配置面违反「不新建页面」且无用户诉求
  6. 顺手补齐既有 4 处预算拒绝（navigate 搜索 / read_text / read_state / readArticle 笔记）的 WARN 审计日志——此前只有动作流无落盘日志，属任务「预算触发/拒绝留 WARN」字面范围
- 改动文件清单：`site-policy.ts`（+MAX_TABS_PER_SESSION/MIN_ACTION_INTERVAL_MS 常量 + tabLimitReachedMessage）、`extension-command-shared.ts`（paceActionGate/markActionDone + SHARED_SCOPE_NOTE 节奏说明）、`extension-tab-tools.ts`（open_tab 上限检查 + WARN + 描述）、`extension-tools.ts`（navigate/click/fill 接 pace + 4 处预算拒绝 WARN）

### 给下一步的接力棒
- 预算字段与默认值：`MAX_TABS_PER_SESSION = 8`（存活数语义，site-policy.ts 导出）；`MIN_ACTION_INTERVAL_MS = 2000`（上次写操作完成 → 下次发起的间隔保底，extension-command-shared.ts 的 per-conversation Map 记基线，应用生命周期）；预算拒绝 WARN 日志 child：extension-tab-tools / extension-pace / extension-policy
- 下个 step 该从哪里继续：按 plan 顺序接 Step 5（injection 统一）；本步无协议/manifest 改动（纯主进程工具层），Step 6 bump 0.5.0 时无需为本步补 manifest 项；真机验证项：① 同会话连开 8 个 tab 后第 9 次 open_tab 被拒（文案含 close_tab 引导），close 后可再开；② 快速连发 click 观察回包自动延迟约 2s 与 extension-pace WARN 日志
