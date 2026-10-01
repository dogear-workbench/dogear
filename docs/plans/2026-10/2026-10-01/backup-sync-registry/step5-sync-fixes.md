---
step: 5
title: 同步堵洞（轻量组）
status: pending
---

## 目标
修四个独立小洞：D1 push 接收端校验、D3 冲突副本防覆盖、F1 stocks/feishu 接入排除体系、U6 required 项禁关。

## 依赖上下文（接力棒输入）
- （执行时回填 step4 接力棒；本步与备份侧重叠仅为 registry 消费）
- 现状关键文件：`sync/server.ts:303-334`（handleFilePush 零校验直写）、`sync/apply.ts:82-97`（conflictCopyRelPath 固定名）、`sync/manifest.ts:43,78-99`（OPTIONAL_DIR_FLAGS 不在 excludes 体系）、`settings-types.ts` normalizeSyncOptions（接受 settings.json 进 disabledSyncItems）

## 计划改动
- [ ] D1/S1：handleFilePush 落盘前过与 applyIncoming 对称的校验：isExcluded（含 OPTIONAL_DIR_FLAGS）+ 工作区映射折算（对端路径 → 本端 wsid → enabled 检查）+ 禁写清单（sync-state.json、backups/、login-accounts.json 等 sensitiveRelPaths）；拒绝返回 4xx 带 reason
- [ ] D3：conflictCopyRelPath 与 saveLocalConflictCopy 的副本名追加时间戳段（`.conflict-<短ID>-<YYYYMMDD-HHmmss>`）
- [ ] F1：excludesFromSyncOptions 携带 OPTIONAL_DIR_FLAGS；isExcluded 尊重 stocks/feishu 本端 flag（diff remote-only 与 applyIncoming 两处生效，消除每轮全量重拉）
- [ ] U6：normalizeSyncOptions 过滤/拒绝 required 项（settings.json）进 disabledSyncItems；更新 sync-options-merge.test.ts 断言
- [ ] 单测：server push 校验（可用现有 delegation-test-mocks 风格 stub）至少覆盖「暂停工作区被推 → 拒绝」「禁写路径被推 → 拒绝」

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
