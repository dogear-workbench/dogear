---
step: 5
title: 验收收口
status: pending
---

## 目标

全量冒烟 + 真机验收 + 文档同步，P3 收口。

## 依赖上下文（接力棒输入）

- 前置 step 产出：step1 gate / step2 href / step3 read_state / step4 site 引擎全部编译通过且各自冒烟过
- 关键决策回顾：风控优先——真机验收出现滑块/验证码即停，人工处理后换新会话再试（宁慢勿 ban）

## 计划改动

- [ ] 全量回归：`node` 跑 `resources/browser-eval/` 全部冒烟（site-policy / nm 系列 / 新增 ownership / read_state / pipeline）；`bun run build:electron`；`bun run lint`
- [ ] 真机验收清单（需用户在场配合，逐项记录结果）：
  - 扩展重载（协议版本升级后必须）：chrome://extensions 重载 Dogear → 扩展状态显示已连接
  - A1：主会话并行派两个浏览器解析子会话 → 第二个应收到 busy 明确报错并在交付里说明
  - A2：小红书搜索页 observe → 卡片元素带 `href=...`（含 xsec_token 完整可用）
  - A2+A3 串联：拿 href → navigate 直达笔记详情 → read_state 或 read_text 读到正文（本轮核心验收目标：**详情可达**）
  - A3：搜索页 read_state 无 path 看顶层 → 下钻拿到卡片数组（真机探小红书实际字段路径，**回填到工具描述示例**）
  - B：`search('renovation mistakes', {site:'reddit'})`（Clash 存活）出带 score 结果；关 Clash 重试 → 降级 site: 通用链 + degradations 提示；`site:'zhihu'` 直连出结果
  - 预算：小红书同一页面多次 read_state 只计 1 次笔记（账本核对）
- [ ] 验收发现的偏差回填各 step 文档「实施回填」节 + plan.md 完成总结
- [ ] doc-sync：`docs/codebase-map.md` 同步新工具（read_state、site 参数）与 ownership 模块
- [ ] 记忆沉淀：小红书 `__INITIAL_STATE__` 实测字段路径、真机验收暴露的新坑（够格才存）

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
