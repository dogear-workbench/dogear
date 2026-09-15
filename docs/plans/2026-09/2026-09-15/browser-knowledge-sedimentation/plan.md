# 浏览器知识沉淀与 Profile 优化 实施计划

**目标**：把站点档案/通用技巧沉淀泛化到内嵌浏览器通道，修复 screenshot 路径 bug，优化 Profile 描述与索引动线，让浏览器调研经验跨会话复用。

**架构思路**：存储与工具分离——复用扩展通道已有的 site-knowledge-service 存储（两通道共享 `.dogear/site-knowledge/`），只新建内嵌版工具层；通用 playbook 走「全局文件 + 能力驱动注入」（挂载条件与 browser-exploration skill 一致）。排除：自动总结写入（质量不可控）、行为锚点注入（本期不做，playbook 稳定后再挂）、Profile 合并（成本与纪律稀释）。

**涉及模块**：`agents/tools/browser-site-tools.ts`（新建）/ `extension-site-tools.ts` / `browser-atom-tools.ts` / `browser-tools.ts` / `session-append-templates.ts` / `settings-types.ts` / `settings-service.ts` / `pi-session/pi-session.ts` / `resources/skill-templates/browser-exploration/SKILL.md`

**设计文档**：[../browser-knowledge-sedimentation-design.md](../browser-knowledge-sedimentation-design.md)

## 步骤索引

- [x] [Step 1: 内嵌通道站点档案工具](./step1-embedded-site-tools.md) — 新建 dogear__browser__site_knowledge/site_finding + navigate 档案指针
- [ ] [Step 2: screenshot 路径修复](./step2-screenshot-path.md) — 写入工作区可读路径，兑现「read 可读」承诺
- [x] [Step 3: 通用 playbook 机制](./step3-browser-playbook.md) — 全局文件 + browser 能力注入 + 首批初稿
- [ ] [Step 4: Profile 描述优化与迁移](./step4-profile-descriptions.md) — 新文案 + LEGACY 迁移 + 索引两步动线 + skill 沉淀出口（依赖 Step 1 工具名）

## 全局决策

- 工具命名遵循 `mcp__{server}__{tool}` 规范：内嵌版为 `dogear__browser__site_knowledge` / `dogear__browser__site_finding`，文件末尾 `registerToolGroup` 已由 browser-tools.ts 统一注册（site 工具并入 `dogear-browser` 组，不新开组）
- 存储唯一源是 site-knowledge-service.ts，两通道共用，不新建存储
- 错误一律 `isErrorResult` 返回不抛异常；文案中文
- 不写注释；单文件超 300 行考虑拆分
- 各 step 独立 commit，commit 信息带 step 编号；`bun run lint` + 相关测试通过后再回填
- 执行顺序：Step 1/2/3 相互独立可并行；Step 4 必须在 Step 1 之后（skill 引用内嵌工具名）
