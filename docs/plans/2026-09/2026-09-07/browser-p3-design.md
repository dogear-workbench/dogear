# 浏览器三期 P3：扩展通道修复 + 站内搜索工具化 设计

**日期**：2026-09-07
**上游**：P2 小红书调研工作流（../2026-09-06/browser-p2-xhs/，已完成）；装修调研实战复盘（2026-09-07 两个双子会话）
**状态**：设计拍板

## 背景（实战证据链）

2026-09-07 装修调研是扩展通道首次真机实战：通用链路（`browser__search` → `readArticle`）全程稳定（知乎全文 7 篇、搜狐、网易转载完整读到），但小红书详情页读取失败，回查双子会话动作流（`01a07af7-968c` / `01a07af7-96b7`）定位三个根因：

1. **并行子会话互踩单 tab（主因）**：扩展连接是单 tab 的，主会话并行派两个调研子会话，各自导航到不同关键词——「页面在两个搜索间震荡」「被弹到首页推荐流」全是互踩表现；次生灾害是反复重导航烧光 5 次搜索预算
2. **observe_page 不透出 href**：`extension/src/dom-actions.js` 的元素序列化只有 `{ref, tag, role, text, hint}`，agent 拿不到笔记直链，进详情只剩「点击卡片」一条路
3. **feed 页持续重渲染 + 弹层行为未验证**：observe→click 之间 ref 已失效，点击连续被判失败；P2 设计时标注的「小红书弹层待真机验证」实战结论是走不通

同时确认：站内搜索才能拿到的数据（互动量排序）是通用引擎的盲区，Reddit/知乎有同构需求。

## 目标

1. **A1 扩展通道会话独占**：根治互踩
2. **A2 observe 透出 href**：agent 可拿直链用真实导航直达详情（落实「导航优先于合成点击」原则）
3. **A3 `read_state` 通用命令**：读 SPA 页面 `__INITIAL_STATE__`，彻底避开 DOM 重渲染 / 120 元素上限 / 8000 字符截断
4. **B 站内搜索工具化**：`search` 加 `site` 参数，reddit/zhihu 站内引擎带互动量元数据，降级退回 `site:` 通用搜索

**硬约束（用户拍板）**：稳定优先，任何新增能力不得扩大风控暴露面。

## 架构

### A1 · 会话级独占（gate 落工具层，不动协议）

- 五个 `dogear__extension__*` 工具入口统一过 ownership gate：首个发命令的 conversationId 持有通道；其他会话调任何扩展工具 → isError 明确文案「扩展通道正被另一个会话使用，请等它完成后串行派遣」
- 释放：持有者**空闲 10 分钟**自动释放（小红书节奏下单命令间隔可 90s+，宽松防误释放），或扩展断连清零
- 不做排队（随机延迟下等待不可预期，明确报错让主会话改串行更可控）；无 conversationId 的 adhoc 调用不参与独占
- 软引导：浏览器解析 Profile 描述加「扩展通道同一时间仅一个会话可用，勿并行派遣多个扩展子会话」
- 显式决策：搜索/笔记预算机制不动（互踩修复后「重导航烧预算」症状自然消失；预算是风控护栏，放宽需另行论证）

### A2 · observe_page 透出 href

- `dom-actions.js` observeFn：`<a>` 元素用 IDL 属性 `el.href`（自动补全为绝对 URL）序列化为可选 href 字段，截断 400 字符（小红书卡片直链含 xsec_token 约 200+ 字符，400 放得下；超长截断加省略标记）
- 协议 elements 数组加可选字段（旧扩展不回不炸，单向兼容）；工具层 `formatObserve` 输出行加 `href="..."`
- 效果链：搜索页 observe → 笔记直链 → `navigate` 真实导航直达详情 → 绕开弹层与重渲染

### A3 · `read_state` 通用命令（读 SPA 内存态，零新增网络请求）

- 扩展协议 +1 命令 kind `read_state`，协议版本号递增（旧扩展收到 stale_protocol 提示重载）
- 双模式：**不传 path** → 返回 `window.__INITIAL_STATE__` 顶层 key 概要（key: 类型/子项数/字符串长度），供探索；**传 path**（点分路径，数字段为数组下标）→ 返回该子树 JSON.stringify，截断 8000 字符
- 工具 `dogear__extension__read_state`，与 read_text 同等待遇（风控约束落实）：
  - 过 policyGate 随机延迟
  - 返回内容过风控关键词扫描（命中即停标记）
  - 计入笔记预算，**按「每个新页面 URL 计 1 次」**（同页多路径探索不重复计数；读内存 JSON 无网络请求，保守取页面级计数）
