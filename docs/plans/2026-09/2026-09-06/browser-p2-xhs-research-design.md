# 浏览器三期 P2：小红书调研工作流 设计

**日期**：2026-09-06
**上游**：P1 扩展命令通道（../2026-09-05/browser-extension-p1/plan.md，已完成）；三期路线图（../2026-09-04/browser-phase3-kickoff.md）
**调研输入**：同目录 browser-agent-mature-solutions.md / xhs-risk-control-survey.md（含全部信源链接）+ Proma 源码调研（用户笔记）

## 背景

- P1 已交付扩展双向命令通道（observe/click/fill/read_text + 域名授权），真机验证基础可用，但存在「一导航就断线」「agent 偏向受控浏览器」等已知限制
- 用户核心场景：带着目标（如「国庆自驾千岛湖，带娃」）与 agent 对话，agent 在小红书站内搜索、筛选、阅读笔记，综合用户偏好产出可执行建议，依据贴笔记 URL（不做入库）
- **风控规避是第一优先级**：宁慢勿 ban；绝不做验证码/风控绕过（验证码出现即停、交还用户）
- 三方调研交叉验证（成熟方案对比 + 小红书风控实证 + Proma 源码）：
  - 「扩展 + 真实浏览器 + 只读 + 拟人节奏」处于风控暴露光谱最保守端，**无更优替代架构**
  - Chrome 136 起封死 CDP attach 默认 profile，CDP 路线结构性受损，扩展路线免疫（无调试端口/无自动化横幅/指纹面为零）
  - 小红书协议逆向路线持续瘫痪（MediaCrawler #757：461/406 反复），UI 驱动不受签名升级影响
  - 惩罚是设备级 + 手机号级连坐（V2EX 控制变量实证）
  - 合成点击 isTrusted=false 可被页面检测 → 导航类操作优先真实导航
  - 风控分层（严→松）：写操作 > 自动化环境特征 > 协议签名 > 频次阈值 > IP 质量 > 行为模式——本方案天然规避前两层

## 目标

1. **调研流程全自动**：agent 在已授权域名的工作区 tab 上自主导航（含 SPA 路由变化），无需用户中途恢复连接
2. **反风控约束进工具层**（不依赖 agent 自觉）：随机延迟、单次会话预算、风控信号即停
3. 主会话对话入口 + 子会话执行的上下文隔离架构
4. 依据留痕：结论附笔记 URL

## 架构

### 交互形态（已拍板）

主会话对话整理调研任务 → 派「浏览器解析」Profile 子会话（extension 能力）执行搜索/筛选/阅读 → 交付结构化结果（结论 + 依据链接）→ 主会话结合用户偏好合成建议。调研中间产物（快照、重试、翻页）隔离在子会话上下文。

### 双链路分工（站点能力矩阵）

- 泛用搜索/公开网页 → **受控浏览器**（不打扰用户浏览器、不稀释授权面、分流动作预算；profile 持久登录一次即可）
- 登录态站点（小红书）→ **扩展通道**
- 站点能力矩阵 per-domain 配置，小红书是第一份：`logged_in_read: extension / search: 低频 / submit: 禁止 / 预算与延迟参数`
- 浏览器解析 Profile 描述更新，引导 agent「需登录态站点优先扩展工具」（消化 P1 P2输入#6 双链路引导问题）

### 扩展连接模型升级：从「连接页面」到「工作区 tab」

- agent 可将已连接 tab **导航至任意已授权域名**（真实导航 location.href，如小红书 URL 直达搜索 `xiaohongshu.com/search_result?keyword=xxx`）
- **导航授权语义**：导航命令目标域名未授权则拒绝（navigation_blocked）；操作命令校验当前页域名已授权
- tab 关闭/浏览器重启 → not_connected，agent 明确提示「请点扩展连接任一标签页」（一次性 10 秒动作）
- 排除：agent 自动开专属 tab（多 tab 管理是 P1 排除项，验证流程后再评估）

### 导航稳定性三层（解决 P1「一导航就断线」，本次硬前提）

1. **扩展侧 URL 自动跟踪**：连接期间监听 tab URL 变化（tabs.onUpdated + SPA pushState）→ 自动重采集快照推送 gateway（节流）+ **ref 代际重置**（旧 ref 全失效，强制重观察；Proma generation 机制借鉴）
2. **observe_page 兜底重同步**：导航后 observe 必须可用（P1 现状被拦）
3. **命令前校验自愈**：命令携带 URL 与当前不一致时回推最新状态 + 新快照让 agent 重新决策，不直接报错断线

### 节奏预算（已拍板：单次会话级，无日级锁）

