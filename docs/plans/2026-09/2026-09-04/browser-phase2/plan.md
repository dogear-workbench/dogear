# 浏览器二期（补漏收口 + 分发修复）实施计划

**目标**：修复安装版 Chromium 缺失分发 bug（P0），收口一期遗留清单（翻页拼接/登录墙盲区/qualityHint 误示/Agent 基线采集/轻反爬前移），文章读取对真实用户可用。

**架构思路**：P0 走「懒下载 + channel 降级链」不动安装包体积（排除 extraResources：+140~170MB 下载转化代价）；解析质量三项集中在 browser-article-service 与 browser-eval 测试集；轻反爬在 tipc 编排层分流（fetchRawHtml 错误结构化，白名单进浏览器层，浏览器失败不走 AI 兜底）；Agent 基线分配置面与采集两步。设计全文见 [../browser-phase2-design.md](../browser-phase2-design.md)。

**涉及模块**：`services/browser/browser-manager.ts`（+ 新增下载服务）、`services/browser/browser-article-service.ts`、`services/article-service.ts`、`tipc/article.ts`、`agents/pi-session/pi-session.ts`、`services/settings-types.ts`、`services/settings-service.ts`、`app/settings/SubAgentTab.tsx`、`resources/browser-eval/`。

## 步骤索引

- [x] [Step 1: P0 Chromium 分发修复](./step1-chromium-distribution.md) — 懒下载（npmmirror→官方 CDN fallback）+ channel:msedge→chrome 降级链 + 进度 UI
- [x] [Step 2: 解析质量三连](./step2-article-quality.md) — ② 登录墙盲区 ③ qualityHint 误示 ① 翻页拼接（含 URL 跳转型），测试断言同步
- [x] [Step 3: 轻反爬前移](./step3-antibot-prefetch.md) — fetchRawHtml 错误结构化 + tipc 白名单分流进浏览器层
- [x] [Step 4: 子会话浏览器能力配置面](./step4-subagent-browser-ability.md) — SubAgentEnabledAbilities.browser 四处 + 「浏览器解析」Profile 模板
- [x] [Step 5: Agent 基线采集](./step5-agent-baseline.md) — runner agent 模式 + 6 任务成功率回填 baseline.md

## 全局决策

- **一期继承**：不写注释；UI 文案中文；主进程改动后 `bun run build:electron`；工具层 `isError: true` 不抛异常；errorClass 语义不变（need_login / timeout / parse_empty / browser_crash）
- **runner 一律 node 执行**（playwright 与 Bun 不兼容，bun 下 acquire 永久挂起）
- **翻页参数**：20 页上限；共用 60s 任务级超时；超限取已采集部分 + `quality_warning` + qualityHint「翻页未完成（已采集 N/M 页）」
- **fetch 白名单**：403 / 429 / 503 / 超时 / ECONNRESET 进浏览器层；404 / DNS / SSL / 400 / 500 / 502 / 504 直接报错；白名单只认 FetchError 结构化字段，不解析错误字符串
- **浏览器能力域语义**：Profile 级独立生效（`ab.browser === true` 即注册），不受工作区 enabledToolPacks 约束，与 stock/article 一致
- **P0 降级链**：ms-playwright 缓存 → channel:msedge → channel:chrome，全部失败报错并引导

## 完成总结

五步全部完成（2026-09-05，提交 289be6e / 69f7529 / 1958726 / e9205b0 / step5）：

1. **P0 分发修复**：launch 检测链（内置缓存→系统 Edge→系统 Chrome→懒下载重试）；下载服务 npmmirror→官方 CDN fallback（实测修正为 CFT 构建路径，从 playwright registry 动态取 URL），进度 toast + 解析入口文案。遗留：干净机器全量下载未真机验证（建议发版前干净 VM 冒烟）。
2. **解析质量三连**：登录墙检测改 evaluate 内显式可见性计算；qualityHint 仅「有展开候选且点击无效」才提示；翻页循环全量拼接（含 URL 跳转型，跨页指纹去重，20 页上限/60s 超时降级）。管线 10/10 PASS。
3. **轻反爬前移**：FetchError 结构化 + 白名单（403/429/503/超时/ECONNRESET）分流进浏览器层，其余诚实报错；浏览器失败不走 AI 兜底。新增 antibot 端到端任务。管线 11/11 PASS。
4. **浏览器能力配置面**：SubAgentEnabledAbilities.browser 四处落点 + 内置「浏览器解析」Profile（禁删可停用，normalize 幂等补齐），子会话可注册 dogear__browser__*。
5. **Agent 基线采集**：run-agent.mjs（electron stub/hooks 进程内起 PiSession，autoExecute）+ 便宜档 glm-4.5-air，6/6 任务 PASS（成功率 100%，~13k tokens 总消耗），baseline.md 回填销项。

三期候选方向见设计文档「三期预告」。
