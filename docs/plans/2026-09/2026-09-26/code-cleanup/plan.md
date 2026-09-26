# 代码清理与结构优化实施计划

**目标**：删除微信功能整链、死代码、已完成的一次性迁移代码；收口重复实现；完成 snake_case 双格式迁移；拆分超长文件。依据三份调研报告（会话组共享区 `20260926-dead-code-report.md` / `20260926-compat-code-report.md` / `20260926-large-file-report.md`，执行某步时读对应报告章节取 file:line 明细）。

**架构思路**：按风险递增排序——先整功能删除与零风险清理（有数据证据），再复用收口与格式迁移（行为等价），最后文件拆分（低风险在前、门面文件在后）。拆分一律用 facade/re-export 模式让引用方零改动。

**涉及模块**：app/wechat、components/wechat、electron/main/services/wechat、electron/main/tipc、electron/main/main-app.ts、stores、components/conversation-list、article-service、pi-session、agent-worker 等。

## 步骤索引

- [x] [Step 1: 微信功能整链删除](./step1-remove-wechat.md) — 删 18 个微信专属文件 + 8 处点状引用，保留文章解析的微信公众号平台检测
- [x] [Step 2: 死代码删除](./step2-dead-code.md) — 未用 shadcn 组件、electron 死文件、遗留 types、临时产物目录
- [x] [Step 3: 兼容/迁移代码删除与数据清理](./step3-compat-code.md) — 19 项 marker 守卫的一次性迁移 + state-card 旧格式解析 + settings/plans 数据死键
- [x] [Step 4: 复用收口](./step4-dedup.md) — 广播函数回迁收口模块、逐字重复合并、detectPlatform 收口
- [x] [Step 5: snake_case 双格式迁移](./step5-snake-case.md) — 前端 12 文件 32 处改驼峰，删 toCompat 层
- [ ] [Step 6: 低风险拆分](./step6-split-low-risk.md) — article-service / WorkspaceExplorer / settings page / main-app / useTranscriptState
- [ ] [Step 7: 谨慎拆分](./step7-split-careful.md) — agent-worker / pi-session tool-assembly / stock-analysis-tools
- [ ] [Step 8: 收尾验证与文档同步](./step8-finalize.md) — 全量 lint/tsc/test、代码地图同步、总结

## 全局决策

- **每步收尾必跑**：`bun run lint` + `bunx tsc --noEmit`（渲染层）+ `bunx tsc --noEmit -p tsconfig.electron.json`（主进程）+ `bun test`（全量测试作回归锚点，重点 useTranscriptState / delegation-resume / settings-normalize）
- **每步一次 git commit**，message 格式 `refactor(cleanup): stepN <内容摘要>`
- **微信删除边界**：只删 bot 功能链（登录/收发消息/联系人/ilink）；文章解析中 `detectPlatform` 的 wechat 平台与 `mp.weixin.qq.com` 检测**保留**（文章库能力）；`browser-domain-names.ts` 的 `wechat.com` 域名映射保留
- **拆分统一模式**：原路径留 facade re-export 或主文件改名后 re-export 全部导出符号，引用方不改 import；新增目录小写 kebab-case
- **默认处置（用户未明确拍板的两小项）**：`claude_code_doc_md/` 删除（SDK 已迁移 pi，文档无参考价值）；`scripts/analyze-worker-imports.mjs` 保留（Step 7 拆 agent-worker 时排查打包依赖有用）
- **飞书保持现状**：微信删除后 bot 只剩飞书一家，不做通用渠道层抽象（沿用 chat.md 既有决策），R1 合并项作废
- 删除迁移代码后**不删** `.dogear` 下已存在的迁移 marker 文件（如 migration-session-id-done.json）：它们是「不要重跑」的哨兵，代码删了 marker 留着无害
