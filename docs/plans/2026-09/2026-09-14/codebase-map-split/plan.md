# 代码地图分域重构 实施计划

**目标**：把 130KB 单文件 `docs/codebase-map.md` 拆成 index + 8 个功能文件的分域地图，条目简化为一句话职责，codebase-map / doc-sync 两个 skill 指引同步改造，让 agent 拿功能词快速锁定代码区域。

**架构思路**：按功能域（chat / agent-core / browser / articles / stocks / settings / data-center / infra）拆文件，index.md 关键词路由表同时服务 agent 检索与 doc-sync 写入。排除按目录章节一比一拆（与检索心智错位）和只简化不拆（单文件仍需整读）。完整设计见 [codebase-map-split-design.md](../codebase-map-split-design.md)。

**涉及模块**：`docs/codebase-map/`（新增 9 文件）、`docs/codebase-map.md`（删除）、`resources/skill-templates/codebase-map/SKILL.md`、`resources/skill-templates/doc-sync/SKILL.md`

## 步骤索引

- [x] [Step 1: 迁移改写地图为 9 个分域文件](./step1-migrate-map.md) — 读 130KB 原文按功能域归属改写，条目压缩成一句话职责，删原文件
- [ ] [Step 2: 改造两个 skill 指引](./step2-skill-guides.md) — codebase-map 改为 index 路由动线，doc-sync 改为按路由精准编辑
- [ ] [Step 3: 验证检索动线与规范](./step3-verify.md) — 真实功能词走 agent 动线抽查命中、查重复条目、验证 doc-sync 写入路由

## 全局决策

- **条目格式**：`` `路径` — 一句话职责 ``，一行内说清，不写实现细节
- **硬约束沉淀**：改写时遇到的「唯一数据源 / 不许绕过的通道 / 明显易错语义」挪到各功能文件尾部 `## 注意` 区，不逐条甄别、不恋战
- **历史注记全砍**：日期注记、迁移史、已删功能对比一律不进新地图（git 可查）
- **跨功能归属**：条目只在主功能文件出现（判据：哪个功能的聊天词会想起它），次要相关文件放一行指针（如「工作区管理另见 settings.md」），禁止多处重复放全条目
- **「关键数据流」章节**：按功能归属拆入各功能文件尾部，与注意区并列成 `## 数据流`
- **index.md 形态**：每功能文件一行——文件名 + 一句话范围 + 聊天词关键词（中英文，按用户真实用语组织），总量 ~2KB
- **不留新旧并存**：step1 完成即删 `docs/codebase-map.md`，防止双写漂移
