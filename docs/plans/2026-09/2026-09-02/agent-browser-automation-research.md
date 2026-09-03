# Agent 操作、浏览器接入与自动化研究方向

**日期**：2026-09-02  
**状态**：研究方向整理，尚未进入实现决策  
**关联设计**：[伴随工作台与执行可视化设计](../2026-09-01/companion-workbench-design.md)

## 1. 研究目标

Dogear 已经具备 Agent 会话、工具调用、权限确认、后台任务和伴随工作台等基础能力。下一阶段可以研究让 Agent 观察并操作用户正在使用的外部软件，优先从浏览器开始，再逐步扩展到桌面应用和跨应用工作流。

这里的目标不是单纯实现“模型可以点击网页”，而是研究一套可控的执行能力：

- Agent 能理解当前页面和用户意图
- 执行器能稳定完成点击、输入、跳转、上传和下载
- 用户可以看到 Agent 正在做什么
- 高风险动作可以暂停并要求批准
- 遇到验证码、二次验证或异常页面时可以人工接管
- 任务可以记录、回放、重试和从中间状态恢复
- 本地登录状态和敏感数据尽量留在用户设备上

## 2. 总体方向地图

研究范围暂时分为四个方向。它们相关，但不应该在实现上混成一个“万能电脑控制工具”。

| 方向 | 解决的问题 | 当前优先级 | 典型技术 |
| --- | --- | --- | --- |
| 浏览器自动化 | 访问网页、读取页面、填写表单、下载资料 | 最高 | Playwright、CDP、浏览器扩展、Browser Use、Stagehand、Skyvern |
| 桌面电脑操作 | 操作浏览器以外的窗口、老旧软件和系统对话框 | 后续 | Windows UI Automation、视觉 Agent、鼠标键盘控制、RPA |
| 工作流编排 | 把网页操作与邮件、文件、数据库、通知串成长期任务 | 与浏览器并行研究 | n8n、Temporal、LangGraph、Make、Zapier |
| 浏览器与执行基础设施 | 隔离浏览器、远程运行、会话管理、录像、并发和审计 | 浏览器产品化时必须考虑 | 本地 Chrome、Docker、Browserbase、Steel、Browserless |

当前建议的重点顺序：

```text
浏览器操作模型
    -> 外部浏览器接入
    -> 扩展 + 本地 Companion
    -> 操作可视化与人工接管
    -> 权限、审计、恢复
    -> 云端隔离浏览器
    -> 桌面操作与复杂工作流
```

## 3. 浏览器自动化的两条基本路线

### 3.1 自带浏览器

Dogear 或云端服务自己启动一个新的 Chromium 浏览器实例，由 Playwright、Browser Use 或其他 Agent 框架控制。

```text
Dogear Agent
    -> 浏览器执行器
    -> Playwright / CDP
    -> 独立 Chromium 实例
```

**优势**：

- 环境可控，容易复现和测试
- 可以为每个任务创建隔离会话
- 不影响用户正在工作的浏览器
- 适合定时任务、批量任务和公开网页查询
- 容易保存截图、网络日志和完整运行轨迹

**限制**：

- 默认没有用户当前浏览器的登录状态
- 用户需要重新登录，或者使用专用账号
- 复杂登录、短信验证和本机证书会增加接入成本
- 云端执行时需要认真处理 Cookie、文件和隐私数据

这条路线适合 Dogear 的云端或后台任务，但不适合作为“操作用户当前浏览器”的唯一方案。

### 3.2 连接已有浏览器

Dogear 不新开浏览器，而是连接用户已经打开的 Chrome、Edge 或其他 Chromium 浏览器。

```text
Dogear Agent
    -> Playwright / Browser Use
    -> CDP 或本地连接器
    -> 用户已有浏览器
```

它可以复用当前浏览器里的：

- 已打开标签页
- Cookie 和登录状态
- 扩展
- 当前页面上下文
- 用户已经填写但尚未提交的内容

但它必须依赖用户主动授权。普通网页本身不能绕过浏览器安全模型，直接读取或控制用户其他标签页。

## 4. 外部浏览器接入方式

### 4.1 CDP 接入

Chrome DevTools Protocol 是 Chromium 暴露的调试和控制协议。Playwright、Puppeteer、Browser Use 等都可以通过 CDP 连接已经运行的浏览器。

```ts
const browser = await chromium.connectOverCDP(
  "http://127.0.0.1:9222"
);
```

