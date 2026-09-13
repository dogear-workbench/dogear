# 代码地图分域重构 设计

**背景**：`docs/codebase-map.md` 单文件 478 行 / 130KB，13 章节按**目录结构**组织，条目为「路径 — 数百字实现细节」（20 行超 1000 字符）。两个消费链路都贵：agent 触发 codebase-map skill 全量 Read（工具单次截断 50KB，需 3 次）；doc-sync 维护要先读全文才能定位要改的行。用户与 agent 的实际检索心智是**功能词**（「聊天」「浏览器」「用量」），与目录结构组织错位，导致 agent 反复 Glob/Grep。

**目标**：agent 拿功能词快速锁定代码区域（读 index → 读单功能文件 → Glob 精确读），减少反复探索；doc-sync 维护成本同步下降；新增/修改条目有一致规范可循。

**架构**（核心做法 + 排除的选项及原因）：

1. **按功能域拆 8 个文件** + 主索引，目录 `docs/codebase-map/`：

   | 文件 | 覆盖 | 聊天词 |
   |---|---|---|
   | `chat.md` | agent-chat 组件、消息渲染、输入区、minimap、主工作区/会话窗口/伴随工作台页面、话题状态 | 聊天、消息、输入框、气泡 |
   | `agent-core.md` | pi-session、agents/、工具注册、skill 加载、权限、子会话派遣、transcript | agent、工具、skill、子会话 |
   | `browser.md` | 内嵌浏览器、扩展、双通道、site-knowledge | 浏览器、扩展、小红书 |
   | `articles.md` | 文章解析、epub/pdf/readability、笔记系统 | 文章、阅读、笔记 |
   | `stocks.md` | Python 计算层、选股、回测、行情页 | 股票、指标、选股 |
   | `settings.md` | 设置页、能力包、模型方案、Profile 管理、工作区管理 | 设置、能力、模型 |
   | `data-center.md` | 用量、定时计划、执行历史、解析历史、记忆面板 | 数据中心、用量、定时 |
   | `infra.md` | 入口路由、IPC 总览、lib、类型、.dogear 存储、测试基建（**内部小节**：入口与路由 / IPC 总览 / lib / 类型 / 数据存储 / 测试基建） | 兜底 |

   排除「按现有 13 章节一比一拆」：与检索心智错位，agent 还是得猜；排除「只简化不拆」：单文件即便瘦到 30KB 仍需整读。

2. **条目格式统一**：`路径` — 一句话职责。改写时把**明显的硬约束**（唯一数据源、不许绕过的通道）顺手挪到各文件尾部「注意」区，不逐条甄别；**历史注记全砍**（日期、迁移史、已删功能对比——git 可查）。排除「保留全部细节只拆文件」：单个功能文件仍 20-30KB，简化诉求不兑现。

3. **index.md 主索引（~2KB）**：每功能文件一行：文件名 + 覆盖的中英文关键词 + 一句话范围。**一张路由表管两头**——agent 检索的读入口 + doc-sync 写入的路由依据。

4. **跨功能文件的归属**：条目只在主功能文件出现，次要相关文件放一行指针（如「workspace 相关另见 settings.md」）。排除「多处重复放全条目」：漂移风险，改一漏一。

5. **「关键数据流」章节**：按功能归属拆入各功能文件尾部，不集中存放。

6. **skill 指引同步改造**（源头在仓库 `resources/skill-templates/`，安装目录是构建产物）：
   - `codebase-map`：改为「先读 index.md 按关键词路由 → 读命中的功能文件 → 未命中 fallback Glob/Grep（地图不是穷举）」
   - `doc-sync`：改为「改动后按 index.md 路由定位功能文件 → 精准编辑；新增条目守一句话职责格式 + 硬约束进注意区」

**模块边界**：
- `docs/codebase-map.md`（删除）→ `docs/codebase-map/{index,chat,agent-core,browser,articles,stocks,settings,data-center,infra}.md`（新增 9 文件）
- `resources/skill-templates/codebase-map/SKILL.md`（改写）
- `resources/skill-templates/doc-sync/SKILL.md`（改写）

**数据流**：
- agent 检索：功能词 → index.md 关键词命中 → 功能文件拿具体路径 → Glob/Read 源码
- doc-sync：代码改动 → index.md 路由 → 对应功能文件精准编辑

**错误处理 / 边界情况**：
- 功能归属歧义：按「哪个功能的聊天词会想起它」定主归属，其余文件放指针行
- agent 在功能文件未命中：skill 指引明确 fallback 到 Glob/Grep
- 迁移是一次性全文改写，完成后删除原 `docs/codebase-map.md`，不留新旧并存（并存会产生双写漂移）

**未决问题**：
- index 关键词表粒度：实施时按用户实际聊天词汇组织，验收时抽查几个真实功能词验证命中率
