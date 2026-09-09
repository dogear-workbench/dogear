---
step: 3
title: 观察与操作质量
status: pending
---

## 目标

修 click 双触发（checkbox/radio 被 synthetic 重复点）；observe_page 在 AX 覆盖不足时附 DOM 链接兜底（Google 结果页 AX 只见容器的直接解法）；代理 PAC 前缀修正。

## 依赖上下文（接力棒输入）

- `actions.ts` clickTab：键盘激活主路径后 `navigated = tab.generation !== generation`，navigated=false 无条件补 synthetic click——checkbox/radio（useSpace 分支）键盘已翻转，synthetic 再点一次等于取消
- `ax-observe.ts`：`observeTab` 返回 ObservePayload（AX 树 + 摘要），`readTabText` 读正文；`browser-atom-tools.ts` 的 `formatEmbeddedObserve` 负责格式化
- `proxy.ts`：目前统一拼 `PROXY <输入>`，socks5:// 前缀会产生错误 PAC；清空代理时直接 return 不清除旧 session 代理
- 设计文档：第二批 5/6/7

## 计划改动

- [ ] `actions.ts`：新增 `CHECKED_FN`（callFnOnNode 回读 `el.checked`）；useSpace 分支键盘激活后读 checked，与激活前对比已翻转 → 跳过 synthetic 兜底；`ClickResult` 加 `statusChanged?: boolean` 字段标注「不导航但状态已变」的成功
- [ ] `ax-observe.ts` 或 `browser-atom-tools.ts`：observe_page 返回前判定——AX 可交互元素数 < 5 且 `readTabText` 正文长度 > 500 → evaluate 附链接摘要（前 30 个可见 `a[href]` 的 `{text≤60, href≤120}`），`formatEmbeddedObserve` 附加「页面链接」段（标注「AX 覆盖不足时的 DOM 兜底」）；evaluate 异常静默跳过
- [ ] `proxy.ts`：解析输入区分三种形态——`socks5://host:port` → `SOCKS host:port`；`http(s)://` 或裸 `host:port` → `PROXY host:port`；空字符串 → 显式清除该 partition 的 session 代理（`setProxy({ mode: 'direct' })`），不再直接 return
- [ ] 动作流无新事件类型，无需前端改动

## 验收

- checkbox 点击一次只翻转一次（可自测脚本断言：构造 data URL 页面含 checkbox，clickTab 后读 checked）
- Google 结果页 observe_page 输出含链接摘要段（实测或自测 mock）
- 代理三种输入形态 PAC 表达正确；清空后 partition 回直连
- `bun run build:electron` + `bun run lint`；`DOGEAR_EMBEDDED_BROWSER_SELFTEST=1 bunx electron .` 既有断言不回归（click 分支如有 checked 断言需更新）

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
