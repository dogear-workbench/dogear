---
step: 1
title: patchright 引入验证 + PAC 代理改造
status: pending
---

## 目标

把受控浏览器内核切到 patchright（反检测 fork）并验证零回归，同时给 browser-manager 加按域 PAC 代理注入能力——两者都是后续步骤的地基，风险最高所以最先做。

## 依赖上下文（接力棒输入）

- 无前置 step。设计依据：[../browser-search-design.md](../browser-search-design.md)「反检测策略」「代理」两节
- 当前关键文件状态：`electron/main/services/browser/browser-manager.ts` 从 `playwright` import `chromium`（文件头部），launch 在 `browser-manager.ts:278` 附近（`headless: false`，launchPersistentContext）
- 关键决策回顾：patchright 是 drop-in 替换（API 兼容），只换 import；PAC 显式指向设置项里的代理地址，不读系统代理，因此不受 Clash 系统代理开关影响

## 计划改动

- [ ] `bun add patchright`，确认与 electron 打包共存（patchright 纯 JS 层 patch，浏览器二进制应复用 ms-playwright 缓存——装完验证缓存路径没变）
- [ ] `electron/main/services/browser/browser-manager.ts`：`import { chromium } from 'playwright'` → `'patchright'`；类型引用（`BrowserContext` / `Page`）可继续从 playwright 来（API 兼容）
- [ ] browser-manager launch 增加代理参数构造：读设置项 `browserProxyServer`（本 step 可先用环境变量/临时读法，设置项正式落地在 step3——注意别留死代码，本 step 直接从 settings-service 读但字段还没加就先硬编码常量占位，step3 换掉），非空则拼 `--proxy-pac-url`：
  - PAC 内容：代理域清单（.google.com / .googleusercontent.com / .gstatic.com / .googleapis.com / .ggpht.com / duckduckgo.com）→ `PROXY <设置值>`，其余 `DIRECT`
  - 优先 data URL 内嵌（URL encode）；实测 Chromium 不认则降级写临时文件到 configDir 用 file:// 引用（回填记录用了哪种）
- [ ] 回归验证：`node resources/browser-eval/run-pipeline.mjs` 必须 11/11 PASS；`bun run build:electron` 通过；dev 起一次真实读文章冒烟
- [ ] （可选加分）带代理环境跑一次 `https://www.google.com` goto，确认 PAC 生效（google 域走代理、国内站直连）——若无代理环境可留 step4 冒烟

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
