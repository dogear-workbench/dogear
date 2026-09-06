# 成熟浏览器 Agent 方案的「真实登录态自动化 + 反风控」调研

> 为 Dogear 浏览器三期 P2（小红书只读调研工作流）提供设计输入。
> 调研方式：直接抓取官网文档 / GitHub README / Issues 原文（2026-09-06）。所有结论附信源；无法一手核实的点明确标注。

## TL;DR

1. **主流 agent 框架开源版几乎都不做「拟人化」**：browser-use 拟人化 feature request（#947）0 评论被关闭；Skyvern/Stagehand/browser-use 把 stealth、代理、验证码全部放付费云，开源版用原版 Playwright。开源光谱里「反检测」= 修静态特征（patchright 修 CDP 泄漏、camoufox 指纹注入），「拟人化」= 行为层随机化（AgentQL 官方指南、camoufox 内置鼠标轨迹）——是两个不同的层，后者做深的很少。
2. **「附着用户日常浏览器」2025-05 起被 Chrome 官方收紧**：Chrome 136 起 `--remote-debugging-port` 不再允许搭配默认 user-data-dir（[官方公告](https://developer.chrome.com/blog/remote-debugging-port)，本环境不可达，由 [browser-use#1520](https://github.com/browser-use/browser-use/issues/1520) 交叉证实）——**CDP attach 用户日常浏览器的默认 profile 被封死**（Edge 截至 136.0.3240.64 未启用，但同源 Chromium 预期跟进）。browser-use 的 `from_system_chrome()` 退化为「先完全关闭 Chrome 再以独立实例接管 profile」。
3. **扩展是唯一不受 Chrome 136 限制、真正附着运行中浏览器的方案**；商业先例：HARPA AI、Bardeen、AgentQL IDE 扩展。结构性弱点只有一个：content script 合成点击 `isTrusted=false`，页面 JS 可检测（[MDN](https://developer.mozilla.org/en-US/docs/Web/API/Event/isTrusted)）。
4. 对「只读调研」场景，市面经验一致支持 Dogear 的「真实环境 + 拟人节奏 + 验证码交还用户」：Anthropic 建议专用环境 + 域名白名单 + 敏感操作人工确认；Operator 遇登录/支付请求用户接管；AgentQL 官方确认 anti-bot 在测鼠标轨迹、点击坐标、滚动增量。
5. **没有明显更稳的替代架构**。独立 stealth 实例在「真实账号」场景反而高危（新指纹 + 无历史 + 常伴数据中心 IP）；CDP attach 有 CDP 痕迹 + 政策风险。

---

## 一、各方案「反检测 / 拟人化」对比（问题 1）

| 方案 | 架构 | 反检测（静态层） | 拟人化（行为层） | 验证码 | 开源 vs 云 |
|---|---|---|---|---|---|
| **browser-use** | 自启 Playwright 浏览器；可接管本机 Chrome profile / 连远程 CDP | ❌ 开源无 | ❌ 开源无（[#947](https://github.com/browser-use/browser-use/issues/947) 关闭未实现） | ❌ FAQ 明说需更好指纹+代理，导向云 | 云 = stealth 浏览器 + 代理轮换 + 验证码求解；[README](https://github.com/browser-use/browser-use) |
| **Skyvern** | 自启 Playwright（[开源依赖为原版 playwright](https://github.com/Skyvern-AI/skyvern/blob/main/pyproject.toml)） | ❌ | ❌ | ❌（云有） | [README](https://github.com/Skyvern-AI/skyvern)：「anti-bot measures 仅在 managed cloud」，开源明确排除 |
| **Stagehand** | 自启本地 / Browserbase 云 / CDP attach 三选一 | 靠 Browserbase「stealth mode」 | ❌ | 靠 Browserbase | [v4 文档](https://docs.stagehand.dev/v4/configuration/browser)：stealth/proxy/persistent contexts 都是 Browserbase 能力 |
| **AgentQL** | Playwright SDK（查询层） | [`enable_stealth_mode()`](https://docs.agentql.com/avoiding-bot-detection/stealth-mode-for-headless-browser)（主要对 headless） | ✅ **唯一官方写行为指南**：[User-like behavior](https://docs.agentql.com/avoiding-bot-detection/user-like-behavior) | 未内置 | SDK 开源 |
| **OpenAI Operator / ChatGPT Agent** | 云端沙箱独立虚拟浏览器（CUA 截图+虚拟键鼠） | 不隐藏（自家云环境） | CUA 强化学习节奏（未公开） | **登录/支付即请求用户接管** | 闭云；官网本环境不可达，依据 [ai-bot.cn 转述](https://ai-bot.cn/operator/)（二手，已标注） |
| **Claude computer use** | 本地 Docker（X11+VNC 虚拟桌面）或用户自备 VM 的截图-点击循环 | ❌ | ❌ | ❌（建议停下交人） | [官方 README](https://github.com/anthropics/anthropic-quickstarts/blob/main/computer-use-demo/README.md)：建议**专用 VM、避免给登录凭据、域名白名单、重要操作人工确认** |
| **patchright**（Dogear 一期在用） | Playwright 补丁版 | ✅ 修 CDP 泄漏：不用 `Runtime.enable`（最大检测点）、禁 Console API、改启动 flags（去 `--enable-automation`、加 `--disable-blink-features=AutomationControlled`、恢复扩展加载）、支持 closed shadow roots | ❌ | ❌ | [README](https://github.com/Kaliiiiiiiiii-Vinyzu/patchright)；配 [CDP-Patches](https://github.com/Kaliiiiiiiiii-Vinyzu/CDP-Patches/) 过 Brotector；声称过 Cloudflare/Kasada/Akamai/Datadome/Fingerprint.com/CreepJS |
| **camoufox** | Firefox fork | ✅ **C++ 层指纹注入（不经 JS 注入）**、WebRTC 协议层 IP spoof、字体度量 spoof、[BrowserForge](https://github.com/daijro/browserforge) 按真实流量分布生成指纹 | ✅ 内置拟人鼠标轨迹（HumanCursor 算法 C++ 重写、距离感知） | ❌ | [README](https://github.com/daijro/camoufox) |
| **undetected-chromedriver** | Selenium/CDP patch 老牌方案 | 修 `navigator.webdriver` 等典型特征 | ❌ | ❌ | [README](https://github.com/ultrafunkamsterdam/undetected-chromedriver)；对新反 bot 已显疲态（patchright 通过列表可作旁证） |

### 有效 / 无效的实证边界

**有效（厂商或实践者一手背书）**
- **修 CDP 自动化痕迹**：`Runtime.enable` 泄漏是最大检测点，仅删 `navigator.webdriver` 已不够（[patchright README](https://github.com/Kaliiiiiiiiii-Vinyzu/patchright)）。
- **随机化鼠标轨迹/点击坐标/滚动增量**：AgentQL 官方明说「许多 anti-bot 测量鼠标移动、点击坐标、滚动长度判断 bot-like」，点名「reCAPTCHA 用直线鼠标移动区分人机」（[指南](https://docs.agentql.com/avoiding-bot-detection/user-like-behavior)）；camoufox 把拟人轨迹做进 C++ 内核（[README](https://github.com/daijro/camoufox)）。
- **逐键输入**：anti-bot 监听 keydown/keypress/keyup 序列，Playwright `press_sequentially` 是推荐做法（同上）。
- **指纹整体一致性 + 真实流量分布**：camoufox 指纹按真实设备统计分布采样、C++ 层注入避免 JS 痕迹（同上）。
- **真实浏览器 + 真实登录态本身**：MediaCrawler（多平台爬虫含小红书）默认「CDP 模式连接用户已有的 Chrome，复用登录态、Cookie、扩展，**大幅降低平台风控检测风险**」，并用「保留登录态的浏览器上下文执行页面自己的签名 JS」替代签名逆向（[README](https://github.com/NanmiCoder/MediaCrawler)）。

**无效 / 有限 / 有条件**
- **headless 修补单独不够**：AgentQL stealth mode 定位是「minimize traces」的辅助手段。
- **纯 header/UA 轮换**：AgentQL 有专页但仅列为基础项（[rotating headers](https://docs.agentql.com/avoiding-bot-detection/rotating-headers)），无一家当主防线。
- **注入式 patch 有理论痕迹**：patchright 自述 InitScript「理论可被 timing attack 检测，但目前无反 bot 在查」——注入式方案的时效性脆弱（[README](https://github.com/Kaliiiiiiiiii-Vinyzu/patchright)）。
- **拟人化 ≠ 万能**：没有任何方案声称行为随机化可替代环境真实性；AgentQL 把行为层作为 stealth 之外补充，camoufox 指纹+轨迹同时做。**行为层必要非充分**。

---

## 二、「附着用户日常浏览器（真实登录态）」支持情况（问题 2）

| 方案 | 形态 | 机制 | Chrome 136 影响 | CDP 痕迹 |
|---|---|---|---|---|
| browser-use | ①`from_system_chrome()` 接管本机 profile ②`cdp_url` 远程 | ①**以用户 profile 启动新实例**（要求先完全关闭 Chrome，非附着）②CDP | ①不受限；②自托管调试端口 + 默认 profile 被封 | ②有 |
| Stagehand | CDP attach（`localBrowser.connect({cdpUrl})`，"attach to any Chromium browser you are already running"） | CDP | 目标浏览器须先开调试端口；Chrome 136 后默认 profile 开不了 | 有 |
| AgentQL | [Connect to open tab](https://docs.agentql.com/browser/access-open-tab) | 教程即 `--remote-debugging-port=9222` + `connectOverCDP` | 同上 | 有 |
| MediaCrawler | 「默认 CDP 模式连接用户已有的 Chrome」 | CDP | 同上（Edge 暂可用） | 有 |
| Operator / ChatGPT Agent | ❌ 云端独立沙箱 | — | 不适用 | 不适用 |
| Claude computer use | ❌ 专用 VM/容器 | 截图+点击 | 不适用 | 不适用 |
| HARPA / Bardeen / AgentQL IDE | ✅ 扩展附着运行中浏览器 | Chrome 扩展 | ✅ 不受影响 | **无** |
| **Dogear** | ✅ 附着日常 Edge（NativeMessaging + 扩展） | 扩展 | ✅ 不受影响 | 无 |

### 三种架构对比

| 维度 | 独立实例+导cookie/接管profile | CDP attach 运行中浏览器 | **扩展附着（Dogear）** |
|---|---|---|---|
| 真实登录态 | 接管可得；导 cookie 次之 | ✅ 完整 | ✅ 完整 |
| 指纹真实性 | 接管 profile 高，但需关掉用户浏览器（[browser-use 明确要求 fully close](https://docs.browser-use.com/open-source/customize/browser/real-browser)） | ✅ 完全真实 | ✅ 完全真实 |
| 自动化痕迹 | patchright/camoufox 可压低但非零（InitScript timing、CDP flags） | `Runtime.enable` 类痕迹，需 CDP-Patches 级修补 | **无 CDP；唯一弱点是合成事件 isTrusted=false**（[MDN](https://developer.mozilla.org/en-US/docs/Web/API/Event/isTrusted)） |
| 政策风险 | 低 | **高**（Chrome 136 封默认 profile；Edge 截至 136.0.3240.64 未启用，[#1520 评论](https://github.com/browser-use/browser-use/issues/1520)） | 低 |
| 与用户并存 | ❌ | ✅ 占调试端口 | ✅ |
| 签名参数（小红书 x-s/x-t） | 需在页面上下文执行页面 JS 获取（MediaCrawler 做法） | 同左 | ✅ 真实导航自动携带 |
| 事件可信度 | ✅ CDP Input 域 isTrusted=true | ✅ 同左 | ⚠️ 合成为 false |

**结论**：只有扩展路线能同时做到「附着运行中浏览器 + 真实登录态 + 无自动化痕迹 + 无政策风险」。CDP attach 自 2025-05 起对 Chrome 默认 profile 被官方关闭（Edge 尚未跟进）；MediaCrawler 式「CDP 连用户浏览器」的窗口正在收窄。

---

## 三、「日常 Edge + 扩展 + 真实账号 + 只读」的风控要点（问题 3）

**最易触发风控的做法**
1. **机械节律**：等间隔操作、匀速滚动——AgentQL 官方确认这些是被测量项。
2. **高频连续请求**（短时大量搜索/翻页）：所有反 bot 的第一道阈值线；爬虫社区共识是限速+随机间隔（MediaCrawler 内置；「宁慢勿 ban」的依据）。
3. **直达深链、不做站内导航**：行为序列异常（推断项，无独立一手信源，与行为序列分析逻辑一致）。
4. **自动化痕迹残留**：headless、`navigator.webdriver`、CDP Runtime.enable、启动 flags——**扩展路线天然不存在，是最大红利**。
5. **高频关键路径合成点击**：isTrusted=false 一查便知（[MDN](https://developer.mozilla.org/en-US/docs/Web/API/Event/isTrusted)）；低频非关键点击大概率无感。
6. **环境与账号不匹配**（对照）：独立 stealth 实例 = 新指纹+无历史+数据中心 IP，反 bot 重点盯防组合——反衬「真实环境+老账号」价值。

**最有价值的防护（按投入产出排序）**
1. **真实环境 + 真实登录态本身**（Dogear 已有）：指纹/Cookie/TLS/历史全部一致；签名自动合法——MediaCrawler 的核心降险手段（[README](https://github.com/NanmiCoder/MediaCrawler)）。
2. **拟人节奏随机化**：间隔非均匀、滚动增量随机、鼠标抖动、逐键输入——AgentQL 四件套，与「拟人节奏不追求速度」完全同向。
3. **低频 + 配额 + 退避**：session 操作数上限、每日配额、风控信号后指数退避。
4. **验证码即停交还用户**：Anthropic 官方建议重要操作人工确认（[README](https://github.com/anthropics/anthropic-quickstarts/blob/main/computer-use-demo/README.md)）；Operator 遇登录/支付即请求接管（[转述](https://ai-bot.cn/operator/)）。Dogear 姿态与两大头部厂商一致，且是唯一不累积「破解尝试」风控信号的选项。
5. **域名白名单**：Anthropic 官方建议 allowlist（同上）；Dogear 域名授权是同构实践。
6. **只读优先**：read/observe 走 DOM 读取，无额外请求、无输入事件；写操作与点击降到最少。

**小红书特有（公开一手资料有限，如实标注）**
- web 端请求由页面 JS 签名（x-s/x-t）；业界主流是**在真实登录态浏览器上下文执行页面自己的签名代码**（MediaCrawler「无需 JS 逆向」）或逆向签名库（[ReaJason/xhs](https://github.com/ReaJason/xhs)、[Cloxl/xhshow](https://github.com/Cloxl/xhshow)）。Dogear 真实浏览器路线自动获得合法签名，**无需也不应触碰签名层**。
- 小红书官方风控阈值无公开一手资料；以上来自通用反 bot 原理+爬虫社区实践，**具体频率阈值需 P2 实测校准**。
- browser-use 文档提到「Google 搜索会 block 自动化浏览器，建议 DuckDuckGo」——搜索类站点对自动化最敏感，小红书站内搜索敏感度需实测（[Real Browser 文档](https://docs.browser-use.com/open-source/customize/browser/real-browser)）。

---

## 四、结论：光谱定位与替代评估（问题 4）

```
对「真实账号社交平台只读」的风控安全性：

 云端沙箱 agent        独立 stealth 实例            CDP attach 用户浏览器      扩展附着用户浏览器
 (Operator/CU agent)   (patchright/camoufox+代理)   (MediaCrawler/AgentQL)     (HARPA/Bardeen/Dogear)
 ————————————————————————————————————————————————————————————————————————————————————————→
 账号环境隔离安全       新指纹+无历史=高危组合        环境真实但有 CDP 痕迹       环境完全真实、无自动化痕迹
 但须在沙箱重新登录     账号与指纹不匹配             Chrome 136 政策封杀中       唯一弱点:合成事件 isTrusted
```

- 云沙箱 agent（Operator/Claude computer use）在「保护真实账号」目标下**不是可选项**：设计前提就是隔离环境（Anthropic 明说避免登录凭据进容器）。
- 独立 stealth 实例是「无人格爬虫小号」路线，适合无账号抓取；用在真实日常账号上是市面经验的反面教材。
- CDP attach 曾是社区主流（MediaCrawler 默认），但 Chrome 136 政策 + Runtime.enable 检测面使其收缩。
- **扩展附着**：商业上被 HARPA/Bardeen 验证可长期存活；风控上是唯一「环境零破绽」路线。Dogear「扩展+拟人节奏+验证码交人」在市面光谱里**没有直接对标物**——最接近「AgentQL 行为指南 + HARPA 附着形态 + Operator 人工接管哲学」的组合，且更保守。

### 无更稳替代，但有三条设计输入值得吸收

1. **导航类操作优先浏览器原生导航而非合成点击**（设计推演，非引用）：只读动线（搜索/翻页/打开笔记）可用 `chrome.tabs.update({url})` / `location.href` 构造真实导航（小红书搜索/笔记页均有可构造 URL），由浏览器发起完整加载、自动带签名与 Referer，**完全绕开 isTrusted 问题**；DOM 合成 click 只留给无法用 URL 表达的站内交互（展开、切换 tab），并控频。滚动（只读最高频动作）做非均匀增量+随机停顿。
2. **节奏预算显式建模**：间隔用非均匀分布（对数正态/泊松而非固定值）、session 操作数上限、风控信号触发指数退避+冷却——把「宁慢勿 ban」变成可配置预算参数。
3. **isTrusted 短板不要用 chrome.debugger 堵**：`chrome.debugger` Input 域可产生 trusted 事件，但挂「正在调试」横幅、重引入 CDP 痕迹、与扩展授权模型冲突——负收益。正解是**减少点击需求**（输入 1），不是升级点击手段。

### 对 P2 的直接输入清单

- 协议层：requestId 命令-响应、tabId 校验（P1 摸底已列）不变；操作类型建议「导航(原生)/读DOM/滚动/点击(受限)/等待」五类，**导航与滚动为一等公民**。
- 授权层：域名授权 + 每-session 配额 + 冷却状态机（风控信号驱动）。
- 工具层：observe/read_text 无风险放行；click 默认限已授权域名+低频+非关键路径；fill 在 P2 只读工作流建议禁用。
- 停机条件：验证码/滑块出现 → 立即停、留证、交还用户（与 Operator/Anthropic 对齐）。
- 观测层：把「触发风控信号」作为一等事件记录（操作类型、频率、间隔），供校准节奏参数。

---

## 信源清单

**一手（官方文档 / GitHub / MDN）**
1. browser-use README — https://github.com/browser-use/browser-use
2. browser-use Real Browser 文档 — https://docs.browser-use.com/open-source/customize/browser/real-browser
3. browser-use Remote Browser 文档 — https://docs.browser-use.com/open-source/customize/browser/remote
4. browser-use issue #1520（Chrome 136 CDP 限制）— https://github.com/browser-use/browser-use/issues/1520
5. browser-use issue #947（拟人化未实现）— https://github.com/browser-use/browser-use/issues/947
6. Chrome 官方公告 remote debugging 变更（本环境不可达，URL 得自 #1520 评论）— https://developer.chrome.com/blog/remote-debugging-port
7. patchright README — https://github.com/Kaliiiiiiiiii-Vinyzu/patchright
8. Skyvern README — https://github.com/Skyvern-AI/skyvern ；pyproject — https://github.com/Skyvern-AI/skyvern/blob/main/pyproject.toml
9. Stagehand v4 Browser 配置 — https://docs.stagehand.dev/v4/configuration/browser ；act — https://docs.stagehand.dev/basics/act
10. AgentQL User-like behavior — https://docs.agentql.com/avoiding-bot-detection/user-like-behavior
11. AgentQL Stealth Mode — https://docs.agentql.com/avoiding-bot-detection/stealth-mode-for-headless-browser
12. AgentQL Connect to open tab — https://docs.agentql.com/browser/access-open-tab
13. Claude computer use 参考实现 README — https://github.com/anthropics/anthropic-quickstarts/blob/main/computer-use-demo/README.md
14. MediaCrawler README — https://github.com/NanmiCoder/MediaCrawler
15. MDN Event.isTrusted — https://developer.mozilla.org/en-US/docs/Web/API/Event/isTrusted
16. camoufox README — https://github.com/daijro/camoufox ；HumanCursor — https://github.com/riflosnake/HumanCursor
17. undetected-chromedriver README — https://github.com/ultrafunkamsterdam/undetected-chromedriver
18. HARPA AI — https://harpa.ai/ ；Bardeen — https://www.bardeen.ai
19. ReaJason/xhs — https://github.com/ReaJason/xhs ；Cloxl/xhshow — https://github.com/Cloxl/xhshow

**二手（已标注）**
20. OpenAI Operator 介绍（ai-bot.cn 转述；openai.com 本环境不可达）— https://ai-bot.cn/operator/

**环境限制说明**：openai.com / platform.openai.com / developer.chrome.com / wikipedia / web.archive.org 在本次调研环境不可达；涉及 Operator 云端沙箱细节仅以二手转述呈现，其余结论均有一手信源。
