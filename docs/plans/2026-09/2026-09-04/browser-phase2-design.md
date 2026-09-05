# 浏览器二期设计（补漏收口 + 分发修复）

**日期**：2026-09-04
**状态**：设计已拍板，待写实施计划
**上游**：笔记 r1nwc444《浏览器自动化分期路线与核心点》、一期实施计划（../2026-09-03/browser-article/plan.md，六步已完成）、本目录两份勘查报告
**范围决策**：二期 = P0 分发修复 + 一期遗留清单（A 清单 6 项）；**扩展 + NM 单独立项为三期**（勘查结论「可立项、无工程阻塞项」，报告已归档本目录）；Stagehand 不嵌入、借鉴项并三期

## 背景

一期（受控浏览器 + 文章解析兜底层）六步落地，管线回归 9/9 PASS，收尾回填遗留清单（resources/browser-eval/baseline.md）；两份勘查另发现安装版 Chromium 缺失的现存分发 bug。二期收口这些问题，让文章读取对真实用户真正可用。

## P0：安装版 Chromium 缺失修复（分发 bug）

**现状**：NSIS 安装包未携带 Playwright Chromium，browser-manager 未指定 `executablePath`/`channel`（browser-manager.ts:144-149）——干净机器上受控浏览器必然启动失败，只在装过 Playwright 的开发机碰巧可用。

**方案**（勘查结论 B+C 组合）：
- **懒下载**：首次需要浏览器时（readArticle / 浏览器工具）检测 ms-playwright 缓存不存在 → 下载 Chromium（npmmirror → 官方 CDN fallback，实测 npmmirror 个别 revision 缺包必须有 fallback）→ 落默认位置 `%LOCALAPPDATA%\ms-playwright`；带进度与失败重试 UI
- **自动降级链**：ms-playwright 缓存 → `channel: msedge` → `channel: chrome`；全部不可用时报错并引导（安装浏览器或检查网络）
- **排除**：extraResources 随包（+140~170MB，下载转化代价，SmartScreen 与体积无关但下载成本真实）

## ① 翻页拼接

- **触发**：展开启发式命中「下一页」类白名单按钮时进入翻页循环模式（不再按「展开」处理——点击一次即停是现状缺陷，翻页文章只取到最长单页约 1/3 内容）
- **循环**：采集当前页正文片段 → 点「下一页」→ 等稳定（innerHTML 替换型等 DOM settle；URL 跳转型等导航完成）→ 再采集；终止：按钮消失/禁用、正文不再新增、**20 页上限**
- **拼接**：每页 Readability 片段，块级文本指纹去重（页眉页脚/重复段），标题取第一页
- **降级**：共用 60s 任务级超时；超限/超时取已采集部分落盘 + `quality_warning` + qualityHint「翻页未完成（已采集 N/M 页）」，不硬失败
- **测试**：browser-eval 翻页任务断言更新为「三页标记全部存在」

## ② 登录墙检测盲区修复

**根因**：`innerText` 对 `display:none` 元素退化为 `textContent`（不做可见性裁剪），「正文隐藏在标准容器（article/main 等）内」的登录墙页面 container 度量虚高 → `domWall` 漏判 → 解析继续且 Readability 把隐藏正文正常提取返回。

**修复**：measureTextFn 放弃依赖 innerText 隐式裁剪，evaluate 内显式可见性计算（逐元素 `getBoundingClientRect` / computedStyle 裁剪后求可见文本量）。

**测试**：login-wall.html 恢复「标准容器承载隐藏正文」形态用例，断言 need_login。

## ③ qualityHint 误示修复

**根因**：无展开候选页面恒提示「未能通过页面按钮展开全文」，对本来完整的文章误示「可能不完整」。

**修复**：仅当「存在展开候选且点击后正文未变长」才提示；同步调整任务 2 断言（原断言固化的是错误行为）。

## ④ Agent 基线采集

与现有能力域完全同构：
- `settings-types.ts:56` `SubAgentEnabledAbilities` 加 `browser?: boolean`（默认关）
- `pi-session.ts` `buildSubAgentToolDefs` 加 `if (ab.browser === true)` 分支注册 browser 工具包（Profile 级独立生效，不受工作区 enabledToolPacks 约束——与 stock/article 语义一致）
- `app/settings/SubAgentTab.tsx:76` `BOOLEAN_ABILITIES` 加一行（UI 数据驱动）
- `settings-service.ts` normalize 清洗补 browser 字段
- 预置「浏览器解析」Profile 模板（便宜档模型 + browser 能力），落地方式按现有模板机制，实施时定
- runner：`run-pipeline.mjs` 支持 agent 任务模式（按 Profile 起子会话、跑 goal、`expect.found` 断言；autoExecute 权限免审批阻塞；**node 执行**——playwright 与 Bun 不兼容是一期踩坑）
- 采集：6 个 agent 任务跑成功率回填 baseline.md，量化便宜档成功率（验证「浏览器解析子会话」省钱路径决策）

