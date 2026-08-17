# 对话列表视图合并 + 智能分类单引用 + 组标题命名 设计

## 背景

当前对话列表有三个 tab（手动/智能/时间），用户希望合并为单一视图，手动文件夹始终在最顶部。同时简化智能分类为单引用、让组卡提炼自动命名话题组、归档超 30 天的游离组。

## 目标

1. 去掉三 tab，合并为单一视图：手动文件夹 → 近期 → 智能分类
2. > 30 天的游离组（不在手动文件夹里的）自动归档，归档区改浮窗
3. 智能分类改为单引用（一个组只在一个分类），去掉 ⟂N 标识
4. 组卡提炼时自动给话题组命名，deriveGroupTitle 去掉动态派生

## 架构

### 一、视图合并

去掉 `ViewTabs`，`ConversationList` 直接渲染：
```
ManualSection（手动文件夹区，始终最顶部）
RecentVirtualGroup（近期 < 5天）
SmartSection（智能分类区，去掉内部的 RecentVirtualGroup）
```
归档区从底部列表改为底部按钮 + Popover 浮窗。

### 二、自动归档

**前提修复**：`group.updatedAt` 当前只在组级操作时更新，不随会话活动更新。需要新增 `touchGroup`，在 `conversation-service` 的 create + touch 时调用，让 updatedAt 反映真实活动时间。

**归档逻辑**：
- `autoArchiveStaleGroups(wsId)`：扫描所有活跃组，排除在手动文件夹树里的 groupId，剩余的 > 30天（基于 group.updatedAt）的调 `archiveGroup`
- 归档时同步从智能分类移除（`removeGroupEverywhere`）
- 恢复时已有 `updatedAt = Date.now()`（相当于新组出现在近期）
- 触发时机：应用启动 / 工作区加载时

### 三、智能分类单引用

`pushGroup` 语义改为"把组放到此分类（自动从其他分类移除）"。在 `category-tools.ts` 的 SaveCategoryJoin / SaveCategoryNew 中先 `removeGroupEverywhere(idx, groupId)` 再加入。

### 四、组标题命名

`SaveGroupDigest` 保存组卡后，额外调 `groupService.updateGroup(wsId, groupId, { title })` 同步更新话题组显示名称。

`deriveGroupTitle` 两处（前端 + 后端）去掉动态派生：有 title 显示 title，无 title 显示"未命名话题"。

## 模块边界

### 前端

| 文件 | 改动 |
|------|------|
| `components/ConversationList.tsx` | 去掉 ViewTabs + view state，直接渲染三段 |
| `components/conversation-list/ViewTabs.tsx` | **删除** |
| `components/conversation-list/TimeSection.tsx` | **删除** |
| `components/conversation-list/SmartSection.tsx` | 去掉内部 RecentVirtualGroup |
| `components/conversation-list/ArchiveSection.tsx` | 改为 Popover 浮窗触发 |
| `components/group-list/GroupCard.tsx` | 移除 AppearanceBadge + useAppearanceCount |
| `components/group-list/utils.ts` | deriveGroupTitle 去掉动态派生，签名改为只接收 group |
| `components/conversation-list/AppearanceBadge.tsx` | **删除** |
| `components/conversation-list/utils.ts` | 删除 useAppearanceCount |

### 后端

| 文件 | 改动 |
|------|------|
| `electron/main/services/group-service.ts` | 新增 `touchGroup(wsId, groupId)` 只更新 updatedAt |
| `electron/main/services/group-helpers.ts` | deriveGroupTitle 去掉动态派生，签名改为只接收 group |
| `electron/main/services/conversation-service.ts` | create + touch 时调 touchGroup |
| `electron/main/services/memory/smart-category-store.ts` | pushGroup 不变（纯函数层保持简单），单引用在 tools 层处理 |
| `electron/main/agents/tools/category-tools.ts` | SaveCategoryJoin / SaveCategoryNew 先 removeGroupEverywhere；ListCategories 去掉归档过滤（归档时已移除） |
| `electron/main/agents/tools/group-digest-tools.ts` | SaveGroupDigest 后调 groupService.updateGroup 同步 title |
| `electron/main/services/memory/categorize-prompt.ts` | DEFAULT 加单引用说明 |
| `electron/main/services/memory/group-digest-prompt.ts` | title 字段说明改为"同步为显示名称，要简短" |

### 新增

| 文件 | 说明 |
|------|------|
| `electron/main/services/auto-archive-service.ts`（或合入 group-service） | autoArchiveStaleGroups 函数 |

## 数据流

### 自动归档

```
应用启动 / 工作区加载
  → autoArchiveStaleGroups(wsId)
    → 读取手动文件夹树，收集 folderGroupIds
    → 遍历活跃组，排除 folderGroupIds，筛选 updatedAt > 30天
    → 对每个调 archiveGroup + removeGroupEverywhere
    → 前端 group-store.load 刷新（归档组自然不在活跃列表）
```

### 组标题命名

```
组卡提炼任务
  → agent 调 SaveGroupDigest({ groupId, title, ... })
  → 保存组卡文件
  → 同步调 groupService.updateGroup(wsId, groupId, { title })
  → 前端 group-store 刷新拿到新 title
```

## 错误处理 / 边界情况

- **autoArchiveStaleGroups 失败**：不阻塞加载流程，log warn 继续
- **SaveGroupDigest 同步 title 失败**：不影响组卡保存（组卡是主产物，title 同步是副效果），log warn
- **touchGroup 失败**：不影响会话操作（会话活动是主操作，touch 是副效果），log warn
- **归档组在手动文件夹树中残留**：树节点不主动删除（无害），渲染时组不存在自然不显示
- **ListCategories 去掉归档过滤后**：归档时已主动 removeGroupEverywhere，双保险不再需要；但保留 activeGroups 过滤也无害（作为安全网）

## 未决问题

- autoArchiveStaleGroups 的触发时机精确位置（group-store.load 之后？后端启动 hook？）—— 实施时确定
- ArchiveSection Popover 内部是否需要搜索（归档多了不好找）—— 暂不做，后续按需加
