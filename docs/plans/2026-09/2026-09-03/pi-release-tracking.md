# 跟踪 pi 上游发版

**任务性质**：已转为 dogear 定时计划（自定义任务，每 7 天 browser 查 npm）。本文档承载判据与 prompt 模板；计划栏原占位任务（d8eht00l）在定时计划建好后删除。

## 定时计划配置（数据中心 → 定时计划 → 新建自定义任务）

| 项 | 值 |
|---|---|
| 名称 | pi 发版跟踪 |
| 工作区 | dogear |
| 触发器 | 间隔触发，每 10080 分钟（7 天） |
| 工具包 | 仅 browser（toolPacksOverride 强制，不依赖工作区开关） |
| 模型 | 默认 |
| 提示词 | 见下 | 

### 提示词模板（复制粘贴）

```text
你是 dogear 的 pi 发版跟踪任务，只读不改任何文件。

1. 用 browser 工具打开 https://www.npmjs.com/package/@earendil-works/pi-agent-core ，读取最新版本号（latest）与发布日期。
2. 若 latest ≤ 0.84.4（2026-08-28）：本次执行到此为止，最终回复只需一行：「pi 未发新版（latest 仍为 <版本>，<日期>）」。
3. 若 latest > 0.84.4：继续检查公开面是否与 main 分支一致——用 browser 打开 unpkg.com 浏览新版本包内文件：
   - https://unpkg.com/@earendil-works/pi-agent-core@<版本>/dist/harness/agent-harness.js —— 搜「HarnessNotImplemented」，应为 0 次；搜「create.restore」，确认打开含历史的 session 不再 throw
   - https://unpkg.com/@earendil-works/pi-agent-core@<版本>/dist/harness/agent-harness.d.ts —— 确认无 drive?: "manual" / peekAction / executeAction / runToCompletion 残留
4. 读 docs/plans/2026-09/2026-09-03/pi-release-tracking.md 的「迁移触发判据」一节，逐条对照，最终回复给出：新版本号与日期、判据逐条结果（满足/不满足/无法验证）、是否建议启动「pi 0.84 durable harness 迁移」立项。信号出现时明确写「建议立项」。
```

> unpkg 若被墙打不开，退化为 npm 版本页信息 + 明确标注「公开面未能验证」，等下次重试。

## 迁移触发判据（定时任务第 4 步引用）

- npm latest > 0.84.4 且 `HarnessNotImplemented` 为 0 次且 create() 支持历史 session 且无 manual-drive 系 API 残留 → **0.84 迁移立项信号出现**
- 届时参照会话组共享区 `pi-0.84-migration-research.md` 的 D 节迁移清单（17 项三档判定）与 E.3 六步顺序，写正式迁移 plan 并补到「pi 0.84 durable harness 迁移」任务（6cry9mp4）上
- 部分满足（如 runtime 实现了但 API 仍漂移）→ 记录快照差异，继续跟踪

## 手动深查版（判据不足时人工推进，需 Bash）

1. `bun pm view @earendil-works/pi-agent-core`（dist-tags.latest 与 time 字段）
2. 下载 tarball 解包验证三信号：`HarnessNotImplemented` 归零 / create() 支持历史 session / 无 manual-drive 残留
3. 看包内 CHANGELOG.md 是否含 durable harness runtime implemented 类条目

## 背景速查

- 当前基线：0.83.0（dogear，含 Windows 6 处 + pause 4 行 patch）
- 上游 main 分支 2026-09-03 快照已完整实现 durable runtime（规范 `packages/agent/docs/harness.md` §0.9：WP00-WP07 完成，仅 watchSession 为 stub），等发版
- 迁移后：Windows patch 可丢（上游已原生修复）；pause patch 作废，新 harness 无 shouldStopAfterTurn，需重新设计（迁移最大产品决策点）
