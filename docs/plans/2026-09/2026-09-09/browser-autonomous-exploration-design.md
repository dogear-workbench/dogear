# 浏览器自主探索闭环 设计

**日期**：2026-09-09
**来源**：笔记 np1ynvws / 5qoe5wip（Google 无解定论撤回）、mwwlp0su（纵向原型链路与接管机制建议）、r3hsb3vz（路线图拍板）、Proma 源码对照（BrowserSlot 同步链路）

## 背景

Google 搜索「无解」结论已撤回：页面能加载出结果，但 SERP 解析器过滤 `/goto` 链接 → parse_empty → 自动降级把有结果的页面导航走，agent 从未获得探索机会。真正差距是 **Proma 在工具受挫后仍能换方式继续，而我们把「结构化解析成功」当成了任务生死判官**。

代码核对确认 8 项缺口仍在（见下「模块边界」对照）。渲染方案已确认不换：WebContentsView 是 Electron 标准方案（Proma 同款），延迟问题出在 bounds 同步链路（120ms 防抖 + 无竞态防护），不在方案本身。

## 目标

围绕「真正自主探索 + 友好人机交互」，打通纵向原型链路：

> 对话提出问题 → 网页打开呈现 → agent 搜索并进入结果 → 用户接管页面 → 用户交还控制 → agent 重新观察，从当前页继续

**五个验收场景**：

1. **陌生网站**：无站点档案，快档失败 → agent 用原子工具观察/点击/读取，找到内容并给出处
2. **Google parse_empty**：页面有结果但解析为空 → 页面保留 → agent 观察 + 点击结果 + 拿到最终 URL
3. **登录接力**：agent 停等用户 → 用户在内嵌页面完成登录/验证 → 点「完成后继续」→ agent 从当前页面继续，不重跑
4. **接管互斥**：agent 操作中用户点「接管」→ agent 后续页面写操作被拒 → 用户「交还」→ agent 重新观察继续
5. **页面偏离**：接管期间用户跳到别的页 → 交还时 generation 递增旧 ref 全失效 → agent 重新判断而非照旧点击

## 架构

### 排除的选项

| 选项 | 排除原因 |
|---|---|
| Google `/goto` 不过滤、直接进 SERP 结果 | url 契约破坏（navigate 直开 `/goto` 不可靠，点击才是正路）；保持「快档=结构化提取，探索=浏览器交互」分层 |
| 自由并发（无锁，靠 generation 兜底） | 验收 4 过不了：用户操作时 agent 又把页面导航走 |
| `<webview>` 标签 / 截图流 | 官方不推荐 / 交互反向注入延迟高；WebContentsView 已定 |
| 移除 SERP 快档 | 成功路径省 token 省时间；只降级其角色，不再决定任务生死 |

### 第一批 · 探索闭环两条腿

**1. 搜索诚实失败**（`browser-search-service.ts` + `serp-parsers.ts`）

- parse_empty 判定前，对当前页做轻量 DOM 探测：SERP 结果容器内 `a[href]` 数量 + 正文字数（探测函数按引擎给选择器，失败按通用兜底）
- **有结果可探索** → 不降级、不导航走：返回结构化失败 `{ok:false, errorClass:'parse_empty', pageAvailable:true, tabId, url, hint:'页面有结果但结构化解析失败，页面已保留，请用 observe_page 观察 + click 点击探索'}`，页面 promote 给 agent（沿用 `promoteFetchTab`）
- **真无结果**（结果链接 ≈ 0 且正文极短）→ 维持降级链
- 解析前读一段正文传 `resolvePageState(current, text)`，挑战页不再误报 ready → parse_empty
- 探测自身异常 → 保守按「有结果可探索」处理（宁可误保留页面，不可误杀）

**2. 验证页冻结**（`browser-search-service.ts`）

- 验证页判定后：呈现（`presentVerification`）+ **补 raise 等待人工卡片**（现在搜索路径只呈现不 raise，readArticle 才 raise——统一走「完成后继续」链路）
- 该 tab 从降级循环摘除（`tabBox.current = null`），下一引擎开新 tab——呈现给用户的验证页绝不被导航走

**3. 接回 Agent**（`tipc/browser.ts` + `pi-session-manager.ts`）

- `resolveHumanIntervention(id, 'user')` 成功且 `taskMeta.conversationId` 存在 → `getSessionIdByConversation` → `getSession` → `sendMessage(唤醒消息)`
- 唤醒消息带上下文：`用户已在浏览器完成人工处理（{reason}，tab 当前 URL: {url}）。请重新观察该 tab 的当前页面状态后继续任务，不要从头重跑。`
- `PiSession.sendMessage` 已内置 paused/idle→prompt、running→steer 分支，零改动复用
- glue 放 tipc 路由层（可同时 import services 与 agents，避免 services→agents 反向依赖）；`human-intervention.ts` 保持纯状态模块
- conversationId 为空（手动解析任务）或会话已不存在 → 维持现状只解除，日志留痕

**4. 接管互斥（显式锁）**（`embedded-browser-manager.ts` + `browser-action-tools.ts` + `tipc/browser.ts` + 前端）

