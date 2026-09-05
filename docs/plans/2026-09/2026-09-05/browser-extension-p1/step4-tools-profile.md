---
step: 4
title: 工具层 + 能力域 + save_article
status: pending
---

## 目标

agent 可用的四件套落地：dogear-extension 工具组（observe/click/fill/read_text）、extension 能力域字段与 Profile 装配、动作流 source='extension'、dogear__browser__save_article（B 项）。

## 依赖上下文（接力棒输入）

- 前置 step 产出：[step3-host-permission.md] sendExtensionCommand 带 origin 前置校验的全链路已通；ExtensionStatus.authorizedOrigins 定稿
- 当前关键文件状态：工具组注册范式 `browser-tools.ts` 末尾 `registerToolGroup({server, label, create, placeholder})`；能力域装配 `pi-session.ts:598 buildSubAgentToolDefs`（browser 分支 :619-621 为模板）+ 主会话 switch（:141 附近）；`SubAgentEnabledAbilities`（settings-types.ts:60-68，types/settings.ts:89 双份镜像）；浏览器解析 Profile 模板（settings-types.ts:266 附近）；动作流 `browser-action-stream.ts:13-24`；入库函数 `article-service.ts:593 saveArticleFromScript(params)` 传 url/title/content/author/siteName/excerpt/language 返回 ArticleMeta
- 关键决策回顾：工具 zod schema 与一期同名同义（region/text_filter/ref/value）；错误转中文 isError 文案不抛异常；save_article 挂 dogear-browser 组（不动 article 能力域）

## 计划改动

- [ ] `electron/main/services/browser/browser-action-stream.ts`：source 类型加 `'extension'`
- [ ] `electron/main/agents/tools/extension-tools.ts`（新建）：
  - `createExtensionToolDefs({conversationId})` 四工具，zod：observe_page `{region?, text_filter?}` / click `{ref}` / fill `{ref, value}` / read_text `{ref?}`
  - 执行体：`sendExtensionCommand(kind, params)` → 成功格式化结果文本；语义错误（errorCode）→ 中文 isError 文案（映射表覆盖 12 个 errorCode：如 not_connected「浏览器扩展未连接，请先在扩展中连接此标签页」、ref_expired「页面已变化，请重新 observe_page 获取新 ref」、guard_submit「提交类操作本阶段未开放，请手动完成提交」）
  - 每次调用 emitAction（action 对应 kind、source: 'extension'、url 取当前 status）
  - 末尾 `registerToolGroup({server: 'dogear-extension', label: '浏览器扩展', ...})`
  - 工具描述明示「作用于用户真实浏览器的已连接标签页，仅限已授权域名；点击/填充自动执行但拦截提交类操作」
- [ ] `electron/main/services/settings-types.ts` + `types/settings.ts`：SubAgentEnabledAbilities 加 `extension?: boolean`（双份镜像同步）
- [ ] `electron/main/services/settings-service.ts`：normalize 清洗 extension 字段（非布尔剔除，幂等）
- [ ] `pi-session.ts`：buildSubAgentToolDefs 加 extension 分支（registerPack('extension', createExtensionToolDefs)）；主会话 switch 加 case 'extension'
- [ ] 浏览器解析 Profile 内置模板：enabledAbilities 补 `extension: true`（存量用户 Profile 由 normalize 兼容——已存的 enabledAbilities 不强改，用户可手动开；回填记录该决策）
- [ ] `app/settings/SubAgentTab.tsx`（按实际文件名）：countAbilityDomains 等计数处加 extension
- [ ] `electron/main/agents/tools/browser-tools.ts`：新增 `dogear__browser__save_article {title, url, content, author?, siteName?, excerpt?}`——直调 saveArticleFromScript，成功返回「已入库：{title}（{wordCount} 字，id {id}）」；失败 isError
- [ ] 验证：
  - `bun run build:electron` 后 node 脚本调 createExtensionToolDefs 四工具（对 step3 验证过的授权页）走通；`client.getRegisteredTools()` 列表出现两组新工具
  - settings-service normalize 单元级验证（extension 字段清洗/幂等）
  - save_article 对临时目录 DOGEAR_CONFIG_DIR 入库一篇文章，meta/content.md/.order.json 三件齐（对照 P0 验收时手动入库格式）
- [ ] 回归：lint / build:electron / tsc noEmit / 管线 20/20

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
