# 浏览器知识沉淀与 Profile 优化 设计

**日期**：2026-09-15
**来源**：复盘 2026-09-14 汽车调研子会话（21 分钟 / 121 步）+ 后续讨论拍板

## 背景

汽车调研子会话复盘发现约 25% 步骤花在重复摸索上：

| 波折 | 根因 |
|---|---|
| 入口盲试链（webSearch 不可用 → Google 反爬 → 懂车帝验证码 → 汽车之家可用，~50s） | 站点可达性无档案可查 |
| MG4 空调确认拉锯（15+ 步，~2min） | screenshot 写 `os.tmpdir()` 而子会话 read 被工作区沙箱拦截（workspace-boundary.ts），工具描述承诺「read 可读」注定失败——**真 bug** |
| 配置表摸索（图标单元格纯文本有损 → 现场摸出「隐藏相同参数」「单版本 spec 页」技巧，~2min） | 高价值经验随会话结束丢失 |
| 站内搜索被 guard_submit 拦截后猜 URL 失败 | 搜索 URL 拼法可沉淀 |
| 车主价格页 JS 后渲染数字不可读（~45s） | 页面怪癖可沉淀 |

现状：站点档案机制（`.dogear/site-knowledge/{domain}.md` 两区结构 + site_knowledge/site_finding 工具 + navigate 档案指针）**只挂扩展通道**；内嵌浏览器通道（本次调研所用）完全没有。另：Profile 描述混入配置说明、`buildSubAgentProfileIndex` 引导语缺判断动线。

## 目标

1. 站点档案泛化到内嵌浏览器通道（存储共用，两通道共享同一份站点知识）
2. 修复 screenshot 路径越界 bug
3. 通用浏览器技巧 playbook：文件存储 + 能力驱动注入 + 首批初稿
4. Profile 描述优化（agent 决策视角）+ LEGACY 迁移 + 索引两步判断动线

## 架构

### 1. 站点档案泛化

- 新建 `electron/main/agents/tools/browser-site-tools.ts`，参照 extension-site-tools.ts 的 deps 注入模式，提供 `dogear__browser__site_knowledge` / `dogear__browser__site_finding`
- 存储层零改动：复用 site-knowledge-service.ts（`normalizeDomain` / `readSiteKnowledge` / `appendSiteFinding` / `hasSiteKnowledge`），两通道读写同一份 `.dogear/site-knowledge/{domain}.md`
- 域名来源差异：内嵌版 currentUrl 取自内嵌 agent tab 当前 URL；无 tab 时报错引导先 navigate
- `siteKnowledgePointer` 参数化：当前硬编码 `dogear__extension__site_*` 工具名（extension-site-tools.ts:44-52），改为接收通道前缀；readSiteKnowledge 冷启动文案同理
- 内嵌 navigate 成功返回尾部接档案指针（browser-atom-tools.ts:129 textResult 处，参照 extension-tools.ts:258）

### 2. screenshot 修复

- 写入路径从 `os.tmpdir()` 改为 `workspacePath/.dogear/tmp/`（browser-tools.ts:251）；无 workspacePath 时报错说明无法提供可读路径
- 工具描述保持「read 可读」承诺，修复后成立

### 3. 通用 playbook

- 文件：`getConfigDir()/browser-playbook.md`（全局，非工作区——浏览器技巧与代码无关）
- 注入点：pi-session 系统提示组装处，挂载条件与 browser-exploration skill 一致（`ab.browser === true`，pi-session.ts:158）——**能力驱动而非 Profile 硬编码**，任何勾了 browser 能力的 Profile 自动携带
- 文件不存在时注入空；更新后新会话生效（不热更，可接受）
- 写入机制（不做自动总结 hook，质量不可控）：
  - 子会话：单一出口，一律写站点档案发现区，不做「通用 vs 专属」判断分叉；沉淀动作写进 browser-parse 交付流程（报告写完 → 调 site_finding → 交付）
  - 主会话：验收时兜底补写 + 审核合并进正式地图 / 提拔进 playbook
  - 用户：零常规负担，档案是纯 markdown 可随手改
- 首批初稿（随实施写入默认文件）：
  - 对比类配置表的图标型单元格纯文本有损，优先找单版本/单项详情页
  - 数据页数字 JS 后渲染不可靠时，换官方口径文章或搜索佐证
  - 站内搜索表单被 guard_submit 拦截时，用「关键词 site:域名」通用搜索绕过
  - 搜索引擎 SERP 被反爬只剩分页框架时，直接导航目标站
  - SERP 标题足够佐证时不必点开全文

