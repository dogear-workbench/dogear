---
step: 1
title: P0 Chromium 分发修复
status: in_progress
---

## 目标

干净机器安装后受控浏览器可用：懒下载 Chromium + channel 降级链，消除「安装版无浏览器」分发 bug。

## 依赖上下文（接力棒输入）

- 勘查结论：[../browser-nm-packaging-survey.md](../browser-nm-packaging-survey.md) §5——方案 B（首启下载，npmmirror 个别 revision 缺 win64 包必须 fallback 官方 CDN）+ C（channel 降级）；Playwright 默认缓存 `%LOCALAPPDATA%\ms-playwright`（registry 解析见 playwright-core coreBundle.js:32820）
- 现状：`browser-manager.ts:144-149` launchPersistentContext 未指定 executablePath/channel
- 设计约束：不动安装包体积（不做 extraResources）

## 计划改动

- [ ] `browser-manager.ts`：launch 前检测链——ms-playwright 缓存存在则现状路径；不存在先试 `channel: msedge`、再 `channel: chrome`（已装浏览器立即可用）；都失败触发下载流程，下载完成后重试现状路径
- [ ] 新增 `services/browser/browser-download-service.ts`（或并入 manager，实施时按体量定）：检测缓存 → 下载（npmmirror `https://registry.npmmirror.com/-/binary/chromium-browser-snapshots/win64/<rev>` → 官方 CDN `https://cdn.playwright.dev/dbazure/download/playwright/builds/chromium/<rev>/chromium-win64.zip` 顺序 fallback）→ 校验解压到 ms-playwright 目录 → 进度事件广播；中断/失败清残留、可重试
- [ ] 下载期间并发浏览器调用：复用现有 acquire 队列等待，不重复触发下载（下载单飞）
- [ ] 进度 UI：轻量方案（未决问题 1 实施时定：优先 toast + 文章条目「正在下载浏览器组件」状态，避免新开设置区块）
- [ ] 降级各档失败原因在报错信息中透出（「未找到浏览器组件，且 Edge/Chrome 均不可用」）

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
  1. 下载 URL 实测修正：playwright 1.62 chromium 为 CFT 构建，正确路径 `builds/cft/<browserVersion>/win64/chrome-win64.zip`（npmmirror 实测 200/192MB）；计划中写的 `chromium-browser-snapshots` 与 `builds/chromium/<rev>` 旧路径实测均 404。代码从 playwright 内部 registry 动态取 downloadURLs 拼镜像，升级自动跟随
  2. 「文章条目状态文案」落点改为解析入口 UI（ArticleUrlInput placeholder + 重试按钮）+ 常驻 toast 进度：手动解析流程中文章条目解析完才落盘，无条目可标
  3. 未加 activeLaunchOptions 缓存（每次 launch 重走检测链，成本仅几次 existsSync，换缓存损坏自愈）；下载失败加 10s 冷却防并发风暴
- 改动文件清单：新增 `electron/main/services/browser/browser-download-service.ts`、`lib/browser-download.ts`；修改 `browser-manager.ts`（launch 检测链 + 错误聚合）、`tipc/renderer-handlers.ts`（browserDownloadProgress 事件）、`tipc/browser.ts`（广播接线）、`src/main.tsx`、`components/WorkspaceExplorer.tsx`、`components/ArticlePreview.tsx`

### 给下一步的接力棒
- 关键签名 / 数据结构：`ensureChromiumInstalled()` 单飞+冷却；`chromiumInstallStatus()`；`BrowserDownloadEvent { status, receivedBytes, totalBytes, source?, error? }`（renderer-handlers `browserDownloadProgress`）；launch 候选档：内置缓存→channel msedge→channel chrome→下载后重试，各档失败原因聚合透出
- 下个 step 该从哪里继续：Step 2（①翻页拼接）从 `browser-article-service.ts` 继续，与本次改动无交集；下载事件/服务可复用
- 待办或已知限制：干净机器全量下载 + 三档降级真机测试未做（建议发版前干净 VM 冒烟）；coreBundle 内部 API 依赖点集中在 `resolveChromium()`，playwright 升级若变会以清晰错误暴露
