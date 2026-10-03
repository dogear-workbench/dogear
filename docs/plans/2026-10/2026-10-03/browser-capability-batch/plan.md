# 浏览器能力补齐批次 实施计划

**目标**：P1 残余四项（click 误报/wait_for+readArticle/tab 预算/injection 统一）+ 视觉两入口（read 图片修复/扩展截图/上传图片）+ 首个策略模板，一次批次收口扩展通道能力。

**架构思路**：视觉链路先修 read 工具的 ImageContent 分支（实测断点，底层 pi-ai 管线现成）；预算/injection 复用 site-policy 既有机制接扩展通道；策略模板走自定义 skill 零开发。设计详见 [../browser-capability-batch-design.md](../browser-capability-batch-design.md)。

**涉及模块**：
- 工具层：`electron/main/agents/tools/workspace-file-tools.ts`（read 图片分支）、`extension-tools.ts`（wait_for/readArticle/screenshot 注册）
- 协议双副本：`electron/main/services/browser/nm-protocol.ts` + `extension/src/nm-protocol.js`
- 扩展：`extension/src/dom-actions.js`、`content-extract.js`、`background.js`、`manifest.json`
- 策略：`electron/main/services/browser/site-policy.ts`
- 渲染层：会话输入框附件
- 模板：`~/.dogear/skills/xiaohongshu-research/SKILL.md`（config 目录）

## 步骤索引

- [x] [Step 1: 视觉链路修复（read ImageContent + 识图复测）](./step1-vision-read-image.md) — read 加图片分支修断点，Flash 识图实测
- [x] [Step 2: click 误报核查](./step2-click-false-positive.md) — hvszlply 议题 + A4 ref_expired 证据排查根因
- [x] [Step 3: 扩展工具补尾 wait_for / readArticle](./step3-waitfor-readarticle.md) — 协议加命令 + 扩展实现 + 工具注册
- [x] [Step 4: tab 预算与节奏控制](./step4-tab-budget.md) — site-policy 预算接扩展通道
- [x] [Step 5: prompt injection 双侧统一](./step5-injection-unify.md) — 扫描公共层 + 双侧接入
- [x] [Step 6: 扩展通道截图](./step6-extension-screenshot.md) — manifest 权限 + capture 命令 + 工具
- [x] [Step 7: 用户上传图片](./step7-image-upload.md) — 输入框附件 + 无视觉主会话路由
- [x] [Step 8: 首个策略模板 + doc-sync 收尾](./step8-first-playbook.md) — 小红书调研 SKILL.md + 代码地图同步

## 完成总结

2026-10-03 执行会话按 staged-execution 纪律实施完毕，8 步全完成，每步独立 commit（3773abed / 74813f12 / a878ac13 / 61f23956 / 874b0397 / db586270 / a9046e1e / 本步）。

- **视觉链路**：read 工具两链路支持图片（子会话 createReadTool 原生通 + workspace-file-tools 新图片分支覆盖 scheduler 链路）；原「read PNG 静默返回空」断点真根因是 screenshot 产出 0 字节空文件（capturePage 空图无检查），已补 isEmpty 防护；Flash 两轮识图复测确认端到端通
- **click 误报**：hvszlply 根因 = resolveLostClickResult 前缀匹配误判同域跳转，改等值比较已修；A4 ref_expired 判定为正确防御（用户手动操作致 DOM 重建，非 bug）；顺带修审计 confirmed 字段失真
- **扩展工具补尾**：协议 v4 追加 wait_for/readArticle/capture；扩展侧 waitFn/extractArticleHtml，主进程 parseArticleHtml 复用解析管线；manifest bump 0.5.0
- **预算节奏**：tab 上限 8（存活数语义）+ 操作间隔 2s 自动等待 + 全部预算拒绝 WARN 审计落盘
- **injection 统一**：injection-scan.ts 公共层（6 条中英规则），两通道 7 个读内容工具全量接入，命中加警告块不阻断；与站点 riskScan 正交并存
- **扩展截图**：captureVisibleTab 激活→截→还原（蓝组后台窗口 UI 闪动不可避免），组内安全双保险，无需新增权限
- **图片上传**：输入框补拖拽+5MB 上限；主会话无视觉时 vision-shunt 静默转派视觉模型识图（supportsVision 配置化标记，缺省 false）
- **策略模板**：xiaohongshu-research skill 落盘 config 目录，loadSkills 双方实测索引命中；doc-sync 同步四张代码地图

**待用户验证清单（需重载扩展 0.5.0 + 重启桌面端后）**：①同域站内链接 click 应报成功；②readArticle 带/不带 selector、wait_for 三条件；③截蓝组 tab 与焦点页各一张并 read 识图；④设置页给 GLM-5.3-Flash 勾「视觉」后输入框粘图观察静默转派；⑤新开会话说「调研小红书 X」确认 skill 自动命中

**遗留（未修，边界说明）**：「URL 相同但注入丢失」报 navigated_away 语义不精确（需新增 errorCode 属协议层变更）；workspace-file-tools 图片分支无缩放；角色劫持类注入模式未收录初版；识图用量不进会话 usage 统计

## 全局决策

- **协议 v4 内追加命令不 bump 版本号**：nm-protocol 双副本同发版，无跨版本协商场景；wait_for/readArticle/capture 追加进 CommandKind
- **扩展 manifest bump 0.5.0**（工具与权限变更）
- **主进程/渲染层改动需 `bun run build:electron`**；扩展改动需用户在 chrome://extensions 重载后真机验证
- **每 step 独立 commit**，step 文档回填接力棒后再提交
- **Step 1 与 Step 2 无相互依赖可并行派遣**；Step 6/7 依赖 Step 1 的 read 图片能力
- 视觉路由约定：主会话（glm-5.3 无视觉）收到图片一律转派子会话（GLM-5.3-Flash）处理，不在主会话内尝试识图
- 定时任务×浏览器已确认可用（custom-agent-tools.ts 按能力包装 browser 包），本批次不动
