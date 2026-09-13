---
step: 1
title: 迁移改写地图为 9 个分域文件
status: done
---

## 目标
读原 `docs/codebase-map.md`（478 行 / 130KB），按功能域归属改写成 `docs/codebase-map/` 下 index.md + 8 个功能文件，条目全部压缩为一句话职责，完成后删除原文件。

## 依赖上下文（接力棒输入）
- 前置 step 产出：无（起点步骤）
- 设计文档：[codebase-map-split-design.md](../../codebase-map-split-design.md) 的「架构」节是归属与格式的唯一依据
- plan.md「全局决策」节：条目格式、硬约束沉淀、历史注记全砍、指针行规则
- 原文件章节 → 功能文件的粗映射：
  - `src/`、`hooks/`、`types/`、`lib/`、IPC 路由、测试基建、数据存储 → infra.md（内部小节：入口与路由 / IPC 总览 / lib / 类型 / 数据存储 / 测试基建），但**逐条过一遍归属**——hooks/lib/types 里明显属于某功能的（如 useTranscriptState 属 chat）放对应功能文件
  - `app/` 的各页面按功能拆：主工作区/会话窗口/伴随工作台 → chat.md；settings 系列 → settings.md；data-center 系列 → data-center.md；stocks → stocks.md；debug → infra.md
  - `components/agent-chat/` → chat.md；其余 components 逐条判断
  - `stores/` 逐条判断（conversation/workspace → settings 或 chat，按主归属）
  - `electron/main/services/`：browser 系 → browser.md；article 系 → articles.md；stock 系 → stocks.md；memory/topics → data-center.md；skill/agent 配套 → agent-core.md；其余逐条
  - `electron/main/agents/` → agent-core.md
  - `extension/` → browser.md
  - 「关键数据流」章节各条按功能拆入对应文件尾部 `## 数据流`
- 工作量提示：这是全计划的大头，建议整文件读入后一次性改写输出，上下文里全局视野可用于判断归属和写指针行

## 计划改动
- [x] 新建 `docs/codebase-map/index.md`（关键词路由表，~2KB）
- [x] 新建 `docs/codebase-map/chat.md`
- [x] 新建 `docs/codebase-map/agent-core.md`
- [x] 新建 `docs/codebase-map/browser.md`
- [x] 新建 `docs/codebase-map/articles.md`
- [x] 新建 `docs/codebase-map/stocks.md`
- [x] 新建 `docs/codebase-map/settings.md`
- [x] 新建 `docs/codebase-map/data-center.md`
- [x] 新建 `docs/codebase-map/infra.md`（含内部 6 小节）
- [x] 删除 `docs/codebase-map.md`（总量 130KB → 52KB）

## 实施回填（做完后填）

### 实际改动
- 与计划差异：无结构性差异。细节决策：协作任务拆两半（后端→agent-core / 面板 UI→articles）；agents/tools/ 功能工具按域拆出（browser/stock/notes/article/web 工具入各功能文件）；tipc/ 与 .dogear 存储整体放 infra.md 对应小节不按功能拆；通知中心系统兜底 infra.md。完整决策清单见共享区 step1-delivery.md。
- 改动文件清单：新建 docs/codebase-map/{index,chat,agent-core,browser,articles,stocks,settings,data-center,infra}.md 共 9 文件（总量 52KB，index 2.2KB）；删除 docs/codebase-map.md

### 给下一步的接力棒
- 关键签名 / 数据结构：index.md 为 8 功能文件路由表（文件+范围+中英文聊天词，2.2KB）；各功能文件尾部统一 `## 注意`（硬约束）+ `## 数据流`；条目格式 `路径` — 一句话职责
- 下个 step 该从哪里继续：`resources/skill-templates/codebase-map/SKILL.md` 与 `doc-sync/SKILL.md` 的改写，指引文本引用 `docs/codebase-map/index.md` 与「命中→读功能文件→未命中 fallback Glob/Grep」动线；doc-sync 写入路由同表
- 待办或已知限制：临时放 infra.md 待复核条目：通知中心系统（可考虑归 data-center 或单拆）、lib/sdk/（渲染层 SDK 封装消费方不明）、types/ai.ts+ai-service+tipc/ai（占位实现）、ui-store（与 settings 交叉）、wechat/（归 chat，若扩独立域再拆）