连接后可以操作页面、读取 DOM、获取截图、监听跳转和下载等。

**适合**：

- 早期技术验证
- 开发者工具
- 本机 Agent
- 受控的专用 Chrome 配置文件
- Dogear 自己启动并管理的浏览器

**主要问题**：

- 需要用户启动带远程调试能力的浏览器，或由 Companion 启动
- 调试权限很高，连接泄露会带来整个浏览器会话的风险
- Agent 与用户同时操作同一标签页时容易争抢焦点
- 不应该把 CDP 端口暴露在公网
- Chrome 对默认用户数据目录的远程调试限制越来越严格
- 多个 Agent 或多个客户端连接同一个浏览器时需要协调

**判断**：CDP 是最快的底层验证方式，但不应直接作为面向普通用户的最终授权模型。

### 4.2 浏览器扩展接入

Chrome 扩展运行在浏览器内部，可以在用户授权后访问当前标签页或指定域名。扩展负责页面侧能力，Dogear Agent 负责理解、计划和决策。

```text
Dogear Agent
    <-> Dogear Companion
    <-> Dogear Chrome Extension
    <-> 当前被授权的标签页
```

扩展可以提供：

- 当前标签页识别
- DOM 和可访问性信息读取
- 页面截图
- 点击、输入、滚动和选择
- 页面跳转和加载状态监听
- 文件上传和下载状态监听
- 当前标签页授权和撤销
- 页面内执行范围限制

**优势**：

- 不需要把整个浏览器的调试权限暴露出来
- 可以按标签页、按域名、按用户操作进行授权
- 用户可以通过扩展图标明确连接或断开
- 更容易展示“Agent 当前正在操作这个页面”
- 适合复用用户已经登录的真实浏览器

**限制**：

- 需要安装扩展
- 扩展权限和商店发布流程需要单独处理
- 某些浏览器内置页、跨域 iframe 和受保护页面存在限制
- 扩展无法直接解决所有系统级文件对话框问题
- 页面操作和本地操作仍需要一个本地通信层衔接

### 4.3 扩展 + 本地 Companion

这是 Dogear 面向普通用户最值得重点研究的模式。

```text
┌─────────────────────────────┐
│ Dogear 主程序 / Agent        │
│ 任务、计划、审批、审计、模型 │
└──────────────┬──────────────┘
               │ WebSocket / IPC
┌──────────────▼──────────────┐
│ Dogear Local Companion       │
│ 配对、权限、连接、文件桥接   │
└──────────────┬──────────────┘
               │ Native Messaging
┌──────────────▼──────────────┐
│ Dogear Chrome Extension      │
│ 当前标签页观察与页面动作     │
└──────────────┬──────────────┘
               ▼
          用户授权页面
```

各层职责应该清楚分开：

| 层 | 主要职责 | 不应该负责 |
| --- | --- | --- |
| Agent | 理解任务、规划步骤、选择工具、判断是否需要审批 | 直接持有浏览器调试端口 |
| Companion | 本地配对、连接管理、权限边界、文件桥接、状态转发 | 替 Agent 做页面语义决策 |
| Extension | 当前页面观察、页面动作、标签页授权、页面事件 | 保存云端长期密钥或执行任意本地命令 |
| 浏览器 | 实际渲染、登录态、Cookie、页面脚本和下载 | 判断 Agent 是否有业务权限 |

Chrome 官方提供 Native Messaging，让扩展可以和本地注册程序通过标准输入输出通信。Dogear 可以让 Companion 作为本机可信边界，避免把本地浏览器的高权限接口直接交给远端服务。

## 5. 推荐的统一执行模型

上层 Agent 不应该关心浏览器是在本地、远程、扩展还是 CDP 中运行。建议抽象出统一的 Browser Adapter：

```text
BrowserAdapter
├── EmbeddedBrowserAdapter   // Dogear 自己启动的浏览器
├── CdpBrowserAdapter        // 连接受控的 Chromium
└── ExtensionBrowserAdapter   // 通过 Companion + 扩展操作用户浏览器
```

统一能力可以先控制在以下范围：

```text
observe_page()
get_tabs()
select_tab(tab_id)
navigate(url)
click(target)
fill(target, value)
select(target, option)
press(key)
scroll(direction, amount)
upload(file)
download()
screenshot()
wait_for(condition)
request_user_approval(summary)
request_user_takeover(reason)
```

目标定位建议采用分层策略：

