---
step: 7
title: 收口验证与文档同步
status: done
---

## 目标
全链路回归（双机手测清单）、doc-sync 更新代码地图、写完成总结。

## 依赖上下文（接力棒输入）
- 前置 step 产出：step1-6 全部完成（各 step 回填的接力棒 + 与计划差异）
- 设计验收参照：[../sync-data-semantics-design.md](../sync-data-semantics-design.md) §5（错误边界）、§6（未决问题）

## 计划改动
- [x] 单测全量跑通（sync / task-store / settings 相关）
- [x] `build:electron` + 前端构建通过
- [x] 双机手测清单（依赖 Mac 真机，同 lan-sync step5 约束，不可用则记待办）：
  - Win 建任务 → 同步 → Mac 任务面板出现，plan 内容可读（dogear 工作区 clone 在场）
  - 文章库跨端出现（注意首轮体积提示）
  - 勾选目录跨端同步 + 双端勾选配置收敛一致
  - 改 snapshot 排除 → 同步 → 对端 settings.snapshot 不变（不再传播）
  - 旧版本对端（如有）不收 `__ws-external__` 垃圾条目
- [x] doc-sync：`docs/codebase-map/` 更新 sync 分域（虚拟路径机制、settings 白名单传播、userSyncPaths）
- [x] plan.md 末尾写「完成总结」（实际改动汇总、与计划偏差）

## 实施回填（做完后填）

### 实际改动

- 与计划差异：
  - 双机手测清单未执行（依赖 Mac 真机），整理成清单文本随交付文档转用户
  - plan.md 完成总结按指示未写（由派出者统一写）
  - 其余无差异：单测 / 双构建 / lint 全部通过（604 pass / 0 fail；0 errors，70 warnings 均既有且不在本步文件）
- 改动文件清单：
  - `electron/main/tipc/sync.ts` — revealSyncFile 接虚拟路径（Step 4 遗留项）：resolveWithinDataDir → resolveIncomingRelPath 统一反解，虚拟条目定位到工作区真实路径后 shell.showItemInFolder；未注册 wsid / 不安全路径维持 success:false 降级，虚拟前缀时错误文案给出具体原因（前端 toast description 展示）
  - `electron/main/services/sync/virtual-apply.test.ts` — 补 resolveIncomingRelPath 直接用例（reveal 定位语义：虚拟已注册反解 / 未注册 null / 普通路径限 configDir / 穿越 null）
  - `docs/codebase-map/data-center.md` — 设备同步节全面更新：protocol v4、workspace-map 补条目（既有文档遗漏）、manifest 虚拟条目收集、orchestrator 版本 gating、server guard 入参、push-guard 白名单放行、apply 统一反解 + settings 白名单传播制 + tasks 条目级合并、merge-records/ws-tree 新条目、tombstone 虚拟跟随、不变量更新；data-registry 条目补同步反解原语；sync-panel 面板条目更新三分组
  - `docs/codebase-map/settings.md` — settings-service.ts 条目补 applySyncOptionsPatch（rev 组字段 + userSyncPaths 归一）；types/settings.ts 条目补主进程 SETTINGS_SYNC_FIELDS 白名单
  - `docs/codebase-map/agent-core.md` — task-store.ts 条目补 planPath 相对化（version 2→3 迁移、读侧 join 本端工作区根、同步引擎条目级合并直写说明）
  - `docs/codebase-map/articles.md` — article-service.ts 条目补文章实体库存储（`<ws>/.dogear/articles/`）与同步语义（ws-articles 虚拟条目整文件 mtime 裁决）
  - `docs/codebase-map/index.md` — data-center 行补虚拟路径关键词

### 给下一步的接力棒

- 关键签名 / 数据结构：本步无新增 API；revealSyncFile 走 `resolveIncomingRelPath(root, relPath)`（apply.ts，落盘/读盘/定位唯一入口）
- 下个 step 该从哪里继续：无下个 step，收口完成。剩余事项仅双机手测（清单见共享区 20261004-step7-delivery.md，由用户在双真机上执行）与 plan.md 完成总结（派出者写）
- 待办或已知限制：
  - 同步引擎直写工作区 tasks.json 不经 task-store 的 withFileLock（与 plans.json 既有竞态模式一致，Step 4 已记录，未扩大处理）
  - orchestrator 双端真 HTTP 全链路虚拟条目集成测试未建（各环节单测 + server 端到端已覆盖，Step 4 已记录）
  - 生成物自动识别为二期（设计 §2.6 已明确本期不做）
