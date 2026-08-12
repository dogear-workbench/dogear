# 对话列表视图合并 实施计划

**目标**：合并三 tab 为单一视图，智能分类改单引用，组卡提炼自动命名话题组，游离组 > 30天自动归档。

**架构思路**：后端基础先行（touchGroup + deriveGroupTitle 简化 + SaveGroupDigest 命名），再做智能分类单引用 + 去标识，然后自动归档服务，最后前端视图合并 + 归档浮窗。

**涉及模块**：group-service / conversation-service / smart-category-store / category-tools / group-digest-tools / group-helpers / ConversationList / GroupCard / ArchiveSection

## 步骤索引

- [x] [Step 1: 后端数据层基础](./step1-backend-foundation.md) — touchGroup + deriveGroupTitle 简化 + SaveGroupDigest 同步 group.title
- [x] [Step 2: 智能分类单引用 + 去标识](./step2-smart-category-single-ref.md) — 单引用语义 + 删除 AppearanceBadge
- [x] [Step 3: 自动归档](./step3-auto-archive.md) — 游离组 > 30天归档 + 归档时从智能分类移除
- [ ] [Step 4: 视图合并 + 归档浮窗](./step4-view-merge.md) — 去掉三 tab + ArchiveSection 改 Popover

## 全局决策

- **group.updatedAt 语义变更**：从"组元数据修改时间"变为"组最后活动时间"（通过 touchGroup 在会话活动时刷新）。近期/归档判断都依赖此字段
- **智能分类单引用**：一个组只能在一个分类，pushGroup 语义变为"放入此分类并自动从其他分类移除"。实现在 tools 层（SaveCategoryJoin / SaveCategoryNew 先 removeGroupEverywhere）
- **归档简化**：归档时从智能分类移除，恢复时 updatedAt = now（已有行为），智能分类层不需要做归档过滤
- **deriveGroupTitle 简化**：去掉动态派生（不再用会话标题拼"XXX 等3个"），有 title 显示 title，无 title 显示"未命名话题"（前端）/ "未命名组"（后端）
- **prompt 文件迁移**：categorize-prompt.md 和 group-digest-prompt.md 是磁盘文件，用户可能已自定义。需要加 sentinel 机制确保新版 prompt 生效（参考 group-digest-prompt.ts 已有的 SAVE_BACKGROUND_SENTINEL）
- **不写注释**（项目规范），只在 WHY 非显而易见时加一行
