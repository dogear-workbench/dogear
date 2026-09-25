# 沉淀物三层治理设计

**日期**：2026-09-22
**状态**：方案已拍板，实施计划待写（staged-impl）

## 背景

使用过程中产生多类沉淀物，缺少生命周期管理，出现副产物堆积：

- `groups/` 下 126+ 话题组、72 个非空 shared，`step1-delivery.md` 重名 60 次
- 笔记目录 19 正文 + 34 个 .bak
- 浏览器踩坑知识独立为全局单文件 `browser-playbook.md`（5 条），无索引、无清理机制
- 全局 .dogear 下 *.bak 遍地（无版本管理的代偿痕迹，git 方案已分流独立话题）

## 目标

按「受众 × 生命周期」三层分治，不搞大一统归一：

1. **agent 知识层**（memory + playbook）：归一管理入口
2. **用户工作台层**（notes）：完成 → 归档流转
3. **会话工件层**（shared）：删除机制补全 + 命名规范化

## 架构

### 排除的选项

- **大一统沉淀仓库**：三层东西生命周期不同（长期知识 / 用户卡片 / 临时工件），强行归一会让清理策略互相绑架
- **归档时物理移动 group 目录到 _archived/**：归档是纯逻辑标记（`archivedAt`），检索面已由代码过滤，物理移动多余
- **批量删除时保留 digest**：归档视图内删除已是二次确认，留摘要等于三次确认；年终总结类场景不做

### 各层方案

**① shared 工件层**

- 删除机制维持现状（已验证 `topic-lifecycle-service.ts`：deleteTopic 逐会话物理删 + `fs.rm` 整个 group 目录含 shared；deleteConversation 删会话数据、组空连带删目录）
- **新增批量清理入口**：归档视图提供「清理归档超过 N 天的话题」，语义与手动删除完全一致（全删，含 digest），确认弹窗走 confirm-store 的 showConfirm
- **命名规范化**：SaveSharedNote 工具层自动补 `YYYYMMDD-` 日期前缀（调用者已带则不重复）；任务名前缀靠提示词约定

**② agent 知识层（playbook 归入 memory）**

- memory 主题结构新增 `inject` 标志（`'subagent'` 表示注入型）
- playbook 数据上成为 memory 主题、进统一索引（SaveMemory/ForgetMemory/清理共用一个入口）；行为上保留注入：pi-session 创建 browser-parse 子会话时发现 `inject: 'subagent'` 则全量注入系统提示（现状语义不变）
- 归一收益：主会话直接用浏览器工具时 RecallMemory 也能命中 playbook（当前主会话无注入，是小缺口）
- **跨工作区问题**：playbook 是全局的，memory 按工作区隔离。倾向 memory 体系支持全局主题（全局 `.dogear/memory/` 目录已存在但未使用，实施时核实预留意图）；playbook 成为第一个全局主题

**③ 用户工作台层（notes）**

- 完成的任务卡片 → 归档视图流转（轻做：完成态标记 + 归档过滤视图；复用现有回收站机制之外增加归档态，实施时核实 notes 现有状态机）

## 模块边界

| 改动 | 文件 |
|---|---|
| 批量清理入口 | `electron/main/tipc/group.ts`（新 RPC）、`topic-lifecycle-service.ts`（批量编排）、`components/archive/ArchiveTopicList.tsx`（入口 UI） |
| 命名规范化 | shared 写入路径（`group-shared-service.ts` / SaveSharedNote 工具层）+ 相关提示词 |
| playbook 归一 | memory 服务（index 结构 + inject 字段 + 全局主题支持）、`agents/pi-session/`（注入逻辑）、存量迁移（playbook.md → memory 主题） |
| 笔记归档流转 | notes 服务/store + 前端视图 |

## 数据流

- 批量清理：归档视图 → 按阈值筛 groups（`archivedAt` < now-N 天）→ showConfirm → 逐个 deleteTopic（复用现有全删语义）→ 广播列表刷新
- playbook 注入：pi-session 建子会话 → 读 memory 索引中 `inject: 'subagent'` 的全局主题 → 全文进系统提示；检索路径：RecallMemory 命中同一份索引

## 错误处理 / 边界情况

- 批量删除中单个话题失败：跳过并继续，结束后汇总失败列表（不中断整批）
- 命名前缀：调用者已带日期前缀不重复补；重名冲突沿用现有覆盖/报错语义
- playbook 迁移幂等：全局 memory 主题已存在时不重复迁移；迁移后原 browser-playbook.md 保留还是删除，实施时定（倾向迁完即删，git 分流话题落地后可有版本兜底）
- 归档话题正被使用时批量删除：归档组已有操作守卫（group-service 报错），批量入口沿用

## 未决问题

- 笔记归档流转的具体状态机（现状只有回收站软删除，是否够用待核实——若回收站已满足「完成→收起」诉求则此层降级为不做）
- 批量清理的 N 天默认值（倾向 30，做设置项还是固定值待定）
- 全局 memory 目录的预留意图（实施时核实，避免与已有设计冲突）

## 关联

- git 人机共管：独立话题，不在本设计范围
