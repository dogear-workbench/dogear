---
step: 2
title: 备份接 registry
status: pending
---

## 目标
备份分类源全部改由 registry 派生：修 I-1（tasks 路径）、I-2（补 groups.json 等）、新增 app-config 分类、外部锚点打包/恢复。

## 依赖上下文（接力棒输入）
- （执行时回填 step1 接力棒：backupSourcesFor 签名与外部锚点表示）
- 现状关键文件：`electron/main/services/backup-service/categories.ts`（resolveSources 手写路径，:86-102 为 I-1/I-2 病灶）、`zip-pack.ts`、`electron/main/services/settings-types.ts` DEFAULT_SETTINGS.backup、`app/data-center/version-backup/backup-meta.ts` CATEGORY_META

## 计划改动
- [ ] `categories.ts`：删除 resolveSources 的手写 switch，改调 registry 的 backupSourcesFor；BACKUP_CATEGORIES 增加 `app-config`（scopes: ['global']，daily/keep10）；notes-groups 显示名改「笔记与工作区」
- [ ] 源修正：tasks 走外部锚点（I-1）；notes-groups 补 groups.json/conversations.json/config.json/agent.md、去掉已下线的 dashboard.md（I-2）；sessions 源追加 `conversations/`
- [ ] `settings-types.ts` DEFAULT_SETTINGS.backup 补 app-config 默认值；`backup-meta.ts` 默认配置改从 categories 常量导入（消除三处重复定义）
- [ ] `zip-pack.ts`：打包支持外部锚点 → zip 内虚拟前缀 `__ws-external__/<wsid>/`；`index.ts` restoreBackup 反解时读 workspaces.json 映射回真实路径，工作区已注销则跳过并警告（此步只做路径反解，快照还原语义在 step4）
- [ ] UI：`backup-meta.ts` 新分类元数据 + `VersionBackupPanel`/`CategoryCard` 无需结构改动（分类驱动渲染），确认 app-config 卡片正常出现

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
