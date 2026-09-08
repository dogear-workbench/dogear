---
step: 4
title: Profile 方法论重构 + 迁移 + 首批档案
status: pending
---

## 目标

浏览器解析 Profile 描述从「流程剧本」重构为「探索方法论」，带旧值迁移；用 P3 验收产出建首批小红书档案。

## 依赖上下文（接力棒输入）

- 前置 step 产出：Step 3 的 site_knowledge / site_finding 工具已可用（方法论要引用它们）
- 当前关键文件状态：`settings-types.ts` 浏览器解析 Profile 内置定义（description 含 P2 写的小红书工作流剧本 + P3 独占提示）；settings 里存的是内置定义副本，deepMerge 保留旧值——**description 变更必须做「已知旧值 → 新值」迁移**（先例 settings-service.ts:294）
- 关键决策回顾：方法论核心 = 目标导向 + 行动前确认世界状态 + 偏差恢复 + 假设驱动 + 失败收敛（同页连续 3 次探索失败即停并报告）+ 取地图是标准第一步；独占提示保留

## 计划改动

- [ ] `settings-types.ts` 重写浏览器解析 Profile description。要点（不是流程步骤，是行为原则）：
  - 探索循环：每次行动前确认世界状态（observe/read_state 概要）；页面与预期不符时先恢复（navigate 回目标页）再继续，不把偏离当失败上报
  - 假设驱动：每次 read_state 下钻带明确预期；「我猜数据在 X」而非乱试
  - 站点地图：导航后若返回带档案指针，先调 site_knowledge 取地图再探索；地图可能漂移，用时概要验证；发现新结构用 site_finding 沉淀
  - 失败收敛：同一页面连续 3 次探索失败 → 停止并报告已发现的内容
  - 风控红线沿用：滑块/验证码即停；随机延迟不规避；扩展通道独占（保留现有文案）
- [ ] `settings-service.ts` 加 description 迁移（旧值 → 新值，对齐既有迁移函数风格）
- [ ] 新建 `.dogear/site-knowledge/xiaohongshu.com.md` 首批档案，正式地图内容（已真机验证）：
  - 搜索结果卡片数组：`__INITIAL_STATE__.search.feeds._value.{index}`（Vue ref 包装，真实数组在 `_value`）；卡片字段：`id` / `modelType:"note"` / `xsecToken` / `noteCard.displayTitle` / `noteCard.user` / `noteCard.interactInfo`（likedCount/collectedCount/commentCount/sharedCount，字符串型）/ `noteCard.cover` / `index`；直链拼法 `/search_result/{id}?xsec_token={xsecToken}&xsec_source=`；`_value[0]` 与 observe 可见顺序不保证一致，以 id 为准
  - 笔记详情正文：`__INITIAL_STATE__.note.noteDetailMap.{noteId}.note.title|.desc|.interactInfo|.user`；注意 `note` 顶层循环引用不可序列化，必须直接下钻 `noteDetailMap`；详情页 `search.feeds._value` 为空数组（探搜索路径必须在搜索页）
  - 发现区初始两条：① search 形态漂移（ref 包装 vs 解包对象，SSR 注水/路由切换改写，用前概要验证）② read_text 在详情页读「最大文本容器」非 note.desc（desc 可能只有话题标签，正文在图片里）
- [ ] eval 冒烟：Profile 迁移生效（旧 description → 新 description）断言

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
