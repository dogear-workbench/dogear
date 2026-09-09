# 浏览器能力统一（内嵌宿主 + 能力协议层）设计

**日期**：2026-09-08
**状态**：设计拍板（基于本日形态深度讨论，对照 Proma 源码验证）
**上游**：
- 形态讨论结论（内嵌为主宿主 + 能力协议是本体 + 结构化降层）
- Proma 源码对照（`C:\Proma\apps\electron\src\main\lib\browser-*.ts`）
- 前置设计：`../browser-exploration-design.md`（站点档案部分保留，「工具层没有问题」的拍板被本设计推翻修正）

## 背景与动机

P3 验收发现 agent 行为剧本化（页面偏离即上报失败）。当日设计将根因归于「引导写成剧本」，拍板「工具层没有问题」。**本设计推翻该拍板的第二半**：对照 Proma 源码与 dogear 现状代码，工具层存在实打实的能力差距：

| 能力 | Proma | dogear 现状 |
|---|---|---|
| 观察机制 | `Accessibility.getFullAXTree` 语义完整 | CSS 选择器白名单枚举 |
| Shadow DOM | AX Tree 天然覆盖 | querySelectorAll 不穿透 |
| ref 机制 | backendNodeId + generation，可校验失效 | data-dogear-ref DOM 属性，SPA 重渲染即丢 |
| 语义重查找 | BrowserFind（role+name） | 无（仅 observe 时 textFilter） |
| 容器内滚动 | BrowserScroll(selector) 带 before/after | 无 |
| 截断 | 全树 | 硬截 120 元素 |

同时修正一个风控误判（拍板记录）：此前判断「内嵌 Electron 抓搜索引擎会被 Google 强拦」，**错误**。Proma 实证：WebContentsView + 持久 partition + UA 去掉 `Electron/` 标记（保留诚实 `Proma/版本`），直接访问 Google 搜索页可用。搜索引擎风控的真实维度是 IP 信誉 / Cookie 历史 / 频率 / headless 与 CDP 自动化指纹，WebContentsView 是真实用户态 Chromium 页面，天然无 Playwright 痕迹——Patchright 的增益（隐藏 Playwright/CDP 痕迹）在该宿主上为零。

## 核心主张

```
能力协议层（本体，宿主无关）
  ├─ Tab 模型：统一 tabs，来源标记 agent-opened / user-connected
  ├─ 观察原语：observe（AX 语义树）/ find（role+name 重查找）/ read_text / read_state
  ├─ 操作原语：navigate / click / fill / scroll（含容器）/ press / wait_for / screenshot
  ├─ 代际与恢复：generation/ref 绑定、失效自动重观察、页面状态机
  │    loading / ready / login_required / verification_required /
  │    awaiting_human / rate_limited / changed_layout / crashed
  └─ 双向交付：用户 → agent（连接 tab 无损进入）· agent → 用户（页面呈现）
        ├── 宿主 A：内嵌 WebContentsView（主力，agent 默认，持久登录态）
        └── 宿主 B：用户 Chrome（扩展通道，用户页面 + 已有登录态）
```

1. **能力协议是本体，宿主是皮**：agent 只见一套工具语义；路由（agent 主动浏览 → 内嵌；用户页面/强登录墙 → 扩展）是策略层的事
2. **结构化降层**：SERP parser / readArticle 从「独立管线」降为「能力之上的快捷档」，失败返回 `pageAvailable + 恢复建议` 而非「失败」
3. **风控哲学**：遇到验证/登录 → 暂停等人（产品流程），不搞技术对抗
4. **Patchright 停止新增投入**：底层切换完成后退役删除

## 内嵌宿主设计（对照 Proma 复刻/差异化清单）

### 复刻

| 模块 | Proma 参考 | dogear 落点 |
|---|---|---|
| WebContentsView 管理（tab 生命周期、前后台 detach/attach） | browser-controller.ts | 新 `electron/main/services/browser/embedded/` |
| persistent partition（按 workspace 隔离，hash 不可反推） | browser-profile-policy.ts | 同思路，`persist:dogear-browser-<hash>` |
| 诚实 UA（去 `Electron/` 标记 + `Dogear/版本`，不伪造） | browser-identity.ts | 同款一行处理 |
| AX Tree 观察（CDP `Accessibility.getFullAXTree` + `DOM.getBoxModel`） | browser-cdp.ts / observation-policy | CDP attach 内嵌 webContents |
| generation/ref（导航/渲染变化使 ref 失效，操作前校验） | browser-controller.ts RefEntry | backendNodeId + generation |
| activeTabId / agentTabId 分离（用户看的 ≠ agent 操作的） | browser-controller.ts | Tab 模型内置 |

### 差异化（dogear 特有，保留）

- **read_state**（Vue/React 框架状态读取 + 探索回路）：dogear 独有，扩展通道已有，内嵌通道用 `executeJavaScript` 实现同语义
- **site-policy 风控资产**：节奏预算、随机延迟、风控关键词、域名授权、guard_password/guard_submit——平移挂到内嵌宿主的 policyGate，agent 不可违反
- **站点档案**（`na5txjbb` 刚实施的知识层）：两区结构保留，`site_knowledge/site_finding` 工具按宿主路由挂载
- **NM 扩展通道**：Proma 没有，dogear 保留（用户真实 Chrome 登录态 + 「我正在看的页面」场景不可替代）

## 抓取迁移（Step 4 详述）

- `searchWeb` 底层从 Patchright → 内嵌宿主：后台 view 加载搜索 URL → 成功则 SERP parser 快档返回结构化；`parse_empty` / 验证页 → 返回 `{ ok: false, pageAvailable: true, tabId, suggestedNextTools }`，页面保留给 agent 探索
- Google `/sorry/` 检测 + 用户人工过验证的现有逻辑平移到内嵌窗口
- `readArticle` 同步迁移：内嵌加载 + `executeJavaScript` 取 HTML + 现有 readability 链
- 引擎降级链（Google → DDG → Bing）保留

## 现有资产处置表

| 资产 | 处置 | 时机 |
|---|---|---|
| Patchright browser-manager + 受控浏览器窗口 | 底层切内嵌后**删除**（窗口突兀/单 tab/过程不可见的根源） | Step 6 |
| serp-parsers.ts | 保留为快档 | Step 4 |
| browser-search-service / browser-article-service | 底层换宿主，语义加降级 | Step 4 |
| 扩展六工具（navigate/click/fill/observe_page/read_state/read_text） | 对齐能力协议（语义树改造） | Step 5 |
| site-policy / risk 预算 | 平移到内嵌 policyGate | Step 3 |
| 站点档案 + 探索方法论 Profile（na5txjbb） | 保留；方法论与能力协议互补 | 不动 |
| NM 四件套修复（断开按钮/gateway 退出收尾/安装器时序/心跳） | 并入扩展对齐步骤一起做（同文件避免并行冲突） | Step 5 |

## 排除的选项（拍板记录）

- **维持三通道并列（Patchright 守搜索 + 内嵌守操作 + 扩展守登录态）**：基于已被推翻的风控误判；且通道并列正是「乱」的根源
- **在扩展通道上先补工具再换宿主**：观察原语的天花板受 content script 限制（AX tree 不完整、CDP 不可用），投入在要改造的旧底座上不值
- **内嵌宿主上做反检测伪装（伪造 UA 隐藏身份）**：Proma 实证诚实标识可用；伪装违反项目风控哲学
- **search 失败自动重试 N 次**：错误方向——失败语义应该是「页面还在，agent 请自己看」，不是重试同一管线

## 步骤索引

见 [plan.md](./plan.md)，6 步。
