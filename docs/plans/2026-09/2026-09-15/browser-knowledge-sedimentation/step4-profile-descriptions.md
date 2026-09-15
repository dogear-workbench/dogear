---
step: 4
title: Profile 描述优化与迁移
status: in_progress
---

## 目标

Profile 描述改为 agent 派遣决策视角（简明准确），存量旧文案自动迁移，Profile 索引加两步判断动线，browser-exploration skill 补内嵌通道沉淀出口与交付流程沉淀节点。

**前置**：Step 1 已完成（本步 skill 更新引用 `dogear__browser__site_finding` 工具名）。

## 依赖上下文（接力棒输入）

- 内置模板：`electron/main/services/settings-types.ts` 的 `createDefaultSubAgentProfile()`（~249 行）与 `createBrowserParseSubAgentProfile()`（~260 行）的 description 字段
- 迁移机制：`electron/main/services/settings-service.ts:29` `LEGACY_BROWSER_PARSE_DESCRIPTIONS` 集合——normalize 时命中旧值即替换为新模板值；当前模板值（settings-types.ts:265 那段）需追加进集合，测试断言在 `settings-normalize.test.ts:208-251`
- 索引注入：`electron/main/agents/session-append-templates.ts:55-66` `buildSubAgentProfileIndex`，引导语在 60 行
- skill 文件：`resources/skill-templates/browser-exploration/SKILL.md`（release/win-unpacked 下是打包副本，不改）
- 拍板决策：三分保留不合并；描述一处定义两处消费（主会话注入 + 设置页 UI），不拆双字段；「探索」是用户自建 Profile 不进代码

## 计划改动

- [ ] `settings-types.ts` 两个 create 函数 description 换新文案：
  - 默认：`实施类任务：改代码、写文件、跑命令，需要动工作区时用。`
  - 浏览器解析：`网页与文章调研：公开网页用内嵌浏览器；登录态站点（如小红书）走用户浏览器扩展通道（全局独占，并行串行派遣）；也用于解析工作区文章库的文章。`
- [ ] `settings-service.ts`：`LEGACY_BROWSER_PARSE_DESCRIPTIONS` 追加当前模板旧值（settings-types.ts 改前先抄下来）；default 的旧描述同样处理——若 default 无 LEGACY 机制则补一个（小 Set，同样模式）
- [ ] `settings-normalize.test.ts`：迁移断言更新（旧值 → 新文案）
- [ ] `session-append-templates.ts:60` 引导语改写，加两步动线：`派遣子会话时通过 profile 参数选择合适的 Profile（不指定时用「默认」）。选择动线：先判断任务是否要改工作区文件（动=默认）；调研类再按对象分——网页/文章库=浏览器解析，本地代码与文档=探索。`
- [ ] `resources/skill-templates/browser-exploration/SKILL.md`：
  - 沉淀出口补内嵌版：navigate 后提示有站点档案时先调 `dogear__browser__site_knowledge`（内嵌）/ `dogear__extension__site_knowledge`（扩展）取地图，新发现用对应通道 site_finding 沉淀——按通道写清，别混用工具名
  - 补交付流程沉淀节点：调研报告写完后、交付前，把方法复盘中的可复用经验（站点结构/直链拼法/页面怪癖）调 site_finding 写入档案，再发交付消息
- [ ] 验证：改 settings.json 造一个旧描述 → 重启/normalize → 断言变新文案；主会话系统提示索引含两步动线（用 dev 会话看）

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
