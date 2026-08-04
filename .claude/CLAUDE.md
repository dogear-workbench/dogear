# Dogear 项目指南

## 项目身份

AI 驱动的个人工作台（文章阅读 + 股票分析）。包管理 Bun，不使用 npm。

## 技术栈速查

| 层级 | 技术 |
|------|------|
| 桌面框架 | Electron（主进程 + 渲染进程） |
| 前端 | Vite 7 + React 19 + React Router v7（HashRouter） |
| 包管理 | Bun |
| UI | shadcn/ui + Radix UI + Tailwind CSS 4 + lucide-react |
| 状态 | Zustand 5（`stores/` 目录） |
| IPC | `@egoist/tipc`（类型安全） |
| AI | 两个运行时并存：`@earendil-works/pi-ai` + `pi-agent-core`（主会话/子会话 PiSession + 四条后台一次性任务，见 `agents/pi-session/`、`agents/pi/`）/ `@anthropic-ai/claude-agent-sdk`（仅 PARSE_ARTICLE 后台任务） |
| 存储 | JSON 文件（`.dogear/` 目录），不使用 SQLite |
| 计算层 | Python 3 + pandas + numpy + lark（股票指标/选股/公式/回测） |
| 文档解析 | epub2 / pdf-parse / @mozilla/readability + turndown |

## 常用命令

```bash
bun run dev              # 启动开发（编译 Electron + 并行启动 Vite + Electron）
bun run dev:renderer     # 仅前端（localhost:3000）
bun run build:electron   # 编译主进程（TypeScript → JavaScript）
bun run build            # 完整构建（Vite 前端 + Electron 主进程）
bun run dist             # 打包分发
bun run lint             # 代码检查
```

> 主进程代码改动需 `build:electron` 重新编译，Vite 热重载只对前端生效。

## 硬约束

- 使用**中文**回答
- 修改前要有 95% 以上把握，否则先问；改一个功能要全面考虑对其他模块的影响
- 不写注释；只在 WHY 非显而易见时加简短一行
- 不留半成品：写完清理，不放 `// TODO` 或空 stub
- 单文件 / 单函数 >300 行考虑拆分
- 代码引用用 `path/file.ts:line` 格式方便跳转

## 红线

- **不要**绕过 tipc 直接使用 ipcMain/ipcRenderer 通信
- **不要**在渲染层直接操作文件系统，必须通过 IPC 调用主进程
- **不要**使用 `window.confirm` / `window.prompt`，统一用 `confirm-store.ts` 的 `showConfirm()`
- **不要**在 Vite 前端用 `require()`，必须用 `import()`（纯 ESM 环境）
- Bash 命令的 RTK 包装由 `.claude/hooks/rtk-rewrite.ps1` 自动处理，无需手动加 `rtk` 前缀

## 项目级硬决策

- 持久化数据全部用 JSON 文件（不用 SQLite），配置目录 `.dogear/` 通过 `getConfigDir()` 获取；服务层统一 `fs.promises` 异步读写
- Store 文件统一放 `stores/`，命名 `xxx-store.ts`；新增独立状态请新建 store 文件；循环依赖用 `await import()` 延迟导入
- 新增 Agent 工具：文件末尾调 `registerTools()` 注册元数据；前端走 `client.getRegisteredTools()` IPC 动态获取列表，不要硬编码
- Agent 工具命名 `mcp__{server}__{tool}`；输入用 zod schema 严格校验；错误返回 `isError: true`，不抛异常

## 详细参考

代码地图、模块约定、流程指引走 **Skill 工具**加载（codebase-map / brainstorming / systematic-debugging / staged-impl / doc-sync 等）。简单定位直接用 Glob/Grep。
