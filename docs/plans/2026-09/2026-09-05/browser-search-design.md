# 浏览器 WebSearch 设计（agent 搜索能力，独立小项）

**日期**：2026-09-05
**状态**：设计拍板，待写实施计划
**定位**：插队独立小项（方案 A）——不等三期扩展+NM，复用一期受控浏览器全部基建，给 agent 补「发现内容」的能力；三期上线后底层通道可无缝升级真实浏览器，接口不变
**上游讨论**：本文件自足；三期背景见 [../2026-09-04/browser-phase3-kickoff.md](../2026-09-04/browser-phase3-kickoff.md)

## 背景

- agent 目前只能读**已知 URL**（readArticle + 原子探索工具组），没有搜索发现能力；项目不引第三方搜索 API（零外部 key 依赖）
- 搜索引擎对纯 fetch 全线 403/验证页，浏览器指纹真实可过；受控浏览器（headless: false，真实 Chromium stable + 持久 profile）现成
- 用户本机 Clash 常驻（本地端口 7890），Google 可达性问题用按域代理分流解决

## 目标

1. 新工具 `dogear__browser__search(query)`：query → 结构化 SERP 列表（title / url / snippet），agent 搜到再用 readArticle 读，形成「发现 → 阅读」闭环
2. 引擎降级链 **Google → DuckDuckGo HTML → Bing cn**，全自动；验证页 / 代理故障有明确检测点
3. 代理按域 PAC 分流：显式指向 Clash 本地端口，**不受系统代理开关影响**，Clash 退出自动降级 Bing

## 架构

### 引擎链

```
默认引擎 auto（可配置 google / bing）
Google   —— patchright + 代理 + profile 登录（一次性人工登录，持久 profile 记住）
  ├─ sorry page（URL 含 /sorry/）→ 降级
  ▼
DDG HTML —— html.duckduckgo.com/html/?q=（走代理；无 JS 纯静态页，零反自动化检测，最稳）
  ├─ 代理不可用 →
  ▼
Bing cn  —— cn.bing.com/search?q=（直连，零依赖兜底）
```

- **百度不做**（拍板：安全验证频率高 + DOM 乱）
- SERP 解析器 ×3（引擎专用选择器）：Google（#search/#rso 系，实施时按实际 DOM 定）、DDG（html 版结构稳定）、Bing（#b_results li.b_algo 系）

### 反检测策略（分层递进，YAGNI）

- 检测面三层：环境指纹 > IP 信誉 > 行为特征。已占优势：家宽 IP、headful、真实 Chromium、持久 profile
- **MVP 不做行为模拟**：直接 goto SERP URL + 请求间随机延迟；行为模拟对「搜索框查询」收益最低，被卡再升级
- **指纹层用 patchright**（Playwright 的 drop-in 反检测 fork，`import { chromium } from 'patchright'`）：browser-manager 的 chromium import 替换为 patchright（API 兼容，全项目浏览器代码受益）；**引入风险作为 step1 首要验证项**——pipeline 11/11 回归必须过，有坑则 Google 暂缓、只上 Bing+DDG（DDG 零检测不受影响）
- **验证页人工兜底**：窗口可见 + profile 持久，检测到验证页 → 报告降级 + 提示用户可在窗口人工过验证（过一次 profile 记住）
- **红线**（沿用项目红线）：不自动破解 CAPTCHA / 不绕风控，只做降低误伤概率

### 代理（PAC 按域分流）

- 设置项 `browserProxyServer`（如 `127.0.0.1:7890`，支持 http/socks5，预填提示 Clash 默认混合端口；空 = 禁用代理引擎，仅 Bing）
- launch 注入 PAC：`.google.com / .googleusercontent.com / .gstatic.com / .googleapis.com / .ggpht.com / duckduckgo.com` 走代理，**其余全部 DIRECT**（Bing、读文章不受影响）
- 优先 `--proxy-pac-url=data:...` 内嵌；遇 Chromium data URL 怪癖则降级临时文件 file://（实施时验证）
- 显式指定不读系统代理 → Clash 开关系统代理无影响；**只要求 Clash 进程活着**（端口连通）
- 代理健康探测（轻量请求 2s 超时）：不可用 → auto 默认引擎直接 Bing，不干等 Google 导航超时

### 工具与权限

- `dogear__browser__search(query, maxResults?)`：声明式高层工具（同 readArticle 定位），默认返回 top 8（上限 15）
- 返回：`{ engine, query, results: [{rank, title, url, snippet}], degradations }` 文本化；失败提示降级原子工具（navigate 搜索引擎 + observe_page 手动探索）
- **不进 BROWSER_INTERACTIVE_TOOLS**（readArticle/click/fill 是 ask）：search 只读无副作用且高频（一轮研究搜 3-5 次），逐次确认损害体验；autoExecute 模式行为不变

## 模块边界

| 模块 | 改动 |
|---|---|
| `electron/main/services/browser/browser-search-service.ts` | **新建**：引擎编排（auto/降级链）+ 3 个 SERP 解析器 + 验证页/代理故障检测 |
| `electron/main/services/browser/browser-manager.ts` | patchright import 替换 + launch 注入 PAC（读设置项） |
| `electron/main/agents/tools/browser-tools.ts` | 注册 search 工具（registerToolGroup 体系，无新增能力开关，跟随 browser 能力域） |
| `electron/main/services/settings-types.ts` / `settings-service.ts` | `browserProxyServer`、`browserSearchEngine`（auto/google/bing） |
| 设置 UI | 浏览器小节：代理地址输入 + 默认引擎下拉（落点对齐现有设置 tab，实施时定） |
| `resources/browser-eval/` | mock SERP 页 ×3（本地 file://，注意 `<meta charset="utf-8">` 坑）+ pipeline 断言 + run-agent.mjs 加 search 任务 |

## 数据流

```
agent 调 search(query)
  → browser-search-service：解析引擎配置（auto → 代理健康探测 2s → google|bing）
  → browser-manager.acquire（持久 profile、可见窗口）
  → goto SERP URL → 验证页检测 → SERP 解析（选择器）→ 结构化列表
  → 逐级降级（记录原因）→ 文本化返回（含 degradations）
  → release（空闲 3min 自动关浏览器，沿用 manager 现状）
```

## 错误处理 / 边界情况

- Google sorry page（URL 含 `/sorry/`）→ 降 DDG + 结果附提示「可在浏览器窗口人工过验证，profile 会记住」
- 代理探测失败 / Clash 退出 → 跳过全部代理引擎 → Bing；Bing 是零依赖兜底，Bing 也挂才算真失败
- 解析空（引擎改版选择器 miss）→ errorClass 风格 `parse_empty` + warning + 建议换引擎 / 原子工具手动探索；不 AI 兜底（沿用二期决策）
- patchright 引入失败（bun 安装 / electron 打包 / pipeline 回归问题）→ 降级方案：仅 Bing+DDG，Google 标记暂缓
- maxResults 夹紧 1-15；query 空串直接参数错误

## 未决问题

- Google SERP 选择器以实施时实际 DOM 为准（Google 改版频繁，解析器写宽松匹配 + 多候选选择器）
- 设置 UI 具体落点（现有设置 tab 结构里挑合适位置）
- patchright 与 playwright 包并存策略（patchright 是否复用 ms-playwright 浏览器缓存）step1 验证时定

## 与三期的关系

search 是「agent 操作浏览器」路线的第一块通用能力透支，不影响三期场景定位（真实登录态社交操作）；三期 observe/a11y 树通用化后 search 工具接口不变、底层通道可升级（真实浏览器搜 Google 更稳）。三期候选方向另行立项。