1. 优先使用可访问性树和语义定位
2. 其次使用 DOM 属性和稳定的文本定位
3. 页面结构不明确时使用模型理解页面
4. 只有结构化方式失败时才使用截图和坐标操作
5. 坐标操作完成后必须重新观察页面并验证结果

模型负责“现在应该做什么”，执行器负责“动作是否真的完成”。每个动作都应有结果验证，不能把调用成功等同于业务成功。

## 6. Agent 操作的运行状态

浏览器任务应当被建模为可恢复的执行状态，而不是一次不可见的连续点击。

```text
created
  -> observing
  -> planning
  -> waiting_for_approval
  -> executing
  -> verifying
  -> paused_for_user
  -> completed / failed / cancelled
```

每一步至少记录：

- 任务 ID 和会话 ID
- 浏览器连接类型
- 标签页 ID、URL 和域名
- Agent 的动作意图
- 实际执行的工具和参数摘要
- 执行前后的截图或页面摘要
- 验证条件与结果
- 是否触发审批或人工接管
- 错误分类和可重试性

这与 Dogear 当前伴随工作台的思路一致。浏览器面板可以作为“一会话一条操作流”，显示当前页面、Agent 动作、用户接管点和最后一次验证结果。

## 7. 权限与安全边界

### 7.1 授权范围

默认只允许 Agent 操作：

- 用户主动连接的标签页
- 用户允许的域名
- 当前任务声明所需的页面
- 当前有效的 Companion 配对会话

以下情况自动暂停：

- 跳转到未授权域名
- 新标签页打开敏感站点
- 页面要求登录、验证码或二次验证
- 发现付款、发送、发布、删除或提交按钮
- 任务意图与实际页面不一致
- 页面出现无法解释的弹窗或权限请求

### 7.2 必须审批的动作

至少包括：

- 发送邮件、消息、评论或表单
- 付款、转账、下单
- 提交政府、医疗、金融或法律表单
- 发布内容
- 删除或覆盖文件
- 修改账号安全设置
- 接受合同、条款或授权
- 批量修改记录

审批卡应该展示最终业务内容，而不是只显示“允许点击按钮”：

```text
即将提交
域名：example.com
操作：提交订单
收件人：...
金额：...
内容：...
附件：...
```

### 7.3 数据边界

需要重点研究：

- Cookie、密码和 token 默认不离开用户浏览器
- 页面内容发送给模型前要支持脱敏或域名策略
- Companion 与 Agent 之间使用短期配对凭证
- 本地服务只监听 `127.0.0.1`
- 不把 CDP 端口暴露到公网
- 扩展和 Companion 都要校验消息来源和任务授权
- 日志不能默认保存密码、完整 Cookie 或敏感表单值
- 用户可以查看、撤销和清理浏览器授权

## 8. 桌面操作方向

桌面操作保留为后续方向，不作为浏览器第一阶段的隐含扩展。

### 8.1 Windows UI Automation

通过 Windows 的可访问性和 UI Automation 接口读取窗口、按钮、文本框和控件。

**优点**：结构化、可验证、比坐标点击稳定。  
**问题**：不同软件暴露的控件质量差异很大，老软件、远程桌面和自绘界面可能无法读取。

### 8.2 视觉 Computer Use

Agent 读取截图后决定鼠标、键盘、拖拽和窗口操作。

**优点**：适应范围广，可以操作无法提供结构化接口的界面。  
**问题**：误点风险高，受分辨率、窗口位置、弹窗、缩放和延迟影响，必须配合沙箱、动作确认和结果验证。

### 8.3 RPA

UiPath、Power Automate、Automation Anywhere、Robocorp 等传统 RPA 更适合固定业务流程。它们的流程录制、凭证管理、重试、审计和企业集成值得参考，但 Dogear 不需要在早期复制完整 RPA 平台。

后续如果要支持桌面操作，建议仍然沿用同一套上层模型：

```text
Agent 决策
    -> Desktop Adapter
    -> UI Automation / 键鼠 / 视觉执行
    -> 截图与控件状态验证
```

## 9. 工作流编排方向

复杂任务通常不是单一浏览器操作，而是：

```text
读取邮件
  -> 下载附件
  -> 打开网站
  -> 填写表单
  -> 等待用户确认
  -> 提交
  -> 保存结果
  -> 通知用户
```

浏览器 Agent 可以作为工作流中的一个节点。需要研究的能力包括：

