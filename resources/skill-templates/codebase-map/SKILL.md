---
name: codebase-map
description: 当你不清楚某个文件/模块在哪、要做什么时主动调用。Read `dogear/codebase-map/index.md`，按功能词路由到分域地图（chat/agent-core/browser/articles/stocks/settings/data-center/infra），再读对应功能文件拿具体路径与注意事项。简单定位直接用 Glob/Grep。
---

# 代码地图

项目文件功能索引按功能域拆分维护在 `dogear/codebase-map/`，检索动线：

1. Read `dogear/codebase-map/index.md`，按聊天词命中功能文件
2. Read 对应功能文件，拿到具体路径、注意与数据流
3. 未命中则 fallback 直接 Glob/Grep——地图不是穷举

索引可能滞后于实际代码，简单的定位/改动建议直接用 Glob/Grep 探索当前代码状态。