### 4. Profile 描述与索引

- 三分保留（默认=实施写本地 / 探索=只读本地 / 浏览器解析=网页与文章库），不合并——合并会让高频本地调研常态白付 ~10K tokens 浏览器工具描述，且 skill 纪律绑定与扩展独占调度被稀释
- 「探索」为用户自建 Profile，描述建议用户自行对齐（不进代码）
- 新文案（settings-types.ts 内置模板）：
  - 默认：`实施类任务：改代码、写文件、跑命令，需要动工作区时用。`
  - 浏览器解析：`网页与文章调研：公开网页用内嵌浏览器；登录态站点（如小红书）走用户浏览器扩展通道（全局独占，并行串行派遣）；也用于解析工作区文章库的文章。`
- 迁移：当前模板值加入 `LEGACY_BROWSER_PARSE_DESCRIPTIONS`（settings-service.ts:29），存量旧文案自动迁移到新值
- 索引引导语（session-append-templates.ts:60）加两步判断动线：先按「是否动工作区」（动=默认），再按「调研对象本地还是网页/文章库」（网页=浏览器解析，本地=探索）

### 排除的选项

- 会话结束自动总结写入档案：质量不可控易污染，人工/主会话审核链已兜住漏写
- 通用技巧行为锚点注入（read_text 遇长表格附技巧等）：每条要写代码挂钩，成本随条数线性涨——playbook 稳定后挑 2-3 条高频的再挂，本期不做
- 拆「agent 版/用户版」双描述字段：设置页用户看简明描述+能力勾选信息不损失，一处文案两用
- Profile 合并为两个：见上，成本与纪律稀释

## 模块边界

| 文件 | 改动 |
|---|---|
| `electron/main/agents/tools/browser-site-tools.ts` | 新建：内嵌通道 site 工具（deps 注入模式） |
| `electron/main/agents/tools/extension-site-tools.ts` | siteKnowledgePointer / 冷启动文案参数化通道前缀 |
| `electron/main/agents/tools/browser-atom-tools.ts` | navigate 成功返回接档案指针 |
| `electron/main/agents/tools/browser-tools.ts` | screenshot 写入路径改 workspacePath/.dogear/tmp/；挂载 site 工具组 |
| `electron/main/agents/session-append-templates.ts` | 索引引导语两步动线 |
| `electron/main/services/settings-types.ts` | 默认/浏览器解析 description 新文案 |
| `electron/main/services/settings-service.ts` | LEGACY 集合追加当前模板值 |
| `electron/main/agents/pi-session/pi-session.ts` | browser 能力挂载时注入 playbook 内容 |
| browser-exploration skill 正文 | 补内嵌通道沉淀出口（dogear__browser__site_finding）与交付流程沉淀节点 |
| 测试 | settings-normalize 迁移断言更新；browser-site-tools 单测（参照既有 site 工具测试若有） |

## 数据流

- 读档案：内嵌 navigate → normalizeDomain(urlAfter) → hasSiteKnowledge → 返回尾部指针 → agent 调 dogear__browser__site_knowledge → readSiteKnowledge
- 写发现：agent 调 dogear__browser__site_finding → appendSiteFinding（500 字上限 / 60s 去重 / 自动日期会话标注）→ 发现区
- 审核提拔：主会话验收时编辑档案文件合并正式地图；跨站通用条目复制进 browser-playbook.md
- playbook：browser 能力会话创建 → pi-session 组装系统提示时读 browser-playbook.md → 注入

## 错误处理 / 边界

- site 工具无当前 agent tab：报错引导先 navigate
- screenshot 无 workspacePath：报错说明无法提供工作区内可读路径
- playbook 文件缺失：注入空段（不报错）
- 档案 8KB 截断、域名归一化非法输入：沿用 site-knowledge-service 既有机制
- 两通道工具名不同但存储共用：同一站点（如汽车之家）内嵌查公开页、扩展查登录页共享一份档案——特性而非问题

## 未决问题

- `workspacePath/.dogear/tmp/` 截图堆积清理策略：量小暂不做，后续有需要再加 TTL
- playbook 无管理 UI：纯文件编辑，审核流程靠主会话验收环节约定（YAGNI，跑一阵再看）
- browser-exploration skill 中硬编码的 `dogear__extension__site_knowledge` 引导需同步补内嵌版表述，具体措辞实施时定