- 任务触发和定时执行
- 长流程状态保存
- 分支、循环和条件判断
- 超时、重试和人工接管
- 失败后从某一步继续
- 任务之间的数据传递
- 运行记录和结果归档

Dogear 现有调度器、后台任务、运行历史和会话生命周期已经提供了部分基础。第一阶段可以先以数据库或 JSON 状态保存浏览器任务，不急于引入完整的外部工作流平台；当出现跨系统长流程和复杂重试需求时，再评估 Temporal 或 LangGraph 等方案。

## 10. 运行基础设施

### 10.1 本地浏览器

适合：

- 用户个人账号
- 本地登录状态
- 敏感数据
- 需要用户随时接管的任务
- 扩展 + Companion 模式

### 10.2 隔离浏览器

可以是本地 Docker，也可以是云端浏览器服务。适合：

- 公共网页查询
- 专用业务账号
- 定时任务
- 批量运行
- 需要统一截图、录像和并发管理的任务

### 10.3 云端浏览器服务

Browserbase、Steel、Browserless 等方案主要提供浏览器实例和会话基础设施。它们值得研究的是：

- 浏览器实例生命周期
- 会话隔离
- CDP 连接
- 文件上传下载
- 远程观察
- 录像和调试
- 代理、扩展和身份配置
- 并发与成本控制

Dogear 不需要一开始依赖云端服务。先把 Adapter 和任务状态设计好，后续可以替换执行环境。

## 11. 候选项目与借鉴重点

| 项目 | 定位 | 值得借鉴 | 需要注意 |
| --- | --- | --- | --- |
| Playwright | 确定性浏览器自动化 | Locator、自动等待、断言、Trace、CDP attach | 不负责 Agent 规划 |
| Browser Use | Python 浏览器 Agent | 页面理解、多步任务、自然语言执行、Cloud/Local 双模式 | 自由 Agent 行为仍需权限和验证 |
| Stagehand | TypeScript Agent SDK | `act`、`observe`、`extract`，与 Playwright 混用 | 需要自己设计任务状态和业务审批 |
| Skyvern | AI 浏览器工作流平台 | 表单任务、工作流、API、MCP、自托管 | 平台能力较重，需评估是否适合 Dogear 的产品边界 |
| Browserbase | 云端浏览器基础设施 | 会话、远程浏览器、评估和可观察性 | 重点是基础设施，不是完整产品交互 |
| Chrome Extensions | 浏览器内接入 | 标签页授权、页面内容和动作、Native Messaging | 扩展权限、发布和浏览器兼容性 |
| UiPath / Power Automate | 企业 RPA | 流程编排、审计、凭证、人工审批 | 对 Dogear 来说可能过重 |
| BrowserGym / OSWorld | Agent 评测环境 | 任务定义、成功标准、长流程评估 | 主要用于评测，不是生产执行器 |

## 12. 推荐研究阶段

### 阶段 A：浏览器能力验证

目标：确认 Dogear 的 Agent 是否能稳定完成低风险浏览器任务。

研究内容：

- Playwright 的页面观察和动作接口
- CDP 连接受控 Chrome
- DOM、可访问性树和截图的上下文成本
- 页面动作后的结果验证
- 标签页、下载和文件上传
- 失败重试和取消

建议任务：公开网页搜索、页面信息提取、低风险表单填写、下载文件。

### 阶段 B：扩展 + Companion 骨架

目标：让用户可以明确连接自己的当前标签页。

研究内容：

- Chrome 扩展权限模型
- 当前标签页授权
- Companion 与扩展的 Native Messaging
- Dogear 与 Companion 的配对协议
- 本地连接状态和断开机制
- 页面事件和动作协议
- 用户接管后恢复任务

这一阶段先做只读观察和低风险动作，不接付款、发送和发布。

### 阶段 C：伴随工作台浏览器面板

目标：让 Agent 的浏览器操作过程可见、可暂停和可接管。

研究内容：

- 页面预览或截图流
- 一会话一条浏览器操作流
- 当前动作、等待原因和验证结果
- 固定查看某个会话
- 扩展连接状态展示
- 审批卡和人工接管入口
- 任务完成后的证据摘要

与终端观察窗保持同一容器和数据模型，浏览器面板作为伴随工作台的后续面板加入。

### 阶段 D：安全和可靠性

目标：使浏览器操作能够在真实账号环境中受控使用。

研究内容：

- 域名和标签页授权
- 动作风险分级
- 敏感字段脱敏
- 发送前审批
- 页面状态快照
- 任务幂等和重复提交保护
- 运行审计和回放
- 连接失效、浏览器崩溃和用户抢占处理

