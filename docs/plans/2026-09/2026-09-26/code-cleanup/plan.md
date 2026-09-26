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
- [x] [Step 6: 低风险拆分](./step6-split-low-risk.md) — article-service / WorkspaceExplorer / settings page / main-app / useTranscriptState
- [x] [Step 7: 谨慎拆分](./step7-split-careful.md) — agent-worker / pi-session tool-assembly / stock-analysis-tools
- [x] [Step 8: 收尾验证与文档同步](./step8-finalize.md) — 全量 lint/tsc/test、代码地图同步、总结

## 全局决策

- **每步收尾必跑**：`bun run lint` + `bunx tsc --noEmit`（渲染层）+ `bunx tsc --noEmit -p tsconfig.electron.json`（主进程）+ `bun test`（全量测试作回归锚点，重点 useTranscriptState / delegation-resume / settings-normalize）
- **每步一次 git commit**，message 格式 `refactor(cleanup): stepN <内容摘要>`
- **微信删除边界**：只删 bot 功能链（登录/收发消息/联系人/ilink）；文章解析中 `detectPlatform` 的 wechat 平台与 `mp.weixin.qq.com` 检测**保留**（文章库能力）；`browser-domain-names.ts` 的 `wechat.com` 域名映射保留
- **拆分统一模式**：原路径留 facade re-export 或主文件改名后 re-export 全部导出符号，引用方不改 import；新增目录小写 kebab-case
- **默认处置（用户未明确拍板的两小项）**：`claude_code_doc_md/` 删除（SDK 已迁移 pi，文档无参考价值）；`scripts/analyze-worker-imports.mjs` 保留（Step 7 拆 agent-worker 时排查打包依赖有用）
- **飞书保持现状**：微信删除后 bot 只剩飞书一家，不做通用渠道层抽象（沿用 chat.md 既有决策），R1 合并项作废
- 删除迁移代码后**不删** `.dogear` 下已存在的迁移 marker 文件（如 migration-session-id-done.json）：它们是「不要重跑」的哨兵，代码删了 marker 留着无害

## 完成总结（2026-09-26）

8 步全部完成，总变化 **136 文件，+5284 / -10440，净删 5156 行**（不含 .dogear 数据清理）。

### 实际改动汇总
- **Step 1 微信整链**：删 16 文件（页面/组件/服务/tipc/store/types）+ 8 处点状引用 + agent-chat source 死链连带；文章解析公众号检测按边界保留
- **Step 2 死代码**：删 11 文件（shadcn 3 + electron 5 + types 3）+ 4 临时目录 + electron-api 死 re-export/transcript-adapter 孤儿函数连带
- **Step 3 迁移代码**：19 项 marker 守卫一次性迁移全删（7 模块整删 + main-app 11 块 + 14 处点状）；state-card 旧格式按拍板删（107 旧卡不解析）；数据侧 settings -3 键 / plans -4 builtin / 3 工作区 smart-categories 删
- **Step 4 复用收口**：广播三处收口 renderer-broadcast、safe 合并 stock-format、getRelativeTime 收口、agent-worker 死变体删、deepEqual 互认注释
- **Step 5 snake_case**：前端 16 文件切 camelCase，toCompat/双格式转换层删，Conversation/Workspace 类型镜像主进程内部格式
- **Step 6 低风险拆分**：article-service→article/ 六文件+facade、WorkspaceExplorer 1034→465+三模块、settings 884→164+两 Tab、main-app 941→405+window-factories+tray（连带删调试窗口死链）、useTranscriptState 889→三层
- **Step 7 谨慎拆分**：agent-worker 961→277 壳+tasks/ 四模块、pi-session 1486→1142（抽 tool-assembly）、stock-analysis-tools 1061 三域分组
- **Step 8 收尾**：全量验证绿、代码地图 9 文件同步、本总结

### 与原计划偏差
1. Step 2/3 各有计划外连带清理（死 re-export、孤儿函数、调试窗口死链等），均属删除引发的合理连带，已在各 step 回填记录
2. Step 7 P5 第二步 compaction.ts **主动不做**：maybeAutoCompact 与 7 个实例可变状态耦合，抽出签名复杂度反超收益（与调研「不建议拆」一致）
3. Step 3 后 main-app 调试窗口基础设施成死链，在 Step 6 P6 拆分时一并处置（sendToDebugWindow 保留 no-op，tipc/agent.ts 在用）
4. 各步行数与预期偏差均记录在 stepN.md 回填段（±15% 内为主，超限项均有口径解释）

### 清理效果
- 900+ 行巨型文件 **9 → 2**（TOP1 1486→1142）；300+ 文件 78→76；TS 文件 546→530
- 微信功能链、19 项一次性迁移、snake_case 双格式、重复实现全部清零
- 行为锚点：bun test 全程 319 pass/0 fail（各步基线一致）；useTranscriptState/tool-registration-smoke 等拆分锚点测试零改动通过

### 待用户验证（交互冒烟，无 GUI 环境无法代做）
飞书 bot 收发、文章解析后台任务链（微信文章→公众号检测）、话题状态卡（新格式）、设置页各 Tab 保存、多窗口+托盘、股票工具调用、调度器列表
