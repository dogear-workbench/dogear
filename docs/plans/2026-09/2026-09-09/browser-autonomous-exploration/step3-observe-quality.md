---
step: 3
title: 观察与操作质量
status: done
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
  - observe 兜底落点：判定与 evaluate 放 ax-observe.ts（新增 collectDomFallbackLinks 私有函数 + ObservePayload.domFallbackLinks 可选字段），格式化放 formatEmbeddedObserve；「AX 可交互元素数」取 visibleInteractive.length（整页、不受 region/textFilter 影响）
  - observe_page 工具入口（browser-atom-tools.ts）补 ensureInputReady 屏外挂载（静默容错）：后台保留 tab（Google parse_empty 场景）从未挂载，不可见 tab 的 AX 树残缺且 getBoundingClientRect 全 0，不挂载则兜底永远收不到链接——顺带提升 AX 树质量
  - formatClickResult 透出 statusChanged 文案「元素状态已切换（checkbox/radio 已翻转，无需再点）」，避免 agent 误读为「无效果点击」
  - proxy 新增导出 proxyPacEntry（三形态归一）；socks/socks4/socks5 均映射 SOCKS；未知 scheme 剥前缀按 PROXY（与 browser-search-service parseProxyEndpoint 行为一致）；scheme 后为空返回 null（直连）
  - dev-selftest 新增两分期：checkbox 双击翻转分期（注入 checkbox，断言一次点击只翻转一次、keyboard 翻转必标 statusChanged、二次点击翻回）+ observeFallbackSmoke（aria-hidden 让 AX 树剔除链接模拟 AX 覆盖不足 + data URL 页面正文 >500，断言 domFallbackLinks 恰 30 个且内容正确）
  - 新增 bun 单测：proxy.test.ts（三形态 PAC + mock session 直连清除）、ax-observe.test.ts（linkedom mock 验证链接收集函数：可见性过滤/去重/截断/上限）
- 改动文件清单：
  - actions.ts：:77-83 新增 CHECKED_FN + ClickResult.statusChanged?: boolean（:111）；:117-125 readChecked 私有 helper；clickTab :164-171 键盘激活前后回读 checked 对比、:185 跳过条件 `!navigated && !statusChanged`、:214 statusChanged 条件透出
  - ax-tree.ts：:55-58 DomFallbackLink 类型；:74 ObservePayload.domFallbackLinks?: DomFallbackLink[]
  - ax-observe.ts：:27-32 兜底常量（阈值 5/500，上限 30，text≤60/href≤120）；:33-52 COLLECT_DOM_LINKS_FN（new Function 构造，rect 判可见 + href 去重）+ 导出 collectDomLinksInPage；:191 observeTab 调用 collectDomFallbackLinks；:206 payload 条件展开；:211-222 collectDomFallbackLinks（readTabText 判定 + executeJavaScript，异常静默返回 null）
  - proxy.ts：:15 PROXY_SCHEME_RE；:18-26 proxyPacEntry；:28-34 buildProxyPacUrl 改用 entry；:40 applySessionProxy 空配置 setProxy({ mode: 'direct' })
  - browser-tool-shared.ts：:213-217 formatEmbeddedObserve 附加「页面链接」段（标注 AX 覆盖不足时的 DOM 兜底，无 ref 不可 click）
  - browser-atom-tools.ts：:160-165 observe_page 回调内 ensureInputReady（try/catch 静默）
  - browser-action-tools.ts：:77 statusChanged 文案
  - dev-selftest.ts：fixture 注入 checkbox（label 包裹 + id，:43-50）；operationSmoke checkbox 分期（:343-365）；observeFallbackSmoke（:133-157）+ 主流程挂载（:127）
  - proxy.test.ts / ax-observe.test.ts：新增 bun 单测共 13 用例

### 给下一步的接力棒
- 关键签名 / 数据结构：
  - `proxyPacEntry(input): { 'PROXY'|'SOCKS' } entry | null`；`applySessionProxy` 空配置显式 direct
  - `ClickResult.statusChanged?: boolean`（仅 true 时存在）；formatClickResult 对应文案
  - `ObservePayload.domFallbackLinks?: { text: string; href: string }[]`（仅 AX <5 且正文 >500 时存在；text≤60、href≤120、≤30 个、href 去重、rect 过滤不可见）；`collectDomLinksInPage`（导出的页面侧 evaluate 函数，供测试）
- 下个 step 该从哪里继续：第三批 UI（BrowserPanel 重构 / bounds 同步 rAF+revision / 地址栏作用于 activeTabId），见设计文档 8/9/10 节
- 待办或已知限制：
  - DOGEAR_EMBEDDED_BROWSER_SELFTEST 需无实例冲突环境跑（新增 checkbox 分期 + observeFallbackSmoke 待真机验证；observeFallbackSmoke 复用 fetchSmoke 后残留的 agent tab loadURL data: 页）
  - Google 真实结果页的链接兜底效果需联网 GUI 人工验收（自测 mock 用 aria-hidden 模拟 AX 覆盖不足）
  - fetch-page.ts:104 / settings-types.ts:94 存在既有错字（兜误写为兑，应为兜底），非本次改动范围未动
