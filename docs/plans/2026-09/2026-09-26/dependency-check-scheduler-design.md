# 依赖月度巡检（定时任务 + 笔记卡片）设计

**背景**：项目依赖从无更新机制，讨论结论为「低频定时看 + 分层更新」：semver 范围内的 patch/minor 走例行批量更新，major 跨越与特殊依赖单独立项，避免攒大账。

**目标**：每月自动巡检依赖健康度，产出一张含分层建议的笔记卡片，用户无需人工记得检查。

**架构**：

- 载体：数据中心定时计划的 CUSTOM_AGENT 任务（monthly_at 触发），dogfooding 自身的定时任务系统
- 查询：agent 用 bigmodel__webReader 逐包查 npm latest，不引入 Bash（定时任务原设计恒不装 shell，无人值守开 shell 是安全边界变化，不为此破例）
- 产物：dogear__CreateNote 落巡检卡片，tags 含「依赖巡检」，每月一张新卡（卡片流按时间自然排序，SearchNotes 按标签回溯全史；固定卡片追加需跨次记 noteId，弃）

**代码改动**（已完成）：

- `electron/main/services/scheduler/custom-agent-tools.ts`：CUSTOM_AGENT 恒装集新增 notes 工具（`createNotesToolDefs(workspaceId)`，不传 sourceContext——定时任务无会话上下文）。文件工具/搜索/memory/notes 恒装 + pack 可选的结构不变。

**数据源验证结论**（2026-09-26 实测，写进巡检 prompt）：

| 源 | 非 scoped | scoped | 备注 |
|---|---|---|---|
| `registry.npmjs.org/-/package/<pkg>/dist-tags` | ✓ 实时权威 | ✗ URL 含 `%2F` 被 webReader 400 拒 | 首选 |
| `www.npmjs.com/package/<scope>/<name>` 页面 | ✓ | ✓（og:description "Latest version: X"） | 缓存滞后 1~2 天，可接受 |
| unpkg `<pkg>/package.json` 的 version | ✓ | ✓ | 缓存滞后（实测差 2 个 minor），弃 |
| jsDelivr data API | ✓ | ✓ | 滞后严重（实测 pi-agent-core 差 8 个 minor），弃 |

本项目约 2/3 依赖为 scoped 包，scoped 路径必须走 npmjs 页面。巡检卡片末尾标注「精确核对请在主会话跑 bun outdated」兜底缓存误差。

**分层策略**（固化在 prompt，防月度漂移）：

- 例行层：latest 仍在 range 内 → 建议 bun update 批量吃掉
- 立项层：major 跨越；@earendil-works/pi-*（有本地 patch 要重适配）；@tiptap/* 与 react/react-dom（精确锁版）；electron（安全敏感，落后 ≤2~3 个大版本可接受，node-pty 跟它一起动）；@types/node 跟 electron 的 Node 版本

**错误处理**：单包查询失败记录并标注，不中断巡检；查到的 latest 等于基线且 range 长期未动时标注「数据可能滞后」而非断言「已最新」。

**定时任务配置**（用户在 UI 建）：

- 名称：依赖月度巡检；触发器：monthly_at 每月 1 日 09:00（可自定）；工作区：dogear；模型：默认；工具：跟随工作区（web-mcp 已启用）
- prompt 见 `dependency-check-prompt.md`
