---
step: 1
title: patchright 引入验证 + PAC 代理改造
status: done
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
  - 类型不能「继续从 playwright 来」：patchright-core 与 playwright-core 是两套独立类型声明，混用导致 TS 递归不兼容，`BrowserContext` / `Page` 全部改从 `patchright` import（含 browser-article-service.ts / browser-tools.ts 两处 type import）
  - PAC 定案 data URL 单实现：本地假代理实验证明 headful（生产模式）下 `data:text/plain,<encoded>` 生效、file:// 反而加载失败回退 DIRECT（headless shell 下两者均不生效，与生产无关）；file:// 降级分支未实现（实测不工作，写之即死代码）
- 改动文件清单：
  - `electron/main/services/browser/browser-manager.ts:5` chromium/BrowserContext/Page 全从 patchright import
  - `electron/main/services/browser/browser-manager.ts:33-47` `BROWSER_PROXY_SERVER='127.0.0.1:7897'`（本机 Clash Verge 混合端口实测值，step3 接设置项）、`PAC_PROXY_DOMAINS`、`buildProxyPacUrl()`（dnsDomainIs 防后缀误匹配 + 裸域全等，data URL encode）
  - `electron/main/services/browser/browser-manager.ts:291-296` buildLaunchOptions 注入 `--proxy-pac-url=`
  - `electron/main/services/browser/browser-article-service.ts:1` / `electron/main/agents/tools/browser-tools.ts:14` type Page 改从 patchright
  - package.json/bun.lock：patchright@1.62.3（与 playwright 1.62 同版 fork，浏览器 build 同为 chromium-1234，复用 ms-playwright 缓存零下载）
- 回归：`node resources/browser-eval/run-pipeline.mjs` 11/11 PASS；`bun run build:electron` 通过；dev 起动主进程日志无报错；加分项：真实分流验证 google 经代理 200、baidu/bing 直连 200

### 给下一步的接力棒
- 关键签名 / 数据结构：`buildProxyPacUrl(): string`（模块级函数，读常量 BROWSER_PROXY_SERVER；step3 改造点 = 该常量换 settings-service 读取，空值时返回 null 并在 buildLaunchOptions 跳过注入即可实现「空 = 仅 Bing」语义）；patchright 类型与 playwright 结构同源但不可互换，后续涉浏览器文件一律 `from 'patchright'`
- 下个 step 该从哪里继续：step2 SERP 解析可直接在 patchright 环境开发；Google 可用（无需触发兜底预案）
- 待办或已知限制：代理地址硬编码 `127.0.0.1:7897`（step3 必须换设置项）；PAC 仅 google 系 + duckduckgo 走代理，其余 DIRECT，Bing/读文章不受影响
