# 浏览器三期启动记录（扩展 + NM，待立项）

**日期**：2026-09-04
**状态**：待立项——二期（../browser-phase2/plan.md）完成后启动
**定位**：扩展 + Native Messaging，社交软件交互锚点——用用户真实登录态（主浏览器）操作微博/X/Reddit/贴吧等；真人指纹过风控是隐性优势
**上游**：笔记 r1nwc444《浏览器自动化分期路线与核心点》、两份勘查报告（本目录 browser-nm-packaging-survey.md / stagehand-embedding-survey.md，均已实验实证）

## 已拍板决策（勘查后无阻塞项）

1. **NM + NSIS 主线可立项**，最小改动 3 处：
   - `build/installer.nsh` 加 `customInstall`/`customUnInstall` 宏写/清 HKCU 注册表（Google\Chrome + Microsoft\Edge 两键；HKCU 无需管理员；manifest 用相对 path，用户改安装路径天然自愈）
   - 主 exe 加 `--nm-host-bridge` 分流（**必须在 requestSingleInstanceLock 之前分流**，跳过单实例锁、不建窗口，stdio ↔ 本地 socket 转发）；主进程单 listener 收敛多 host 连接（每次 connectNative 起独立进程，实测无单实例约束）
   - 扩展 manifest 内置 `key` 字段固定扩展 ID（算法已实验验证），`allowed_origins` 构建期写死
2. **扩展分发**（2026-09-05 修正）：自用阶段开发者模式手动加载 unpacked 即可——manifest 内置 `key` 固定 ID 已实验验证，NM `allowed_origins` 照常锁死；Edge 加载体验基本无损，Chrome 有每次启动的开发者模式提示横幅。**对外分发时上架商店才是正式工作项**（Chrome stable 152 已实测禁 `--load-extension`；Chrome Web Store $5（可 unlisted）或 Edge Add-ons 免费——Edge 优先）；审核周期不可控，分发需求出现时提前启动
3. **便携版 + NM 延后**（portable 解压到 %TEMP% 退出即删，host 需落地稳定路径 + 注册表自愈，成本高；若做标「实验性」）
4. **Stagehand 不嵌入**（架构错位：pi-session 主 Agent 与浏览器间插第二层 LLM，token 双份/延迟翻倍/决策黑盒；ClientLLM 回调接 pi-ai 技术可行但非嵌入理由，v3→v4 推倒重来证明 API 漂移风险）
5. **MVP host 形态**：主 exe `--nm-host-bridge` 分流（零额外分发）；打磨期再评估独立轻量桥 exe

## 三期设计要素清单（设计文档待写）

- **场景**：真实登录态社交操作（微博/X/Reddit/贴吧）；一期受控浏览器继续服务文章读取，两线并存
- **硬需求**（一期砍掉的主菜）：
  - 域名级授权与撤销（标签页/域名粒度，permission-rules 加映射）
  - 发送/发布/私信强制审批卡——**展示最终业务内容**（发什么批什么，不是批抽象动作）
  - 平台风控封号风险提示（微信网页版类）
- **工具层增强**（Stagehand 借鉴项，自研进 browser-tools 体系）：
  - a11y 混合树观察格式：紧凑缩进文本 + `[帧序-backendNodeId]` 编号 → XPath 映射（比纯 DOM 遍历语义强、省上下文）
  - extract 严格抽取协议：用户 zod schema 严格结构化 + 分块续跑 + Metadata(progress/completed) 完成度循环 → `extract_structured` 工具
  - act/observe prompt 设计（勘查报告已留存完整 prompt 原文）
- **待设计问题**：扩展功能面（observe/act 协议、content-script 注入策略）、Companion 降级后的主进程 browser-gateway 服务形态、NM shim（第二实例转发）、权限模型与审批卡 UI、多 tab 管理、与调度器联动（届时加 browserModelSelection，与 digest 同构的后台 runOnce 链）
- **红线**（沿用）：不绕 CAPTCHA/风控、不默认付款发帖、无审计不批量改真实数据

## 路线图拍板（2026-09-05，对比外部建议笔记《浏览器方向》后）

- **分期**：P0 地基（NM bridge + NSIS 注册表 + 扩展骨架 + 域名授权随行；扩展开发者模式手动加载，零外部依赖）→ P1 只读工具（observe/click/fill/readText + a11y 树 + 动作流）→ P2 首发平台只读工作流（**小红书**，拍板）→ P3 BrowserAdapter 沉淀 + 站内搜索工具化 → P4 低风险写入（L2 单次确认）→ P5 发布/发送（L3 审批卡）
- **吸收外部建议**：「当前标签页」能力入 P0 MVP 最小闭环；风险四级 L0-L3 入权限模型（审批批业务意图不批抽象动作）
- **保留意见**：BrowserAdapter 不前置（P3 两实现齐全后再抽，单实现时照 playwright 捏接口必错）；扩展闭环与 NM 必须同期；审批基建随 P0 MVP 不后置；网关命名 browser-gateway（避撞伴随工作台）
- **延后池**（详见笔记卡片 r3hsb3vz）：邮箱官方 API 独立项、CDP 高级模式、微博/知乎/贴吧适配器、NM 第二通道、便携版 + NM、Temporal 类编排

## 启动动作

1. 读两份勘查报告（结论全部带实验/文档/代码标注，可直接引用）
2. 过 brainstorming 逐项设计（扩展架构 → 权限/审批 → 工具层）→ 设计文档落盘
3. ~~商店上架流程并行启动~~（2026-09-05 修正：自用阶段不需要，延后到对外分发需求出现）
4. staged-impl 写实施计划（扩展仓库 / installer.nsh / bridge 分流 / gateway 服务 / 工具层 / 审批卡，预计 ≥5 步）
