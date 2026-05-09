# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# Dogear 项目指南

> AI 驱动的电子书阅读器，支持 EPUB / PDF / TXT

## 基本规则

- 使用**中文**回答
- 必要的地方添加注释
- 添加新功能或修改功能时，要分析清楚原来的架构上的其他功能，不能因为修改了这个功能导致其他功能出现问题，要全方位的考虑
- 需要有95%以上的把握，才能进行修改，有什么问题请及时询问

---

## 常用开发命令

```bash
# 启动开发（编译 Electron + 并行启动 Vite + Electron）
bun run dev

# 仅前端开发（localhost:3000）
bun run dev:renderer

# 编译主进程（TypeScript → JavaScript）
bun run build:electron

# 完整构建（Vite 前端 + Electron 主进程）
bun run build

# 打包分发
bun run dist

# 代码检查
bun run lint
```

> 包管理器为 **Bun**，不使用 npm。主进程代码改动需 `build:electron` 重新编译，Vite 热重载只对前端生效。

---

## 技术栈

| 层级 | 技术 | 说明 |
|------|------|------|
| 桌面框架 | Electron | 主进程 + 渲染进程架构 |
| 前端构建 | Vite 7 | 开发服务器 + 构建（替代 Next.js） |
| 前端框架 | React 19 | 纯客户端 SPA |
| 路由 | React Router v7 | HashRouter（Electron file:// 兼容） |
| 包管理器 | Bun | 替代 npm，更快的安装和脚本执行 |
| UI 组件 | shadcn/ui + Radix UI | 组件在 `components/ui/` |
| 样式 | Tailwind CSS 4 + tw-animate-css | 使用 `cn()` 合并类名（`lib/utils.ts`） |
| 图标 | lucide-react | 统一使用此图标库 |
| 状态管理 | Zustand 5 | Store 在 `stores/` 目录 |
| IPC 通信 | @egoist/tipc | 类型安全的主进程↔渲染层通信 |
| AI Agent | @anthropic-ai/claude-agent-sdk | Agent 会话、工具、技能 |
| 数据存储 | JSON 文件 | `.dogear/` 目录下的 JSON 文件（settings/conversations/workspaces/书籍元数据/公式） |
| Markdown | react-markdown + remark-gfm + rehype-highlight | 渲染 AI 回复 |
| 电子书解析 | epub2 / pdf-parse | EPUB 和 PDF 文件处理 |
| 网页解析 | @mozilla/readability + turndown + linkedom | 网络文章提取并转 Markdown |
| **计算分析层** | **Python 3 + pandas + numpy + lark** | **AKShare 数据获取 + 技术指标计算 + 选股筛选 + 公式引擎 + 简单回测** |

---

## 项目结构概览

```
src/
  main.tsx              # Vite 入口，挂载 React
  App.tsx               # React Router 路由配置
  globals.css           # Tailwind CSS 4 全局样式
index.html              # Vite HTML 入口
vite.config.ts          # Vite 配置
app/                    # 页面组件（通过 React Router 而非文件系统路由）
components/             # React 组件
  ui/                   # shadcn/ui 基础组件
stores/                 # Zustand store
lib/                    # 前端工具
types/                  # 共享 TypeScript 类型定义
python/                 # Python 计算分析层（新增）
  main.py               # JSON-RPC 守护进程入口
  requirements.txt      # 依赖：akshare, pandas, numpy, lark
  core/                 # 核心计算模块
    indicators.py       # 技术指标计算（MA/EMA/MACD/RSI/KDJ 等）
    screener.py         # 股票筛选引擎
    financials.py       # AKShare 财务数据获取
    formula_engine.py   # 公式解析和执行引擎
    backtest.py         # 简单策略回测
    signals.py          # 技术信号检测（金叉/死叉/超卖 等）
  utils/                # 工具函数
    akshare_client.py   # AKShare 封装（限流+缓存）
    cache.py            # TTL 内存缓存
electron/
  main/
    index.ts            # Electron 入口，窗口管理
    agents/             # Agent 框架
    services/           # 业务逻辑（JSON 文件存储）
      stock/
        python-bridge.ts     # Python 守护进程管理（新增）
        formula-service.ts   # 公式 CRUD 存储（新增）
        ...                  # 其他股票服务
    tipc/               # IPC 路由
  preload/              # 预加载脚本
.dogear/                # 应用数据目录
  settings.json         # 应用设置
  conversations.json    # 对话索引
  workspaces.json       # 工作区索引
  conversations/        # SDK 会话历史
  stocks/
    watchlist.json      # 自选股列表
    formulas.json       # 用户公式存储（新增）
    kline/              # K线历史（JSONL）
    daily/              # 每日快照（JSONL）
```

## 代码地图

详细的文件功能索引见 [`docs/codebase-map.md`](../docs/codebase-map.md)（入口、页面、组件、Store、类型、IPC 路由、服务层、Agent 框架、数据存储、关键数据流）。

**使用建议**：
- 简单修改：直接用 Glob/Grep 探索当前代码状态
- 需要某模块的职责边界概览：Read `docs/codebase-map.md` 对应小节
- 文件索引可能滞后于代码改动，以实际文件为准

