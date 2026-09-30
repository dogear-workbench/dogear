---
step: 1
title: core-profile 整链路删除
status: done
---

## 目标

core-profile 能力包及其全部支撑链路（装配注入、agent 工具、IPC、数据中心入口、personal 默认键）从代码中移除，应用功能不受影响。

## 依赖上下文（接力棒输入）

- 无前置 step。设计依据见 [design.md](./design.md)「排除的选项」与「模块边界」
- 事实依据：两个工作区 `workspaces/{id}/memory/core-profile.md` 均为 45 字节空 frontmatter，从未使用；职责由全局规则与主题记忆接住

## 计划改动

- [ ] `electron/main/agents/ability-registry.ts:71` 删 core-profile 包定义
- [ ] `electron/main/agents/pi-session/pi-session.ts:36` 删 `loadCoreProfileForSession` import；`:402-405` 删 coreProfileText 装配；`:472` 删 personaParts 注入
- [ ] `electron/main/agents/tools/memory-tools.ts:198-268` 删 `dogear__GetCoreProfile` / `UpdateCoreProfile` 工具定义；文件末尾 `registerTools()` 元数据同步删条目
- [ ] `electron/main/services/memory/memory-loader.ts` 删 `loadCoreProfileForSession`（若该文件仅此一函数则整文件删）
- [ ] `electron/main/services/memory/memory-fs.ts:22` 删 coreProfilePath 相关函数（先确认无其他调用方）
- [ ] `electron/main/tipc/memory.ts:25` 删画像读取 IPC 路由
- [ ] `electron/main/tipc/ability.ts` 删四处 core-profile case（约 223、238、266、322 行）与子会话特判（约 385-386 行）
- [ ] `electron/main/services/workspace-config-service.ts:37` 删 PERSONAL_DEFAULT_CONFIG 的 core-profile 键
- [ ] 数据中心记忆面板：删画像查看/编辑块（实施时 grep `core-profile|coreProfile|核心画像` 定位组件，可能在 `app/` data-center 相关目录）
- [ ] 前端类型镜像（`types/electron-api.ts` 等）如有画像类型同步删
- [ ] 若 `ability-registry.test.ts` / `session-append-templates.test.ts` 引用 core-profile，同步更新断言

## 实施回填（做完后填）

### 实际改动

- 与计划差异：
  - 连带删计划未列的死代码：memory-service 的 getCoreProfile/updateCoreProfile、memory-types 双份 CoreProfile 类型与 CORE_PROFILE_SOFT_LIMIT、memory/index.ts 对应导出
  - memory-tools.ts 的 `opts.autonomous` 参数一并删除（唯一作用是挂载画像工具，删后成死参数）；唯一调用方 custom-agent-tools.ts 同步更新
  - 测试文件零改动（三个相关测试均无 core-profile 引用）
  - 顺带同步了 docs/codebase-map 两处描述（data-center/settings）
- 改动文件清单：18 个文件（主进程 12 + 前端 4 + codebase-map 2），其中 memory-loader.ts 与 core-profile-panel.tsx 整文件删除。验证：build:electron ✅ / 相关测试 36 pass ✅ / build:renderer ✅ / 全仓库 grep 零残留 ✅

### 给下一步的接力棒

- 关键签名 / 数据结构：`ABILITY_PACKS` 实际剩 **13 包**（workspace-rules/global-rules/memory/notes/workspace-git/group-context/agent-collab/shunt/stock/article/browser/web-mcp/code-workflow，交付文档写 12 系笔误）；`createMemoryToolDefs(workspaceId: string)` 签名已去第二参数；tipc client 已无画像方法（类型自动推导）
- 下个 step 该从哪里继续：ability-registry.ts 加 category 字段与 ABILITY_CATEGORIES 常量；tipc/ability.ts 的 buildMountRows/sceneReason 系文案是场景总览底座（子会话特判已删，loaded 直取 active.has）
- 待办或已知限制：数据中心记忆面板已无 Tabs 容器（TopicsPanel 直渲染）；AbilityPackDetailPage 的 jumpToDataCenter 已删