## ⑥ 轻反爬前移

**现状**：`fetchRawHtml` 失败直接 return error（tipc/article.ts:165），403/反爬页面死在第一步，浏览器层根本没机会（真实浏览器指纹可过）。

**方案**：fetchRawHtml 失败按错误类型分流：

| 进浏览器层（浏览器可能救活） | 直接报错（救不了） |
|---|---|
| HTTP 403（Cloudflare/反爬挑战） | 404 |
| HTTP 429（限流） | DNS 解析失败、域名不存在 |
| HTTP 503（有时是挑战页） | SSL 证书错误 |
| 网络超时、ECONNRESET | 400 / 500 / 502 / 504 |

- 命中白名单 → 跳过脚本/Readability（无 HTML 可用）直接进浏览器层；成功正常落盘（layer: browser）、need_login 走人工流程、**其他失败直接报错不走 AI 兜底**（fetch 都拿不到的页面 AI 只能空壳硬猜，一期设计已把 AI 退为「真怪异格式兜底」）
- `article-service.ts` fetchRawHtml 错误结构化：`FetchError { status?, code }`（现在抛裸字符串）；白名单只认结构化字段，不解析错误字符串
- parse history：分流路径补记录

## 模块边界

**改动**：
- `electron/main/services/browser/browser-manager.ts` — P0 降级链 + 下载触发
- `electron/main/services/browser/` 新增下载服务（或并入 manager，实施时定）— P0
- `electron/main/services/browser/browser-article-service.ts` — ① 翻页循环 + ② 可见性度量 + ③ hint 条件
- `electron/main/services/article-service.ts` — ⑥ fetchRawHtml 错误结构化
- `electron/main/tipc/article.ts` — ⑥ 分流编排
- `electron/main/agents/pi-session/pi-session.ts` + `services/settings-types.ts` + `settings-service.ts` + `app/settings/SubAgentTab.tsx` — ④
- `resources/browser-eval/` — 测试页与断言更新（翻页三页标记、login-wall 恢复标准容器形态、任务 2 断言反转）+ runner agent 模式
- 无新增 store（P0 下载进度 UI 状态走现有事件广播 + 局部组件，实施时定）

## 数据流

- P0：浏览器调用 → manager 检测缓存 → 缺失触发下载（进度广播 → UI）→ 完成后 launch；launch 失败按降级链依次试 msedge/chrome
- ⑥：parseArticle → fetchRawHtml 抛 FetchError → 白名单判断 → 浏览器层（原有 3.5 编排复用）或 return error

## 错误处理 / 边界情况

- P0：下载中断/校验失败 → 清残留 + 明确失败态 + 可重试；降级链各档失败原因透出；下载期间并发浏览器调用排队等待（复用现有队列）
- ①：无限翻页保护（页数上限 + 正文不再新增双保险）；「下一页」误命中（如「下篇文章」链接）→ 正文不增长自然终止，取已有部分
- ⑥：错误分类只认 FetchError 结构化字段；浏览器层超时/崩溃按现有 errorClass 语义处理

## 未决问题（实施时定）

1. P0 下载进度 UI 形态（toast / 设置页区块 / 动作流面板条目）与触发时机（首次浏览器调用时弹确认 vs 静默下载）
2. 「浏览器解析」Profile 模板走内置模板机制还是引导文档
3. 翻页「正文不再新增」的判定阈值（指纹相似度参数）
4. runner agent 模式与 pi-session 子会话基建的对接方式（复用 dogear__CreateSession 路径还是直接进程内起 PiSession）

## 三期预告（扩展 + NM，另立项）

勘查两份报告已归档本目录（browser-nm-packaging-survey.md / stagehand-embedding-survey.md）：
- NM + NSIS 主线可立项，最小改动 3 处（installer.nsh 注册表两键 + 主 exe `--nm-host-bridge` 分流 + 扩展内置 key 固定 ID）；**扩展分发上商店列正式工作项**（Chrome Web Store $5 / Edge Add-ons 免费，Chrome 152 已实测禁 `--load-extension`，Edge 优先）；便携版 + NM 延后
- Stagehand 不嵌入（架构错位：在 pi-session 主 Agent 与浏览器间插第二层 LLM，token 双份/延迟翻倍/决策黑盒；ClientLLM 接 pi-ai 技术可行但非嵌入理由）；三期工具层设计并入借鉴项：a11y 混合树观察格式（[帧序-backendNodeId]→XPath）、extract 严格抽取协议（zod schema + Metadata 完成度循环）、act/observe prompt 设计
- 三期再加 `browserModelSelection` 设置项（与 digest 同构的后台 runOnce 链，届时调度器联动）