### 阶段 E：云端和桌面扩展

目标：根据实际需求决定是否支持隔离云浏览器和全桌面操作。

研究内容：

- 本地与云端 Browser Adapter 的一致性
- Docker 或云端浏览器的隔离成本
- Windows UI Automation
- 视觉桌面 Agent
- 跨应用工作流
- 长时间运行和无人值守任务

## 13. 暂不做的事项

目前不把以下内容作为第一阶段目标：

- 无限制接管用户整个桌面
- 对所有网站承诺自动化成功
- 自动绕过 CAPTCHA、风控或二次验证
- 默认自动付款、下单、发消息或发布内容
- 把用户主浏览器的 CDP 端口暴露给云端
- 在没有审计和审批的情况下批量修改真实数据
- 一开始就建设完整的 RPA 流程设计器
- 一开始同时支持 Chrome、Firefox、Safari 和所有桌面应用

这些限制不是能力缺口的简单列表，而是为了先建立可观察、可恢复、可撤销的执行闭环。

## 14. 待研究问题

### 产品问题

- 用户是按“连接当前标签页”授权，还是按域名长期授权？
- Agent 操作时，用户是否可以继续手动操作同一标签页？
- 浏览器画面应该展示实时截图、页面镜像，还是动作流加关键截图？
- 任务暂停时由 Agent 主动请求接管，还是用户随时可以接管？
- 用户如何查看和撤销已经授予的浏览器权限？

### 技术问题

- 扩展如何提供足够的可访问性信息，同时控制上下文大小？
- 同一浏览器同时存在多个 Dogear 任务时如何互斥？
- 页面操作协议如何区分“动作已发送”和“业务结果已确认”？
- 文件上传、下载和系统文件对话框由扩展还是 Companion 处理？
- Chrome 扩展、CDP 和 Playwright 的能力如何统一？
- 浏览器关闭、标签页刷新、登录过期时如何恢复任务？
- 如何让浏览器操作日志与 Dogear 现有会话消息、任务运行历史关联？

### 评测问题

- 成功标准是页面状态、下载结果还是最终业务结果？
- 如何构造一组固定的本地测试网站，覆盖表单、弹窗、分页、登录和失败恢复？
- 如何统计 Agent 的成功率、平均步骤数、人工接管率和重复提交率？
- 如何验证模型换代或页面改版没有降低可靠性？
- 是否需要参考 BrowserGym、WebVoyager 或 OSWorld 的任务定义方式？

## 15. 初步结论

Dogear 的浏览器方向可以保留两种执行环境：

```text
本地真实浏览器：扩展 + Companion，复用用户登录态，用户可见可接管
隔离浏览器：Playwright / CDP，适合公开查询、定时任务和批量流程
```

其中，**扩展 + Companion 是面向用户的重点路线**；**Playwright + CDP 是底层执行和早期验证路线**；**Browser Use、Stagehand、Skyvern 是 Agent 层和工作流设计的主要参考对象**。

推荐的工程边界是：

```text
Agent 负责理解和决策
Browser Adapter 负责统一能力
Companion 负责本地连接和权限边界
Extension 负责浏览器页面动作
主进程负责状态、审计、审批和恢复
伴随工作台负责可视化、暂停和人工接管
```

先完成浏览器操作的可观察闭环，再决定是否扩展到桌面控制、云端浏览器和长期无人值守工作流。

## 16. 参考资料

以下链接用于继续研究，具体 API 和浏览器行为以对应项目当前文档为准：

- [Playwright](https://playwright.dev/)
- [Playwright: Connecting to browsers](https://playwright.dev/mcp/configuration/browser-extension)
- [Chrome DevTools Protocol](https://developer.chrome.com/devtools/docs/debugger-protocol)
- [Chrome remote debugging changes](https://developer.chrome.com/blog/remote-debugging-port)
- [Chrome Native Messaging](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging)
- [Browser Use](https://github.com/browser-use/browser-use)
- [Browser Use Cloud Docs](https://docs.browser-use.com/cloud/quickstart)
- [Stagehand](https://docs.stagehand.dev/)
- [Skyvern](https://www.skyvern.com/docs)
- [Browserbase Computer Use](https://www.browserbase.com/computer-use)
- [BrowserGym](https://github.com/ServiceNow/browsergym)
- [OSWorld](https://github.com/xlang-ai/OSWorld)