- Tab 增加接管状态：`takeover: { active: boolean; taskMeta?: BrowserTaskMeta } | null`（默认 null = agent 控制）
- 新增 tipc：`takeOverTab(tabId, taskMeta?)` / `releaseTakeover(tabId)` + 广播事件 `tabTakeoverChanged`
- agent **写操作**工具（navigate/click/fill/scroll/press/wait_for）入口前置检查：接管中 → `isError: 'user_takeover：用户已接管该页面，操作暂停，等待用户交还控制权'`；**读操作**（observe/read_text/read_state/screenshot）放行
- 交还动作：解锁 + generation 递增（旧 ref 全失效，天然覆盖页面偏离）+ 若 `taskMeta.conversationId` 存在走与「完成后继续」相同的唤醒函数（消息：`用户已交还页面控制权，请重新观察当前页面后继续`）
- 与 awaiting_human 的关系：两个独立状态（awaiting=agent 请求帮助，takeover=用户主动介入），共用「解除即唤醒」链路；UI 上两个按钮、两种文案

### 第二批 · 观察/操作质量

**5. click 双触发修复**（`actions.ts`）：checkbox/radio（useSpace 分支）键盘激活后回读 `checked`，已翻转则跳过 synthetic 兜底
**6. observe_page DOM 兜底**（`ax-observe.ts` / `browser-atom-tools.ts`）：AX 可交互元素 < 5 且正文充足 → 附加前 N 个 `a[href]` 的 text+href 摘要段（Google 结果页 AX 只见容器的直接解法）
**7. 代理 PAC 修正**（`proxy.ts`）：`socks5://` → `SOCKS` 前缀、`http(s)://` 与裸 host:port → `PROXY`；清空代理显式回退直连；TCP 探测维持（升级为经代理 CONNECT 属过度设计）

### 第三批 · UI（浏览器为主体）

**8. BrowserPanel 重构**：地址栏（后退/前进/刷新/URL 输入，作用于呈现 tab）+ 页面占满面板 + 等待人工横幅置顶 + 「接管/交还」按钮 + 动作日志折叠抽屉（默认收起）
**9. bounds 同步重写**（`presentation.ts` + `BrowserPageView.tsx`）：rAF 每帧上报（去 120ms 防抖）+ 全局单调 revision 拒晚到布局 + 每 tab lastBounds 恢复（对齐 Proma BrowserSlot）
**10. 地址栏导航作用于呈现 tab（activeTabId）**，与 agentTabId 分离不动摇

## 模块边界

| 文件 | 改动 |
|---|---|
| `electron/main/services/browser/browser-search-service.ts` | 探测函数、诚实失败、验证页冻结摘 tab、resolvePageState 传正文 |
| `electron/main/services/browser/serp-parsers.ts` | 新增结果容器探测函数（各引擎选择器） |
| `electron/main/services/browser/human-intervention.ts` | resolve 返回 taskMeta（供 tipc 层唤醒） |
| `electron/main/services/browser/embedded/embedded-browser-manager.ts` | tab takeover 状态 + generation 主动递增接口 |
| `electron/main/services/browser/embedded/actions.ts` | checkbox/radio 状态回读 |
| `electron/main/services/browser/embedded/ax-observe.ts` / `agents/tools/browser-atom-tools.ts` | observe DOM 兜底、写工具 takeover 前置检查 |
| `electron/main/services/browser/embedded/proxy.ts` | PAC 前缀修正 |
| `electron/main/services/browser/embedded/presentation.ts` | rAF+revision+lastBounds |
| `electron/main/tipc/browser.ts` | takeOver/release 路由 + 唤醒 glue + 广播 |
| `components/companion/BrowserPanel.tsx` / `BrowserPageView.tsx` / `BrowserInterventions.tsx` | 地址栏、占满、横幅、接管按钮、日志抽屉、rAF 上报 |

## 数据流（关键链路）

```
搜索 parse_empty
  → DOM 探测有结果 → promote 页面给 agent → 结构化失败返回 → agent observe_page(含链接兜底)
  → click 结果 → 拿最终 URL → read_text → 交付
用户接管
  → takeOverTab → 广播 → agent 写工具被拒（isError 引导收尾等待）
  → 用户操作页面（可能跳转，generation 自然递增）
  → 交还 → 解锁 + generation 递增 + 唤醒会话 → agent 重新观察继续
登录/验证
  → raise awaiting_human + 呈现冻结 tab → 用户完成点「继续」
  → resolve + 唤醒会话（带 tab 当前 URL）→ agent 从当前页继续
```

## 错误处理 / 边界情况

- 接管瞬间 agent 单个动作已在执行：不中断进行中的动作，仅拦截后续工具调用
- 唤醒时会话 running：steer 插话（PiSession 已处理）；paused：prompt 恢复；不存在：仅解除+日志
- 同会话多条等待人工（多 tab）：点一条继续只发一次唤醒，agent 重新观察时自然覆盖其余 tab
- 探测函数异常/选择器失效：保守视为「有结果可探索」保留页面
- 验证页 tab 生命周期：present retain + 用户收起即 release，TTL 兜底回收（现有机制不动）
- 交还唤醒后 agent 长回复：steer 语义天然如此，上线后观察

## 未决问题

- 日志折叠形态（底部抽屉 vs 顶部时间轴胶囊）：第三批实施时按效果定
- 搜索快档在「有结果可探索」时是否也附探测到的标题列表（进一步省一轮 observe）：第一批先只给信号，看实际 token 消耗再定
- 接管按钮对「agent 无操作意图」的 tab 是否隐藏：实施时看 UI 表现