1. **延迟随机化做在主进程工具层**：extension-tools 每命令发出前注入随机等待，参数从站点配置读（可配置、可审计、改节奏不动扩展）
2. **单次会话预算**：≤15 篇笔记 + ≤5 组关键词（对齐 MediaCrawler 官方默认）；超限返回结构化 `budget_exceeded` + 原因，agent 报告后用户可优化参数继续（会话内存计数，不持久化）
3. **风控信号即停**：observe/read_text 返回内容匹配风控特征（滑块/验证码/「访问频次异常」/「检测到AI操作」文案）→ `risk_signal_detected` 即停 + 告知原因；是否继续由用户决定（不做当日硬熔断，冷却参数留作后续可调项）
4. 两份调研的间隔建议不一致（2-5s vs ≥15s）→ **保守取长**，真机校准

### 反风控硬约束清单（红线）

- 绝不自动破解验证码/滑块；绝不碰 XHR/协议签名逆向；不挂代理 VPN（家庭宽带直连）
- 导航优先真实导航（location.href），合成点击只留站内交互且控频
- 不用 chrome.debugger（横幅 + CDP 痕迹，负收益）
- AGPL 红线：只借鉴 Proma 设计思想，**零代码复制**

## 模块边界

| 模块 | 改动 |
|---|---|
| `extension/src/background.js` + `dom-actions.js` | URL 变化监听（onUpdated + pushState 检测）、快照自动重采（节流）、导航命令（真实导航）、ref 代际 |
| `extension/src/nm-protocol.js` + `electron/main/services/browser/nm-protocol.ts` | 帧协议扩展：navigate 命令 kind、快照主动推送帧、代际字段——**两份实现同步改，语义一致** |
| `electron/main/services/browser/browser-gateway.ts` | navigate 命令路由、目标域名授权校验、URL 状态汇聚 |
| `electron/main/agents/tools/extension-tools.ts` | 随机延迟注入（读站点配置）、预算计数、风控信号内容检测、结构化 budget/risk 返回、双链路引导文案 |
| 站点配置（落点实施时定：settings 双份类型 vs 独立 JSON） | xiaohongshu.com：允许动作/预算/延迟/风控关键词 |
| `electron/main/services/browser/browser-action-stream.ts` | 账本加字段：sessionId/tabId/urlBefore/urlAfter/errorCode/durationMs（预算计数与事后分析基础） |
| SubAgent Profile 描述 | 浏览器解析描述更新（登录态站点优先扩展） |
| 主会话提示词（可选，实施时看成本） | 轻量注入扩展连接状态，主会话能自然发起派遣与提示连接 |

## 数据流

用户（主会话）→ 派遣（浏览器解析 Profile）→ 子会话工具调用（observe / read_text / navigate）→ 工具层（随机延迟 → 预算检查 → 风控前置检测）→ gateway（域名授权校验）→ NM → 扩展 SW（命令执行 / URL 跟踪）→ 页面 → 结果回传 → 动作账本 → 子会话汇总（结论 + 链接）→ 主会话合成建议

## 错误处理 / 边界情况

- P1 的 12 个 errorCode 全集沿用；新增：`budget_exceeded`（结构化返回原因）、`risk_signal_detected`（即停 + 附检测信号）、`navigation_blocked`（目标域名未授权）
- 用户与 agent 同 tab 冲突：轻量处理——现有 guard（ref_expired/value_mismatch）+ 动作流可见性兜底，**不做用户操作检测互斥**（误判率高，过度工程）；实际打架场景出现再升级
- SPA「URL 不变的页面变化」（弹层）URL 跟踪覆盖不了 → observe_page 兜底 + 真机验证小红书弹层行为
- 断线重连：不做 alarms 自动重连（P3 评估），接受「断线 → 提示用户点一下扩展」的轻摩擦；会话进行中 NM port 常开、SW 存活，中断概率低

## 未决问题

- 站点配置存储落点（settings 双份类型 vs gateway 侧独立 JSON）——实施 step 定
- 风控信号关键词初版清单——真机校准
- 调研待验证 8 项（搜索频次阈值、日总量上限、「检测到AI操作」归因、账号基线等，见 xhs-risk-control-survey.md）——首次真机跑通后校准默认参数
- 主会话状态注入的形态与成本

## 明确排除（记档）

首次风险告知弹窗（用户拍板先不做）、日级配额/当日硬熔断、agent 自动开 tab、alarms 自动重连、多 tab 多会话绑定、AX Tree 观察、workspace profile 隔离、BrowserAdapter 抽象（以上后五项为 P3 范围）
