---
step: 2
title: click 误报核查
status: done
---

## 目标

排查「click 报页面已变化/元素不在但页面实际未导航」的误报根因（hvszlply 议题 + P1.5 A4 新证据），产出根因结论 + 修复或边界说明。

## 依赖上下文（接力棒输入）

- 两份证据：
  1. hvszlply 原议题：同页导航 click 误报「页面已离开命令发起时的地址」
  2. P1.5 验证 A4（2026-10-03 15:49 审计日志）：click 返回 `errorCode=ref_expired`（DOM 查不到 `[data-dogear-ref]` 元素）发生在 guard 弹窗**之前**，与用户手动提交窗口重叠；30 秒后同 ref 重试成功命中——判定竞态，根因未定位
- 关键文件：`extension/src/dom-actions.js` clickFn（ref 校验 → isSubmit 判定 → 执行 → urlBefore/textBefore 对比）、`nav-tracker.js`（导航追踪）
- 审计日志可复现取证：`logs/dogear-YYYY-MM-DD.log` 的「click 命令结果」「焦点页面导航」（WARN 级）

## 计划改动

- [ ] 通读 dom-actions.js click 全链路 + nav-tracker 的导航判定时机，列出所有可能产生 ref_expired / 「页面已变化」的条件分支
- [ ] 分析与用户手动操作/确认卡出现的竞态窗口（元素 focus 变化、表单交互是否会导致 data-dogear-ref 属性丢失或 DOM 重建）
- [ ] 若能本地复现（构造脚本或 dev-selftest 场景），定位到具体分支
- [ ] 产出：根因结论；能修则修（小改动直接改 + 回归验证），改动大则写边界说明留待后续任务
- [ ] 结论回填 hvszlply 任务与本文档

## 实施回填（做完后填）

### 实际改动
- 与计划差异：无计划外文件；另修复审计日志 confirmed 字段失真（browser-gateway.ts，click 日志读 message.data.confirmed 但扩展成功结果无此字段，永远为 false，A4 调查时已误导）
- 改动文件清单：
  - `extension/src/background.js`：resolveLostClickResult 判定 startsWith → 等值比较；失败分支带 currentUrl、文案改为「点击已发出但页面地址未变化」
  - `electron/main/services/browser/browser-gateway.ts`：PendingCommand 增加 params；click 命令结果日志 confirmed 改从 pending.params 读
  - electron 改动已过 `bun run build:electron`；扩展改动待用户 chrome://extensions 重载后真机验证（同域跳转 click 场景：点同站链接后应报成功 navigated=true 而非「页面已离开」）
- 未 commit：工作区有 step1 并行改动，建议主会话按 step 边界提交本步 3 个文件（含本文档）

### 给下一步的接力棒
- 根因结论（两个议题不同根因，已分别定位）：
  1. **hvszlply（同域跳转 click 误报「页面已离开」）**：根因在 background.js resolveLostClickResult——click 触发导航导致注入上下文销毁、executeScript 无结果时，用 `!tabAfter.url.startsWith(msg.url)` 判「是否导航成功」；同域路径跳转（如百度 / → /s?wd=x，前缀兼容）判定为「未离开」→ 4 轮轮询后报 navigated_away 失败，工具层统一文案「页面已离开命令发起时的地址」。实际点击与导航均成功。批 3 验证百度样本命中此分支，httpbin 样本（A2，/forms/post → /post 非前缀兼容）恰好走对——解释了两处表现矛盾。修复：改等值比较；锚点跳转顺带修复。前置校验（background.js:290）的 startsWith 是保守防御语义（前缀相同放行、跨域拒绝+回推快照），无误报，保留
  2. **P1.5 A4（guard 前 ref_expired，30s 后同 ref 命中）**：判定为正确防御而非误报。日志时序（logs/dogear-2026-10-03.log 07:49 UTC）：07:49:19 click e13@2→guard_submit；07:49:22 denied；07:49:39 click→ref_expired（confirmed=false，DOM 查不到）；07:50:09 同 ref→guard_submit（元素又在）；07:50:14 用户手动提交导航→manual。用户在 denied 后手动操作（刷新/填表后页面状态变化）导致 DOM 重建，observe 打的 data-dogear-ref 随节点销毁（observe-actions.js collect() 每次全清除重打标），querySelector 查不到→ref_expired 语义正确。「同 ref 重试命中」非旧 ref 复活：同 URL 刷新不 bump generation（nav-tracker 只监听 changeInfo.url），重新 observe 后编号确定性复现（同页面同 gen → ref 同形）
- 条件分支清单（ref_expired / navigated_away 全部产生点）：
  - background.js:289 前置校验：非 readSafe 命令 + tab.url 与 msg.url 前缀断裂 → navigated_away（tab_snapshot 有 800ms debounce，gateway URL 滞后窗口内跨域跳转可触发；同域放行，保留）
  - background.js:301 ref generation 校验：parseRefGeneration(ref) ≠ currentGeneration → ref_expired（仅 URL 变化 bump，同 URL 重载是盲区）
  - resolveLostClickResult：注入丢失后 URL 等值不等 → navigated=true 成功（已修）；URL 相同 → navigated_away 失败（修复后附 currentUrl）
  - clickFn（dom-actions.js:41/49）：ref 格式不匹配 / querySelector 查不到 → ref_expired；isSubmit 未 confirmed → guard_submit（正确拦截）
- 竞态窗口：①observe→click 之间 SPA 重渲染/同 URL 刷新丢 data-dogear-ref（React 受控 re-render 保留节点，但 keyed 替换/条件渲染丢）；②guard_submit→confirmed 重发之间（秒级~5min）用户手动导航/刷新；③click 执行 400ms 等待窗口内导航 → 注入丢失走 resolveLostClickResult；④命令间 tab_snapshot 800ms debounce 窗口
- 待办或已知限制：
  1. 扩展重载后真机回归：同域站内链接 click 应报成功；A4 类场景（guard 等待期间手动刷新）语义上仍报 ref_expired（正确防御）
  2. 边界（未修，留后续）：「URL 相同但注入丢失」报 navigated_away 语义仍不精确（工具层文案「页面已离开」会误导），彻底解法需新增 errorCode（改 nm-protocol + COMMAND_ERROR_CODES + ERROR_MESSAGES 双侧，属协议层变更，超出本步 scope）
  3. generation 不覆盖同 URL 重载（刷新/回退再前进）：防御靠 observe 重打标，静态页无害，动态页有「同 ref 撞新元素」的 silent mis-hit 理论风险，低概率
  4. hvszlply 任务为占位（无 planPath），结论已在此回填，待用户按 exec-pipeline 决议处置任务本身
