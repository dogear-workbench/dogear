# Dogear 代码地图

> 按功能域索引核心文件。检索：功能词 → 下表命中文件 → 读该文件拿具体路径 → Glob/Read 源码；未命中直接 Glob/Grep（地图不穷举，可能滞后）。维护：代码变更后按本表路由到对应功能文件精准编辑（doc-sync）。

| 文件 | 范围 | 聊天词 |
|---|---|---|
| [chat.md](chat.md) | 聊天界面全链：主工作区/会话窗口/伴随工作台、会话列表与组、消息渲染、输入区、minimap、伴随面板（文件树/终端/话题 tab）、会话数据层 | 聊天、消息、会话、对话、列表、输入框、气泡、终端、话题面板、共享区、微信 |
| [agent-core.md](agent-core.md) | Agent 运行时：pi-session、工具注册、skill 加载、能力包注册表、权限、子会话派遣、协作任务后端、failover | agent、工具、skill、子会话、派遣、任务队列、权限、压缩、模型切换 |
| [browser.md](browser.md) | 内嵌浏览器 + 浏览器扩展双通道、site-knowledge、联网搜索快档 | 浏览器、扩展、小红书、页面视图、等待人工、联网搜索、search、readArticle、授权域名 |
| [articles.md](articles.md) | 文章解析与预览、笔记卡片、协作任务面板 UI | 文章、阅读、笔记、卡片、任务面板、回收站、引用文章 |
| [stocks.md](stocks.md) | 自选股行情页、Python 计算层、指标/选股/公式/回测、公告 | 股票、自选、行情、K线、分时、指标、选股、回测、公式、公告 |
| [settings.md](settings.md) | 设置页、能力包 UI、模型方案、子会话 Profile、工作区管理、模型选择链路 | 设置、能力包、模型、Profile、工作区管理、工作区规则、agent.md |
| [data-center.md](data-center.md) | 数据中心五面板（用量/定时/执行历史/解析历史/记忆）、话题状态卡、主题记忆 | 数据中心、用量、定时计划、执行历史、解析历史、记忆、话题状态卡 |
| [infra.md](infra.md) | 入口路由、IPC 总览、lib、类型、.dogear 存储、测试基建、横切 UI 基建（兜底） | 入口、路由、IPC、tipc、类型、存储、.dogear、测试、通知中心、标题栏 |
