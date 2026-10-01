---
step: 4
title: 恢复升级快照还原
status: pending
---

## 目标
恢复语义从覆盖解压升级为时点快照还原（I-3），补防护（I-4）与预备份 keep 尊重（I-5）。

## 依赖上下文（接力棒输入）
- （执行时回填 step3 接力棒）
- 现状关键文件：`backup-service/index.ts:131-152`（restoreBackup：先预备份后校验、keep 恒 10、无会话防护）、:168-186（extractZipTo 覆盖解压）、`electron/main/agents/pi-session/pi-session-repository.ts:42`（metadataCache 不失效）、`CategoryCard.tsx:94-95` 恢复确认文案

## 计划改动
- [ ] 顺序修正（I-5 ②）：restoreBackup 先校验目标 zip 存在再跑预备份；预备份 keep 用用户配置（resolveCategoryConfig）而非 defaultConfig
- [ ] 快照还原（I-3）：解包写回后，枚举 registry 声明的该分类源路径下、现存但 zip 外的文件并删除——**删除仅限 registry 源边界内**（外部锚点按虚拟前缀对应真实目录）；`__ws-external__` 工作区注销场景跳过
- [ ] 会话防护（I-4）：恢复 sessions 分类前查运行中会话（agent-manager 运行态），有则整体拒绝并返回明确错误；恢复完成后失效 pi-session-repository metadataCache
- [ ] 旧 zip 兼容：无虚拟前缀的存量 zip 按现有规则恢复（不触发外部路径反解）
- [ ] UI：恢复确认文案加「快照内不存在的新增文件将被删除」；被会话防护阻止时 toast 说明

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
