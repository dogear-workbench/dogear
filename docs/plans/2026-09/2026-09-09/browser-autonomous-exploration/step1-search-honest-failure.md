---
step: 1
title: 搜索诚实失败与验证页冻结
status: done
---

## 目标

SERP 解析为空时不再盲目降级导航走：先探测页面是否有可探索结果，有则保留页面返回结构化信号让 agent 接手；验证页呈现后冻结该 tab（补等待人工卡片），降级换新 tab。

## 依赖上下文（接力棒输入）

- 当前 `browser-search-service.ts` 的引擎循环：`ensureTab` 复用 `tabBox.current` 导航；`finishEngineFailure` 返回 null 则 continue 下一引擎；`finally { promoteFetchTab(...) }` 在失败路径已把页面 promote 给 agent（`promoteFetchTab` 在 `fetch-page.ts`，promote 为 agent tab + release 服务持有）
- `failOutcome` 已带 `failure: buildFetchFailure(tabBox.current, resolvePageState(...), true)`（含 tabId/url/pageState/suggestedNextTools）
- `resolvePageState(tab, pageText?)` 签名已支持正文（`page-state.ts:48`），搜索路径目前没传
- `presentVerification` 已呈现验证页（`presentTabWindow`），但没 raise 等待人工，且后续引擎复用同一 tab 会把它导航走
- 设计文档：`docs/plans/2026-09/2026-09-09/browser-autonomous-exploration-design.md` 第一批 1/2

## 计划改动

- [ ] `serp-parsers.ts` 新增 `detectSerpPresence`：`(engine) => () => { linkCount, textLength }` 形式的 evaluate 函数（按引擎给结果容器选择器：google `#search a[href], #rso a[href]`、ddg `#links .result a[href]`、bing `#b_results li.b_algo a[href]`；容器找不到时兜底全文档 `a[href]` 计数 + body 文本长度，返回结构区分「容器存在与否」）
- [ ] `browser-search-service.ts` parse_empty 分支（约 :228 `parsed.length === 0` 处）：
  - 探测 `detectSerpPresence[engine]`：异常或超时按「有结果」保守处理
  - 有结果（linkCount ≥ 3 或容器存在）→ **不进 finishEngineFailure**，直接 return 诚实失败 outcome：`errorClass: 'parse_empty'`，message 说明「页面有结果但结构化解析失败，页面已保留」，failure.pageAvailable=true + tabId + hint（引导 agent observe_page + click + read_text）
  - 无结果 → 维持现有降级
- [ ] 同文件：解析前 `readTabText(record)` 取正文传 `resolvePageState(current, stats.text)`（挑战页在 URL/标题不明显时不再误报 ready）；注意 readTabText 失败 catch 降级为无正文调用
- [ ] 同文件 verification_required 分支（约 :200）：`presentVerification(current)` 后补 `raiseHumanIntervention({ tabId, reason: 'verification_required', message, url, taskMeta })`，然后 `tabBox.current = null`（下一引擎 `ensureTab` 会开新 tab；注意 finally 的 promote 传 null 即无操作）
- [ ] 动作流 emit：诚实失败路径发 `parse` 事件 result `explorable_page`（新结果值，前端 ACTION 徽章中性显示，无需改前端）

## 验收

- 构造 Google parse_empty（或断网 Google 解析为空但页面有链接）：返回 outcome 含 `failure.pageAvailable: true` + tabId，degradations 不含 google→ddg
- 验证页场景：呈现后 tab 仍在原 URL，下一引擎在新 tab 打开；等待人工卡片出现一条 verification_required
- `bun run build:electron` + `bun run lint` 通过；自测脚本如有 search 断言需同步更新（`dev-selftest.ts` 的 parse_empty 分期语义变为「有结果=诚实失败」）

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
  - ddg 探测选择器按 aeea688 后的主站结构对齐（article[data-testid="result"] 等），兼容旧 #links 结构
  - 探测插在解析为空/解析异常两分支汇聚点、site 域名过滤之前（site 过滤为空维持降级链语义）
  - 验证页分支额外 `manager.release(current.tabId, holderId)` 防无面板场景 search holder 泄漏
  - `FetchFailureContext` 落 `hint?` 字段 + `formatFetchFailure` 优先输出（hint 才能到 agent）
  - `readTabTextSafely` 对 loading/crashed 前置跳过，避免向挂起页 executeJavaScript
- 改动文件清单：
  - `electron/main/services/browser/serp-parsers.ts`（SerpPresenceResult + detectSerpPresence，new Function 构造）
  - `electron/main/services/browser/browser-search-service.ts`（probeSerpPresence/presenceExplorable/readTabTextSafely + parse_empty 诚实失败 + 验证页 raise + release + tabBox 置空）
  - `electron/main/services/browser/embedded/fetch-page.ts`（FetchFailureContext.hint + buildFetchFailure 第 4 参）
  - `electron/main/agents/tools/browser-tool-shared.ts`（formatFetchFailure 输出 hint）
  - `electron/main/services/browser/embedded/dev-selftest.ts`（honest_failure 分期断言：iana.org 多链接页不降级+failure 完整+tab 保留）

### 给下一步的接力棒
- 关键签名 / 数据结构：
  - `detectSerpPresence(engine): SerpPresenceFn`，返回 `() => {containerFound, linkCount, textLength}`；探测异常/超时返回 null 由调用方保守视为有结果
  - `buildFetchFailure(tab, pageState, pageAvailable, hint?)`；FetchFailureContext 现含 `hint?: string`
  - 诚实失败 outcome：`{ok:false, errorClass:'parse_empty', degradations(不含本引擎), failure:{pageAvailable:true, tabId, hint}}`
- 下个 step 该从哪里继续：takeover/resumeConversation 全部未动，human-intervention.ts 未改（resolve 返回 taskMeta 是 step2 的事）；step2 从 human-intervention.ts resolve 返回值改起
- 待办或已知限制：
  - 完整自测（DOGEAR_EMBEDDED_BROWSER_SELFTEST=1）本环境无法跑：用户正式版 Dogear 实例占用 dogear-nm-gateway 管道，第二实例 EADDRINUSE 即退；需无冲突环境补跑 fetchSmoke（重点 honest_failure 分期）
  - SerpPresenceResult 可扩展 topLinks 附标题列表（设计未决问题，后续优化）
  - 验证页 tab 被 TTL 回收后 intervention 卡片不自动清理（既有限制）；用户手动完成验证不自动解除卡片，走「完成后继续」