- 站点特化解析（小红书卡片字段路径等）放 agent/上层，extension 保持通用
- 不存在 `__INITIAL_STATE__` 的页面 → 明确返回「本页无 __INITIAL_STATE__」

### B · 站内搜索（受控浏览器，不碰扩展通道）

- `dogear__browser__search` 加可选 `site` 参数（`'reddit' | 'zhihu'`）；不传走现有降级链，行为不变（向后兼容）
- `site='reddit'` → 受控浏览器导航 `old.reddit.com/search?q=`（静态 HTML 解析最稳），结果带 score/评论数/subreddit/发布时间
- `site='zhihu'` → 知乎搜索页（SPA 渲染后解析，优先页面状态 JSON，DOM 兜底），结果带作者/赞同数
- **降级链**：站内引擎失败 → 自动退回 `site:域名` 通用搜索（丢互动量但保可用），原因照旧附 `degradations`
- 网络：reddit 系域名加进 PAC 代理分流域（与 Google 同待遇，Clash 退出则 reddit 站内不可达触发降级）；知乎直连
- reddit/zhihu 不加 SitePolicy 节奏限制（公开内容正常浏览器访问，与现有 readArticle 同级风险；被卡再补，YAGNI）

## 模块边界

| 模块 | 改动 |
|---|---|
| `extension/src/dom-actions.js` | observeFn 加 href 序列化；新增 readStateFn（path 导航 + 截断） |
| `extension/src/nm-protocol.js` + `electron/main/services/browser/nm-protocol.ts` | read_state kind、elements 可选 href 字段、协议版本号递增——两份同步改 |
| `extension/src/background.js` | read_state 命令路由 |
| `electron/main/services/browser/browser-gateway.ts` | read_state 命令路由（对齐 navigate 先例） |
| `electron/main/agents/tools/extension-tools.ts` | ownership gate（5 工具入口）、read_state 工具、formatObserve 加 href、笔记预算按 URL 计数 |
| `electron/main/services/browser/browser-search-service.ts` | reddit/zhihu 站内引擎 + SERP 解析器 + `site:` 降级 |
| `electron/main/services/browser/browser-manager.ts` | PAC 分流域加 reddit 系域名 |
| `electron/main/agents/tools/browser-tools.ts` | search 工具加 site 参数 |
| 浏览器解析 Profile 内置描述（settings-types.ts） | 独占提示 + read_state 能力说明 |
| `resources/browser-eval/` | gate 冒烟、read_state 冒烟、site 引擎冒烟 |

## 数据流

- A1/A2/A3：子会话工具调用 → ownership gate → policyGate（延迟/风控前置）→ gateway（域名授权校验）→ NM → 扩展 SW → 页面 → 结果回传（风控关键词扫描 / 预算计数）→ 动作账本
- B：agent 调 `search(query, {site})` → search-service 站内引擎 → browser-manager（PAC 分流）→ 导航 + 解析 → 结构化列表（含互动量）→ 失败降级 `site:` 通用链

## 错误处理 / 边界情况

- 独占冲突文案含「请等它完成或稍后重试」，不暴露 conversationId（UUID 对用户无意义）
- read_state path 不存在 → 返回错误 + 该层可用 key 清单提示
- `__INITIAL_STATE__` 缺失 / 非 JSON 序列化对象（循环引用等）→ 明确错误文案，不抛异常
- 协议版本不匹配 → 现有 stale_protocol 文案引导重载扩展（实施后需真机重载一次 unpacked 扩展）
- reddit 解析空（改版）→ `parse_empty` 风格告警 + 自动降级 `site:reddit.com`
- 知乎未登录时搜索页部分可见 → 解析到什么返回什么 + 降级提示；不做登录引导（受控浏览器登录墙走现有 need_login 路径）

## 未决问题（实施时探）

- 小红书搜索页 `__INITIAL_STATE__` 内卡片字段具体路径（真机探，做成工具描述里的提示示例）
- 知乎搜索页状态结构 / DOM 选择器（真机探）
- old.reddit 搜索结果选择器（以实施时实际 DOM 为准，宽松匹配）
- href 400 截断对个别超长 token URL 的影响（超长链接 agent 可改用 read_state 精确取）

## 明确排除（记档）

- 多 tab 管理 / 排队等待 / 用户操作检测互斥（P2 排除项维持）
- BrowserAdapter 抽象（继续延后，两实现仍不够齐稳）
- reddit/zhihu SitePolicy 节奏限制（YAGNI）
- 预算机制调整、日级配额（P2 已排除）
- 小红书协议逆向（红线维持）
