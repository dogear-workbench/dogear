---
step: 5
title: 自动归档修复 + 死事件清理
status: pending
---

## 目标

30 天自动归档从死路径改为主进程定时触发（归档后列表自动更新依赖 Step 1 广播已就位）；删除 4 个广播无订阅死事件 + 5 个纯类型残留 + 相关注释与死代码。

## 依赖上下文（接力棒输入）

- 前置 step 产出：Step 1 已让 group-service.archiveGroup 写点 immediate 广播 → 归档后前端列表自动更新无需额外接线
- 前置 step 产出：Step 2 已删 group-store.load 的 autoArchiveStale 触发链（本步把功能挪到主进程）
- 死路径事实（盘点报告缺口 7）：autoArchiveStaleGroups(wsId)（auto-archive-service.ts:19）唯一前端触发入口 tipc/group.ts:182 的 autoArchiveStable procedure，其唯一调用方 group-store.load 无人调用 → 30 天归档从未跑过
- 分类一致性事实：auto-archive 内部调 removeGroupEverywhere 更新智能分类索引，getCategories 读取时有归档/存活性过滤（tipc/category.ts）——分类列表不需要额外广播

## 计划改动

- [ ] `electron/main/index.ts`：启动 fire-and-forget 跑一次全工作区归档扫描（遍历 workspaces.json，逐个 autoArchiveStaleGroups(wsId)，失败仅 warn）+ `setInterval` 24h 重复；app quitting 时 clearInterval
- [ ] `electron/main/tipc/group.ts`：autoArchiveStable procedure 与 group-store.load 链路已断——确认无其他调用方后删除该 procedure（保留 service 函数本体，主进程用）
- [ ] 删 4 个死事件（发送点 + 类型 + 相关死代码）：
  - wechatNewMessage：tipc/wechat.ts:167 发送点；stores/wechat-store.ts:214 handleNewMessages 死代码
  - conversationRunningStateChanged：wechat-bot-controller.ts:352
  - agentTaskUpdate：tipc/agent.ts:143-145
  - deliveriesAwaitChanged：delegation-bridge.ts:129
- [ ] 删 5 个纯类型残留（renderer-handlers.ts）：agentStreamChunk / agentSessionMessage / subAgentStarted / subAgentCompleted / sessionWindowReady
- [ ] 同步清理误导注释：app/page.tsx:304、components/WorkspaceTabBar.tsx:91（声称依赖 sessionWindowReady，实现不存在）
- [ ] 全局 Grep 确认删除后无残留引用；`bun run build:electron` + `bun run build`（渲染层类型也受影响）+ `bun run lint`

## 验证

- 手动把某测试组 updatedAt 改到 31 天前（groups/{wsId}.json）→ 重启应用 → 该组自动归档且列表无需操作即消失（Step 1 广播链路）
- 归档的组不在手动文件夹时才归档（auto-archive-service 现有筛选逻辑不动）
- 全量构建通过；Grep 六个被删事件名零命中

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 全部 step 完成后：回 plan.md 勾掉本步并写「## 完成总结」（实际改动汇总、与原计划偏差）
- 待办或已知限制：