---

## 关键开发约定

> IPC 通信、Agent 开发、前端组件的详细规则在 `.claude/rules/` 中按路径自动加载，此处只列全局约定。

### 模块化与解耦原则 ⭐

**新增功能必须优先考虑解耦，避免单文件膨胀**。参考已有的模块化实践：

- **前端组件**：`agent-chat/` 模块（15+ 文件，主组件 225 行）、`stock/` 模块（KLineChart/TimelineChart/MoneyFlow 等各司其职）
- **服务层**：`electron/main/services/stock/` 模块（rate-limiter/stock-service/stock-watchlist-service/stock-data-service/python-bridge/formula-service）
- **Agent 工具**：`electron/main/agents/tools/` 目录（tool-registry/book-qa-tools/book-analysis-tools/article-tools/stock-tools/stock-analysis-tools）

**复杂功能拆分检查单**：
- ✅ 单个函数或组件 >300 行 → 拆成多个小组件或工具函数
- ✅ 涉及 3+ 个独立的责任 → 分别创建 Service/Hook/Utility 文件
- ✅ 有可复用的子流程 → 提取为独立的 Hook / Service 方法 / 工具函数
- ✅ 前端逻辑 + UI 渲染混杂 → 分离成 Container + Presentational Component，或创建 Custom Hook
- ✅ IPC 处理 + 业务逻辑 + 数据存储混杂 → 分离成 tipc handler / Service / DAO 三层
- ✅ 工具集合超过 5 个 → 按功能域创建新的工具文件或子目录（如 `stock-analysis-tools.ts`）

**实施步骤**：
1. **先设计**：实现前梳理职责，识别可复用部分
2. **后编码**：按职责分离创建文件，保留聚合入口（barrel export）
3. **文档化**：在相应目录的 README.md 或 CLAUDE.md 注明职责边界

### 数据存储（JSON 文件）

- 所有持久化数据使用 JSON 文件，不使用 SQLite
- 配置目录：`.dogear/`（开发: 项目根，打包: app.asar 同级）
- `getConfigDir()` 模式：参考 `settings-service.ts`
- 服务层统一使用 `fs.promises` 异步读写
- 内部用 camelCase，前端兼容层用 `toCompat()` 转 snake_case

### 状态管理（Zustand 5）

- Store 文件统一放在 `stores/` 目录
- 现有 Store：analysis-store, article-store, conversation-store, reference-store, workspace-store, settings-store, session-store, ui-store, confirm-store, slash-command-store, stock-store
- 新增状态请创建独立的 store 文件，遵循现有命名模式 `xxx-store.ts`

### TypeScript 配置

- 前端（Vite）：`tsconfig.json`，module=esnext，bundler 解析
- 主进程（Electron）：`tsconfig.electron.json`，module=ES2020，node 解析
- 路径别名：`@/*` 映射到项目根目录

### 工具注册（Tool Registry）

- 新增自定义工具时，在工具文件末尾调用 `registerTools()` 注册元数据（name/description/category）
- 设置页和代理编辑页通过 `client.getRegisteredTools()` IPC 动态获取工具列表，不再硬编码
- `tool-registry.ts` 维护 SDK 内置工具（8个）+ 自定义工具两个分组

### 消息引用格式（XML 标签）

用户消息中的文章引用、历史对话引用和段落引用使用 XML 标签结构化：
- 文章引用：`<referenced_articles><article title="..." articleId="..." site="..." /></referenced_articles>`
- 历史对话引用：`<referenced_articles><article title="..." articleId="..." source_type="session" /></referenced_articles>`（source_type 标记来源为历史对话，输入框显示紫色芯片）
- 段落引用：`<quoted_snippet source="标题">引用文本</quoted_snippet>`（可多个）
- 用户输入作为最后一个 text block
- 发送到 SDK 时使用 multi content block 数组（每个引用/用户文本是独立的 `{type: "text"}` 块）

### 前端注意事项

- Vite 是纯 ESM 环境，**不能使用 `require()`**，必须用 `import()` 动态导入
- Store 之间避免循环依赖，如需延迟导入用 `await import('./xxx-store')`
- 新增页面需在 `src/App.tsx` 中添加 `<Route>` 配置
- 使用 HashRouter（非 BrowserRouter），因为 Electron 生产环境用 `file://` 协议
- **不要使用 `window.confirm` / `window.prompt`**，Electron 不支持，统一用 `showConfirm()`（`confirm-store.ts`）或 `useConfirmStore` 自定义按钮
- 设置页是全屏 overlay（`ui-store.settingsOpen`），不是路由，避免卸载 HomePage 导致 Agent 会话关闭

---

## 禁止事项

- **不要**引入已有依赖能解决的重复库
- **不要**绕过 tipc 直接使用 ipcMain/ipcRenderer 通信
- **不要**在渲染层直接操作文件系统，必须通过 IPC 调用主进程
- **不要**自行实现 Agent SDK 已提供的功能
- **不要**将复杂逻辑堆积在单一文件中，超过 300 行要分解
- **不要**混杂不同的职责（UI + 逻辑、Service + 存储层、工具集合 + 聚合逻辑），要及时拆分
