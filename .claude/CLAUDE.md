# Dogear 项目指南

> AI 驱动的个人工作台，支持网络文章阅读与股票分析。

## 项目级硬性约定

- 使用**中文**回答
- 修改前要有 95% 以上把握，否则先问；改一个功能要全面考虑对其他模块的影响
- 不写大规模的注释；只在 WHY 非显而易见时加简短一行
- 不留半成品：功能写完就清理，不放 `// TODO` 或空 stub
- 单文件/单函数 >300 行考虑拆分，避免 UI 与逻辑混杂
- 代码引用用 `path/file.ts:line` 格式方便跳转
- UI 交互状态（搜索/折叠/Minimap 等）用组件内 state，不随意扩大 store
- 开发阶段不做兼容性代码（不保留废弃字段、不加迁移兼容层）

## 禁止事项

- **不要**引入已有依赖能解决的重复库
- **不要**绕过 tipc 直接使用 ipcMain/ipcRenderer 通信
- **不要**在渲染层直接操作文件系统，必须通过 IPC 调用主进程
- **不要**自行实现 Agent SDK 已提供的功能
- **不要**使用 `window.confirm` / `window.prompt`，统一用 `confirm-store.ts` 的 `showConfirm()`
- **不要**在 Vite 前端用 `require()`，必须用 `import()`（纯 ESM 环境）
- Bash 命令的 RTK 包装由 `.claude/hooks/rtk-rewrite.ps1` 自动处理，无需手动加 `rtk` 前缀

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

## 技术栈速查

| 层级 | 技术 |
|------|------|
| 桌面框架 | Electron（主进程 + 渲染进程） |
| 前端 | Vite 7 + React 19 + React Router v7（HashRouter） |
| 包管理 | Bun |
| UI | shadcn/ui + Radix UI + Tailwind CSS 4 + lucide-react |
| 状态 | Zustand 5（`stores/` 目录） |
| IPC | `@egoist/tipc`（类型安全） |
| AI | 两个运行时并存：`@anthropic-ai/claude-agent-sdk`（主会话 QueryBasedSession + PARSE_ARTICLE）/ `@earendil-works/pi-ai` + `pi-agent-core`（四条后台一次性任务，见 `agents/pi/`） |
| 存储 | JSON 文件（`.dogear/` 目录），不使用 SQLite |
| 计算层 | Python 3 + pandas + numpy + lark（股票指标/选股/公式/回测） |
| 文档解析 | epub2 / pdf-parse / @mozilla/readability + turndown |

---

## 关键开发约定

> 各模块详细规则在 `.claude/rules/` 中按文件路径自动触发（修改对应文件时 Agent 会看到对应 rule）。

### 数据存储

- 持久化数据全部使用 JSON 文件，不用 SQLite
- 配置目录：`.dogear/`（开发: 项目根，打包: app.asar 同级），通过 `getConfigDir()` 获取
- 服务层统一 `fs.promises` 异步读写
- 内部用 camelCase，前端兼容用 `toCompat()` 转 snake_case

### 状态管理

- Store 文件统一放 `stores/`，命名 `xxx-store.ts`
- 新增独立状态请新建 store 文件，不要塞进现有 store
- Store 间循环依赖用 `await import()` 延迟导入

### TypeScript 配置

- 前端 `tsconfig.json`（module=esnext，bundler 解析）
- 主进程 `tsconfig.electron.json`（module=ES2020，node 解析，rootDir 限制为 `./electron`）
- 路径别名：`@/*` 映射到项目根目录
- 主进程不能直接导入 `types/`，需要用 `electron/main/types.ts` 镜像

### 工具注册

- 新增自定义 Agent 工具时，文件末尾调用 `registerTools()` 注册元数据
- 设置页和代理编辑页通过 `client.getRegisteredTools()` IPC 动态获取列表，不要硬编码

### 模块化解耦原则

新增功能必须优先考虑解耦，避免单文件膨胀。检查单：
- ✅ 单个函数或组件 >300 行 → 拆成多个小组件或工具函数
- ✅ 涉及 3+ 个独立的责任 → 分别创建 Service/Hook/Utility 文件
- ✅ 有可复用的子流程 → 提取为独立的 Hook / Service 方法
- ✅ 前端逻辑 + UI 渲染混杂 → 分离成 Container + Presentational，或 Custom Hook
- ✅ IPC 处理 + 业务逻辑 + 数据存储混杂 → 分离成 tipc handler / Service / DAO 三层
- ✅ 工具集合超过 5 个 → 按功能域创建新工具文件

详细的现有模块化范例（agent-chat、stock、tools 等）见 `.claude/rules/agent-development.md`。

---

## 代码地图

不知道某个文件/模块在哪时，先 Read [`.claude/rules/codebase-map.md`](rules/codebase-map.md)（含入口、页面、组件、Store、类型、IPC 路由、服务层、Agent 框架、数据存储、关键数据流）。简单修改可直接用 Glob/Grep 探索。文件索引可能滞后于代码改动，以实际文件为准。

