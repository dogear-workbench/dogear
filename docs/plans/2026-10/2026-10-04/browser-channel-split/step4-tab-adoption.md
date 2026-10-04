---
step: 4
title: 被动 tab 自动入组与上限放宽
status: done
---

## 目标

网页被动打开的新标签（target=_blank / window.open）自动收编入 Dogear 分组（opener 判断），tab 上限 8 → 16。

## 依赖上下文（接力棒输入）

- 设计定案：[design.md](./design.md)「tab 生命周期闭环」节
- 关键现状：
  - `extension/src/tab-commands.js`：`ensureDogearGroup`（10-19 行，open_tab 时入组）、`getDogearTabs`（25-35 行，按组查 tab）、close_tab 拒绝组外 tab（120 行）
  - `extension/src/background.js`：SW 命令分发中枢，目前无 `tabs.onCreated` 监听——被动 tab 不入组不占额度也不受管
  - `electron/main/services/browser/site-policy.ts:7`：`MAX_TABS_PER_SESSION = 8`；`open_tab` 计数口径 = `status.tabs.length`（组内 tab 总数，extension-tab-tools.ts:132）
  - manifest 已有 `tabs` 权限（P0 批次加过，实施时确认）
- 关键决策回顾：入组只认 `openerTabId` ∈ Dogear 组（用户手动浏览弹的广告不进组）；上限 16 不做配置；弹窗轰炸由 Chrome 自带拦截 + opener 过滤 + 上限 + 收尾清理四层兜底。

## 计划改动

- [ ] `extension/src/background.js`（或 tab-commands.js 就近）：`chrome.tabs.onCreated` 监听——新 tab 的 `openerTabId` 对应 tab 在 Dogear 组内 → `chrome.tabs.group` 收编；入组失败仅 console.warn（对齐 open_tab 现有容错），不阻塞
- [ ] 被动入组后 `pushSnapshot`（驱动设置页状态行 / 面板刷新，对齐现有快照链路）
- [ ] 焦点接管核对：Chrome 开新 tab 默认激活，确认 focusedTabId 状态机是否需要跟随（nav-tracker / setFocusedTab 现有链路），避免 agent 对旧 tab ref 操作错位——design.md 边界情况已记
- [ ] `site-policy.ts`：`MAX_TABS_PER_SESSION` 8 → 16；`extension-tab-tools.ts` open_tab description 的「8」文案同步（约 110 行）
- [ ] 验证：真机连扩展——组内页面点 target=_blank 链接验证自动入组 + list_tabs 可见；用户自己开的 tab 不入组；开到 17 个验证上限拒绝文案
- [ ] NativeMessaging / 扩展代码改动后提醒：chrome://extensions 手动重载扩展（记忆 xiaohongshu-risk-extension-channel 运行约束）

## 实施回填（做完后填）

### 实际改动
- 与计划差异：① extension-tab-tools.ts 无需改：open_tab description 已是 `${MAX_TABS_PER_SESSION}` 模板引用，常量改后自动同步；② 被动入组不做 16 上限拒绝（拒收会游离失控不可管，与收尾清理矛盾；上限层由 open_tab 工具层执行，被动 tab 收编后计入额度）；③ 焦点状态机核对结论：不跟随（零改动）——若跟随会导致 agent 下一条命令 stale_tab 拒绝（正是要避免的旧 ref 错位），executeScript 按 tabId 寻址不要求激活；④ 真机验证以静态审查替代（收编三道闸/快照幂等/上限路径/manifest 权限逐项核对）。
- 改动文件清单：extension/src/tab-commands.js（新增 adoptPassiveTab：opener 缺失/已关/不在组内不收编，组内 opener → ensureDogearGroup）；extension/src/background.js（顶层 tabs.onCreated 监听 → 收编成功 pushGroupTabSnapshots，catch 兜底）；electron/main/services/browser/site-policy.ts（MAX_TABS_PER_SESSION 8→16）。

### 给下一步的接力棒
- 关键签名 / 数据结构：`adoptPassiveTab(tab): Promise<boolean>`（tab-commands.js 导出）；gateway applyTabSnapshot 的 isFocus 判断保证被动快照只 upsert tabs 数组不切焦点。
- 下个 step 该从哪里继续：会话收尾自动清理——Dogear 组内 tab 遍历 + 「未移交」豁免判定（design.md 未决问题 1/2，倾向简单版：组内全关 + 显式豁免清单）+ 挂载点定位（extension-ownership / PiSession close / gateway 断连）。
- 待办或已知限制：① chrome://extensions 手动重载扩展（SW 变更）；② 重启 Dogear 应用（主进程常量变更）；③ 真机验证三步（target=_blank 入组/非组不入组/第 17 次 open_tab 拒绝）待用户执行；④ 弹窗轰炸实测留待使用观察。
