---
step: 2
title: 解析质量三连（登录墙盲区 / qualityHint / 翻页拼接）
status: done
---

## 目标

修复一期已知三个解析质量问题：② 登录墙对「正文藏标准容器」漏判、③ qualityHint 对完整文章误示、① 翻页只取最长单页（约 1/3 内容）→ 翻页拼接全量采集。

## 依赖上下文（接力棒输入）

- 一期踩坑记录（plan.md ../2026-09-03/browser-article/plan.md「完成总结」）：`innerText` 对 `display:none` 退化 textContent 是 ② 根因；正文可见性度量须 innerText 而非 textContent（② 修复后此条注意点失效，改为 evaluate 内显式可见性）
- baseline.md 已知限制 1/3/4：② 漏判路径 `measureTextFn` 对 `article/main/[role=main]/#content/.content` 取 max 时把隐藏正文计入；③ 任务 2 断言固化了错误行为需反转；① URL 跳转型翻页未覆盖
- 展开/翻页白名单与启发式在 `browser-article-service.ts`（一期 step2 交付）

## 计划改动

- [ ] ② `browser-article-service.ts` measureTextFn：evaluate 内显式可见性计算（逐元素 getBoundingClientRect / computedStyle display+visibility 裁剪），替代 innerText 隐式裁剪
- [ ] ② `resources/browser-eval/pages/login-wall.html`：恢复「标准容器（article）承载隐藏正文」形态用例，断言 need_login（一期为聚焦真实形态改成了非标准容器，现在补回盲区用例）
- [ ] ③ qualityHint 条件化：仅「存在展开候选且点击后正文未变长」才提示；`tasks.json` 任务 2 断言反转为「无 hint」
- [ ] ① 翻页循环模式：命中「下一页」类按钮进循环（采集 → 点击 → 等稳定 → 再采集；innerHTML 替换型等 DOM settle，URL 跳转型等导航完成）；终止三条件（按钮消失/禁用、正文不再新增、20 页上限）；块级文本指纹去重；标题取第一页；超时/达上限取已采集部分 + quality_warning「翻页未完成（已采集 N/M 页）」
- [ ] ① 测试：翻页任务断言升级「三页标记全部存在」；新增 URL 跳转型翻页测试页与任务
- [ ] `bun run build:electron` 后 `node resources/browser-eval/run-pipeline.mjs` 全绿

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
  1. 指纹去重语义修正：mergePagedPages 只对「跨页出现的块」去重（页眉页脚骨架），同页内重复块保留。初版把同页重复段也吞了，翻页任务 wordCount 213 暴露问题；真实站点同页重复内容（诗歌/列表重复项）同样会被误杀，故修为跨页判定。
  2. 设计文档未决问题 3 落地：「正文不再新增」判定为新页相对历史页的块级指纹新增数 = 0（指纹精确匹配，无相似度参数）。
  3. qualityHint 翻页未完成文案落地为「翻页未完成（已采集 N/M 页）」，M = N+1（采集到第 N 页后在第 N+1 页处理中中断；达 20 页上限时即 20/21）。
  4. baseline.md 未更新，待 ④ Agent 基线采集后一并回填二期结果。
- 改动文件清单：electron/main/services/browser/browser-article-service.ts、resources/browser-eval/login-wall.html、resources/browser-eval/paged-url.html（新增）、resources/browser-eval/tasks.json

### 给下一步的接力棒
- 关键签名 / 数据结构：tryExpand → ExpandOutcome{candidates, expanded}（③ hint 条件化用 candidates>0 && !expanded）；runPagerLoop(page, deadline, emit) → PagerLoopOutcome{pages, incomplete: {collected, attempted} | null, finalUrl}；mergePagedPages(pages) 纯函数（跨页指纹去重，title/author/excerpt 等元数据取第一页）
- EXPAND_TEXTS 与 PAGER_TEXTS 已拆分（「下一页/下页/next」归翻页）；pager 用独立标记 data-dogear-pager，每轮循环重新标记（URL 跳转后 DOM 重建，标记随文档销毁）
- 下个 step 该从哪里继续：step3-antibot-prefetch.md，与本 step 无文件交集
- 待办或已知限制：60s 超时打断翻页 / 20 页上限两条降级路径无自动化测试（构造成本高，实现已就位：incomplete → 部分内容 + qualityHint，不硬失败）
- 验证：bun run lint 0 errors（99 warnings 均预先存在）；bun run build:electron 通过；node resources/browser-eval/run-pipeline.mjs 连续两轮 10/10 PASS（含新增 paged-url-pipeline-concat）
