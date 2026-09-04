---
step: 4
title: 子会话浏览器能力配置面
status: done
---

## 目标

子会话 Profile 可启用浏览器工具包（`SubAgentEnabledAbilities.browser`），并提供「浏览器解析」Profile 模板（便宜档模型 + browser 能力），为 step 5 采集铺路。

## 依赖上下文（接力棒输入）

- 现状四处落点（与 memory/stock 完全同构）：
  - `services/settings-types.ts:56` SubAgentEnabledAbilities 接口
  - `agents/pi-session/pi-session.ts` buildSubAgentToolDefs（约 :598 起，ab.memory/stock/article/reference 各有分支，browser 工具定义 `createBrowserToolDefs`（../tools/browser-tools.ts）主会话侧 buildMainAgentToolDefs 的 browser case 可参照传参）
  - `app/settings/SubAgentTab.tsx:76` BOOLEAN_ABILITIES 数组（UI 数据驱动）
  - `services/settings-service.ts` enabledAbilities normalize 清洗（约 :261-266）
- 设计约束：Profile 级独立生效，不受工作区 enabledToolPacks 约束

## 计划改动

- [ ] `settings-types.ts`：`SubAgentEnabledAbilities` 加 `browser?: boolean`
- [ ] `pi-session.ts` buildSubAgentToolDefs：加 `if (ab.browser === true)` 分支注册 browser 工具包（registerPack('browser', createBrowserToolDefs(...))，传参照主会话 case）
- [ ] `SubAgentTab.tsx`：BOOLEAN_ABILITIES 加 `{ key: 'browser', label: '浏览器', desc: 'dogear-browser 浏览器工具包' }`
- [ ] `settings-service.ts`：normalize 清洗补 browser 布尔字段
- [ ] 「浏览器解析」Profile 模板：按 SubAgentTab 现有模板机制（templates props）预置；若机制只支持技能模板则降级为 settings 内置默认 Profile（实施时定，二选一，不留半成品）
- [ ] 验证：UI 开关可见可存；开启后子会话工具列表含 `dogear__browser__*`（delegation-test-mocks 或构建级验证）

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
  - 「浏览器解析」Profile 模板：SubAgentTab 的 templates props 是技能模板（SkillTemplateMeta[]），不支持 Profile 模板，按计划降级为 settings 内置默认 Profile（settings-types 新增 createBrowserParseSubAgentProfile，DEFAULT_SETTINGS 预置 + normalize 补齐，已有用户升级后也能拿到）。modelSelection 置 null（用户便宜档因人而异，无法预知，描述里建议选便宜档）；UI 中该 Profile 标「内置」badge、禁删（同 default）但可编辑。
  - 除计划四处落点外追加：渲染层镜像 types/settings.ts 同步（browser 字段 + 常量 + 工厂 + DEFAULT）；SubAgentTab countAbilityDomains 计入 browser；删除按钮/标题对内置 Profile 禁用。
- 改动文件清单：
  - electron/main/services/settings-types.ts（browser 字段 + BROWSER_PARSE_SUB_AGENT_PROFILE_ID + createBrowserParseSubAgentProfile + DEFAULT_SETTINGS 预置）
  - types/settings.ts（镜像同步）
  - electron/main/agents/pi-session/pi-session.ts（buildSubAgentToolDefs 加 ab.browser === true 分支，registerPack('browser', createBrowserToolDefs({ conversationId }))，与主会话 case 传参一致）
  - electron/main/services/settings-service.ts（normalize：browser 非布尔清洗 + 三处 Profile 重建点带内置 + 缺失补齐）
  - app/settings/SubAgentTab.tsx（BOOLEAN_ABILITIES 加浏览器项 + 能力域计数 + 内置 badge/禁删）
  - electron/main/services/settings-normalize.test.ts（适配长度断言 + 新增 4 项 browser/内置补齐/幂等测试）

### 给下一步的接力棒
- 关键签名 / 数据结构：
  - `SubAgentEnabledAbilities.browser?: boolean`；`BROWSER_PARSE_SUB_AGENT_PROFILE_ID = 'browser-parse'`（主进程/渲染层双份）
  - 内置 Profile：id 'browser-parse'，name '浏览器解析'，browser: true，基础工具 read/write/edit/Glob/Grep（不含 bash），timeout 30m，modelSelection null
  - 子会话注册的包名是 'browser'（toolPackMap 键，权限免确认按包判定，与主会话同名）
- 下个 step 该从哪里继续：step 5 采集 runner 直接按 id 'browser-parse' 取 Profile（normalize 保证存在）；跑浏览器任务用 node 执行（playwright 与 Bun 不兼容）
- 待办或已知限制：
  - 内置 Profile 被 UI 删除后会在下次 loadSettings 时自动补回（normalize 保证存在，与 default 不可删同理），用户可停用（enabled: false）但不可删除
  - 临时集成验证（PiSession.prototype 直调 buildSubAgentToolDefs 实证 dogear__browser__* 注册）已跑通并删除，未留测试文件——其 electron mock 与 delegation-test-mocks 合跑体系不兼容，如需长期回归需先统一 mock 中心
