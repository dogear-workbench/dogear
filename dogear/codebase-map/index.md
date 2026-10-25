# Dogear 代码地图

> 按功能域索引核心文件。检索：功能词 → 下表命中文件 → 读该文件拿具体路径 → Glob/Read 源码；未命中直接 Glob/Grep（地图不穷举，可能滞后）。维护：代码变更后按本表路由到对应功能文件精准编辑（doc-sync）。

| 文件 | 范围 | 聊天词 |
|---|---|---|
| [chat.md](chat.md) | 聊天界面全链：主工作区/会话窗口/伴随工作台、会话列表与组、消息渲染、输入区、minimap、伴随面板（文件树/终端/话题 tab）、会话数据层 | 聊天、消息、会话、对话、列表、输入框、气泡、终端、话题面板、共享区、飞书、骨架屏、历史加载、文件树 |
| [agent-core.md](agent-core.md) | Agent 运行时：pi-session、工具注册、skill 加载、能力包注册表、权限、子会话派遣、协作任务后端、failover | agent、工具、skill、子会话、派遣、任务队列、权限、压缩、模型切换、failover |
| [browser.md](browser.md) | 浏览器扩展通道、site-knowledge、纯 HTTP 联网搜索 | 浏览器、扩展、小红书、等待人工、联网搜索、search、readArticle、授权域名、页面移交 |
| [articles.md](articles.md) | 文章解析与预览、笔记卡片、协作任务面板 UI | 文章、阅读、笔记、卡片、任务面板、回收站、引用文章 |
| [stocks.md](stocks.md) | 股票服务层与 agent 工具、Python 计算层、指标/选股/公式/回测、公告 | 股票、自选、行情、K线、分时、指标、选股、回测、公式、公告 |
| [settings.md](settings.md) | 设置页、能力/场景页、模型方案、子会话 Profile、工作区管理、模型选择链路 | 设置、能力包、场景、模型、Profile、工作区管理、工作区规则、agent.md、站点配置 |
| [data-center.md](data-center.md) | 数据中心六面板（用量/定时/执行历史/记忆/版本与备份/设备同步，同步页含数据字典明细）、主题记忆（工作区/全局两级）、应用数据字典（data-items）与备份（data-registry/快照还原）、局域网设备同步（实路径同步/虚拟路径/退役防线/墓碑/删改冲突） | 数据中心、用量、定时计划、执行历史、记忆、版本与备份、备份、恢复、快照还原、data-registry、数据字典、git 状态、设备同步、局域网、配对、同步、墓碑、删改冲突、虚拟路径、同步范围 |
| [infra.md](infra.md) | 入口路由、IPC 总览、lib、类型、.dogear 存储、测试基建、横切 UI 基建（兜底） | 入口、路由、IPC、tipc、类型、存储、.dogear、测试、通知中心、标题栏、确认弹窗 |
