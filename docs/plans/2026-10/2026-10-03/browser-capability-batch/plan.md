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
- [ ] [Step 6: 扩展通道截图](./step6-extension-screenshot.md) — manifest 权限 + capture 命令 + 工具
- [ ] [Step 7: 用户上传图片](./step7-image-upload.md) — 输入框附件 + 无视觉主会话路由
- [ ] [Step 8: 首个策略模板 + doc-sync 收尾](./step8-first-playbook.md) — 小红书调研 SKILL.md + 代码地图同步

## 全局决策

- **协议 v4 内追加命令不 bump 版本号**：nm-protocol 双副本同发版，无跨版本协商场景；wait_for/readArticle/capture 追加进 CommandKind
- **扩展 manifest bump 0.5.0**（工具与权限变更）
- **主进程/渲染层改动需 `bun run build:electron`**；扩展改动需用户在 chrome://extensions 重载后真机验证
- **每 step 独立 commit**，step 文档回填接力棒后再提交
- **Step 1 与 Step 2 无相互依赖可并行派遣**；Step 6/7 依赖 Step 1 的 read 图片能力
- 视觉路由约定：主会话（glm-5.3 无视觉）收到图片一律转派子会话（GLM-5.3-Flash）处理，不在主会话内尝试识图
- 定时任务×浏览器已确认可用（custom-agent-tools.ts 按能力包装 browser 包），本批次不动
