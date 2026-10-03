# 浏览器能力补齐批次（P1 残余 + 策略模板 + 视觉入口）设计

**日期**：2026-10-03
**背景**：扩展通道 P0/P1/P1.5 全部实施并真机验证通过（P1.5 验证 14/15）后路线盘点，用户拍板本批次范围：chrome.debugger 大件不做、P2 差异化暂缓，做 P1 残余 + 策略模板 + 视觉两入口。

**目标**：减少 agent 返工（策略模板 + click 误报修复）、防风控（tab 预算）、安全补课（prompt injection 统一）、工具补尾（wait_for/readArticle）、视觉能力可用（截图识图 + 图片上传）。

## 各项架构

### 1. 策略模板（零开发，内容工程）

- **形态**：自定义 skill，存 config 目录 `skills/`（skill-loader 三目录机制原生支持）
- **触发**：skill 索引自动进会话系统提示，任务匹配 description 自动触发；显式点名必命中
- **写法**：要点式——控制流要点（外层循环/内层预算/异常分支/终止条件），不写死操作序列。结构知识留在站点档案（site_knowledge），模板只管流程打法
- **迭代漏斗**（活文档设计）：
  - 高频现场层：agent 遇到与模板/档案不符（网站改版）→ 现有 `site_finding` 工具追加站点档案，即时生效
  - 低频转正层：稳定有效的发现 → 主会话/用户审核后合入模板正文或档案「正式地图」
  - agent 不直改模板本体：模板是所有后续会话的行为源头，防污染（与 browser-playbook 人工审核同理）
- **首个模板**：`xiaohongshu-research`——从小红书 P2 实施提示词 + 两层站点档案（数据路径/直链拼法/形态漂移坑）提炼。流程骨架示例：
  ```
  外层循环：关键词迭代（宽→窄→同义改写），直至信息饱和或轮次上限
    ├─ 搜索 → 读 SERP：标题足够佐证直接记，不点开
    ├─ 内层预算自适应：命中多精选 3~5 条进详情；命中少放宽 8~10 条
    ├─ 详情提取：走站点档案数据路径（read_state 直取）
    └─ 异常分支：登录墙/反爬 → playbook 降级；路径失效 → site_finding 沉淀
  终止：覆盖度够 / 关键词穷尽 / 预算耗尽
  ```

### 2. 视觉两入口

**模型现状**：主会话 `glm-5.3` 无视觉；子会话统一 `GLM-5.3-Flash` 有视觉。

**实测结果（2026-10-03，子会话 01a10183）**：链路**断**——navigate/screenshot 正常（PNG 落盘 `.dogear/tmp/`），但 read 读 PNG 静默返回空，图片未进入模型上下文。
**根因**：`workspace-file-tools.ts` 的 read 用 `fs.readFile(utf-8)` 硬解码二进制，无图片分支；而 pi-ai 工具结果原生支持 `ImageContent`（底层管线现成）、screenshot 描述也声称 read 支持图片——纯实现缺失，描述与实现不符。用户消息侧的图片注入（tipc/agent.ts:233 + splitContentBlocks）反而已遍。
**修复项**：read 按扩展名（png/jpg/gif/webp/bmp）检测 → 读 base64 → 返回 ImageContent；read 与 screenshot 两处描述对齐；用存量 HN 截图复测 Flash 识图质量。

**(a) 扩展通道截图**：manifest 加所需权限（`tabs` 已有，`captureVisibleTab` 走 activeTab/tabs 权限），background 加 capture 命令，主进程加 `extension__screenshot` 工具。截图存工作区 `.dogear/tmp/`（与内嵌通道同路径约定，read 可读）。

**(b) 用户上传图片**：会话输入框加图片附件。**路由设计（因主会话无视觉）**：主会话收到图片时不自行处理，自动转派有视觉的子会话（或提示用户手动派发）；子会话直接看图。具体 UI/交互形态实施时定。

### 3. tab 预算与节奏控制（扩展通道）

复用 site-policy 既有会话预算机制，接入扩展通道：open_tab 数量上限、click/fill 操作节奏（最小间隔）。超预算返回明确错误（agent 可感知并收敛）。防后台窗口膨胀 + 防网站风控。

### 4. prompt injection 双侧风控统一

内嵌/扩展两通道读页面内容的工具（read_text/observe_page/read_state）过同一道扫描：检测页面文本中的指令注入模式（「忽略之前的指令」类），统一警告/脱敏策略。扫描逻辑抽公共层，双侧引用。

### 5. 扩展工具补尾：wait_for / readArticle

- `wait_for`：协议 v4 加命令，扩展侧轮询 DOM 条件（元素出现/消失/文本包含），一次调用挂到条件满足，替代 agent 反复 observe_page 轮询
- `readArticle`：扩展侧用 Readability（content-extract.js 已有 turndown 链路可复用）抽正文，产出干净 markdown，对齐内嵌通道

### 6. click 误报核查（排查项）

hvszlply 议题 + P1.5 验证 A4 新证据：click 报「页面已变化/元素不在」（ref_expired / url 离开误报）但页面实际未导航。排查 dom-actions.js click 的校验逻辑（urlBefore 对比、DOM 查询时机）与用户手动操作/确认卡出现的竞态窗口。产出：根因 + 修复或边界说明。

## 已确认无需开发（结论记录）

- **定时任务×浏览器**：定时计划 custom agent 按工作区能力包已可挂 browser 工具包（`custom-agent-tools.ts:65`），navigate/observe/wait_for/screenshot 全套可用——「每天定时打开站点抓数据」现在就能建计划
- **chrome.debugger 能力路由**：用户拍板不做，等真被 isTrusted 卡住再议
- **P2（定时接浏览器/工作流录制/多 tab 汇总）**：暂缓

## 错误处理 / 边界

- 扩展截图：扩展断连/窗口关闭时返回明确错误；非蓝组 tab 截图是否允许（倾向允许，agent 焦点页可截）
- 上传图片：非图片文件拒绝；超大小限制提示
- tab 预算：预算配置入口（站点策略现有 UI 扩展 vs 全局默认）实施时定
- wait_for：超时上限（防永久挂起，对齐内嵌通道 wait_for 既有超时语义）

## 未决问题（实施时补）

- 上传图片的具体 UI 形态（拖拽/粘贴/按钮）与主会话转派子会话的交互呈现
- readArticle 是否走站点档案缓存
- prompt injection 扫描的规则集初版从哪来（内嵌侧现状盘点后定）
- 视觉实测结果对两入口优先级的影响

## 验证要点

- 视觉：Flash 从截图读出只能来自像素的内容（标题/颜色/logo）
- 模板：新会话一句话「调研小红书上 X 的讨论」自动命中模板并按骨架执行
- 预算：超 tab 上限时 open_tab 返回预算错误；节奏限制可观测（审计日志）
- 注入统一：构造含注入指令的页面文本，双侧工具均告警
