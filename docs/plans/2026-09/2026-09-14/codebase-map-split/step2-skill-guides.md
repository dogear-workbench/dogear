---
step: 2
title: 改造两个 skill 指引
status: done
---

## 目标
改写 `resources/skill-templates/codebase-map/SKILL.md` 与 `resources/skill-templates/doc-sync/SKILL.md`，使 skill 动线指向新的分域地图结构。

## 依赖上下文（接力棒输入）
- 前置 step 产出：[step1-migrate-map.md] 已建 `docs/codebase-map/` 9 文件、删原单文件
- 当前关键文件状态：仓库 `resources/skill-templates/` 是 skill 源头；运行中的 Dogear 从安装目录 `C:\Users\Dreama\AppData\Local\Programs\Dogear\resources\skill-templates\` 加载（构建产物，两处当前内容一致）
- 关键决策回顾：index.md 路由表管两头（agent 检索入口 + doc-sync 写入路由），所以两个 skill 指引都围绕 index.md 组织

## 计划改动
- [x] `resources/skill-templates/codebase-map/SKILL.md`：动线改为「先 Read `docs/codebase-map/index.md` → 功能词命中后读对应功能文件 → 未命中 fallback Glob/Grep（地图不是穷举）」；保留「索引可能滞后，简单定位直接 Glob/Grep」的既有语义
- [x] `resources/skill-templates/doc-sync/SKILL.md`：Step 2 执行节改为「按 index.md 关键词路由定位功能文件 → 精准编辑对应文件」；新增条目规范一句话职责格式 + 硬约束进注意区；决策树（值得/不值得更新）不动
- [x] 同步安装目录副本：两个 SKILL.md 已复制到安装目录，diff 验证逐字节一致

## 实施回填（做完后填）

### 实际改动
- 与计划差异：无。补充：doc-sync Step 2 顺手加一句「条目只在主功能文件出现，次要相关文件留一行指针」（来自 plan.md 跨功能归属决策）；改前 grep 确认 skill-templates 内无 `codebase-map.md` 旧引用残留
- 改动文件清单：仓库 `resources/skill-templates/{codebase-map,doc-sync}/SKILL.md` 改写；安装目录两副本同步（diff 逐字节一致）

### 给下一步的接力棒
- 关键签名 / 数据结构：codebase-map 指引 3 步动线（index 命中 → 功能文件拿路径 → 未命中 fallback Glob/Grep）；doc-sync 动线（index 路由 → 功能文件精准编辑，条目一句话职责 + 硬约束进 `## 注意`）
- 下个 step 该从哪里继续：step3 验证以上述动线为准做真实功能词抽查、查重复条目、验证 doc-sync 写入路由
- 待办或已知限制：安装目录副本即时生效，正式生效随下次打包分发
