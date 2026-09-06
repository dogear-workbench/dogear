---
step: 4
title: 工具层 + 能力域 + save_article
status: done
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
  1. browser-action-stream.ts 零改动——source 实为 string 宽类型（非枚举），'extension' 天然合法，渲染层未消费 source 字段，无实际改动点
  2. save_article 的 workspacePath 显式传参（createBrowserToolDefs opts + pi-session/custom-agent-tools 传参），不用 getCurrentWorkspace 动态取默认工作区（多工作区场景会存错）；rawHtml 必填传空串
  3. tipc/agent.ts getRegisteredTools 动态 import 列表补 extension-tools.js（验证要求的必要接线，计划未列）
  4. extension-tools 动作流为 recordBrowserAction 直调（无既有 hook，行为等价，零 tipc 改动）
  5. 错误文案为映射表固定文案，不透传原始 error（permission_denied 与 step3 gateway 文案一致）
- 改动文件清单：extension-tools.ts（新）、browser-tools.ts（+save_article :704-746、签名 :309）、settings-types.ts（:68/:267）、types/settings.ts（:97/:75）、settings-service.ts（:286-289）、pi-session.ts（:36/:539/:638-641/:537/:635）、SubAgentTab.tsx（:66/:80/:89）、tipc/agent.ts（:455）、custom-agent-tools.ts（:51）
- 验证：静态 node 25/25（注册中心/normalize 幂等/12 errorCode 映射/save_article 四件落盘）+ headful Edge 16/16（四工具真实链路 + guard 双护栏 + ref_expired/navigated_away + 动作流）+ 回归 lint 0 errors / build:electron / tsc noEmit / 管线 20/20 全绿；环境已清理（HKCU 键删、Edge 按命令行特征杀、.tmp-step4 删）；详细交付见会话组共享区 step4-delivery.md

### 给下一步的接力棒
- 关键签名：createExtensionToolDefs({conversationId})（extension-tools.ts:185）；ERROR_MESSAGES 映射表（:25）可复用于伴随面板文案；runCommand(kind, params, extract) 统一 sendExtensionCommand + isError 转换；save_article 入库目标为会话工作区 `<ws>/.dogear/articles/{id}/`
- 下个 step 该从哪里继续：按 plan.md 后续 step 推进；浏览器解析 Profile 已具备完整「observe/read_text → save_article」工具集，验收闭环直接用该 Profile 派子会话
- 待办或已知限制：跨路径导航后命令 navigated_away 且 agent 无法自行重连（需用户扩展弹窗重连，P2 处理导航同步）；主会话 case 'extension' 无 UI 开关入口（对称性预留，子会话能力域为主链路）；验证踩坑（HKCU 被 HKLM 安装版压制需 PowerShell 写、bat 生成转义、connect 时 active tab 必须是受控页）详见共享区 step4-delivery.md 接力棒段
