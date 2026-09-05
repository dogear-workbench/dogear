---
step: 4
title: 设置页状态行 + dev 端到端验收
status: pending
---

## 目标

dev 环境全链路真实验收：Edge 加载扩展 → 点「连接此标签页」→ 设置页状态行 ✅ + 标签页信息；SW 30s 死 → 回「未连接」；Dogear 未运行反向用例通过；全部回归不破。

## 依赖上下文（接力棒输入）

- 前置 step 产出：[step3-gateway-tipc.md] tipc `browser.getExtensionStatus()` + 状态变更推送已就绪，gateway 状态结构与广播时机见其回填
- 当前关键文件状态：`app/settings/page.tsx` 已有「受控浏览器」小节（browserProxyServer 输入框 + browserSearchEngine 下拉，2026-09-05 WebSearch 三期落地）
- 关键决策回顾：状态行纯展示，不做操作面板；文案「浏览器扩展：未连接 / ✅ 已连接 · 当前标签页：×××」；popup 只显示 title/url，正文预览只进设置页与日志

## 计划改动

- [ ] `app/settings/page.tsx` 「受控浏览器」小节加状态行：挂载查询一次 + 订阅变更事件；断线态文案「浏览器扩展：未连接（在浏览器扩展里点击「连接此标签页」）」
- [ ] （按 step3 回填决定是否需要）渲染层订阅的 store 或 hook 落位——遵循项目 store 惯例，独立状态优先新建小 store 或组件内订阅，避免塞既有大 store
- [ ] 端到端验收（headful 手动 + 截图/日志佐证，按设计文档验收清单 1/2 执行）：
  - `bun run dev` + `node scripts/register-nm-dev.mjs` → Edge `edge://extensions` 开发者模式加载 `extension/` → 任开一页 → 点「连接此标签页」→ 设置页状态行 ✅ + title/url/正文预览
  - 等 30s（SW 空闲被杀）→ 状态行回「未连接」
  - 关闭 Dogear dev → 点连接 → popup 显示「Dogear 未运行」
- [ ] 回归：`bun run lint` / `bun run build:electron` / `node resources/browser-eval/run-pipeline.mjs` 20/20

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
