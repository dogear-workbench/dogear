# Step 2 交付：rtk 重写移植

## 改动清单

### 1. 新建 `electron/main/agents/pi-session/rtk-rewrite.ts`

移植 `.claude/hooks/rtk-rewrite.ps1` 的命令重写逻辑为 TypeScript 函数：

- `RTK_TOOLS`：`Set<string>`，24 个工具名，与 PowerShell 版完全一致
- `isRtkAvailable()`：模块级缓存 `rtkAvailable`，首次用 `execFileSync('rtk', ['--version'], { stdio: 'ignore' })` 探测；不可用时永久返回 `false`（与 PS 版行为一致）
- `rewriteWithRtk(command)`：
  - rtk 不可用 → 原样返回
  - 按 `/(\s*(?:&&|\|\||;|\|)\s*)/` 拆分，偶数索引为命令片段
  - 每片段取 firstToken，命中 RTK_TOOLS 且非 `rtk` 开头 → 加 `rtk ` 前缀（保留前导空白）
  - 拼回完整命令

### 2. 修改 `electron/main/agents/pi-session/builtin-tools.ts`

- 新增 `import { rewriteWithRtk } from './rtk-rewrite'`
- `createBashTool()` → `createBashTool({ prepare(execution) { execution.command = rewriteWithRtk(execution.command); } })`

## 验证

- TypeScript 编译：无新增错误（项目有若干 pre-existing TS errors，与本改动无关）
- ESLint：两个文件被 ignore pattern 排除，无实际错误
- 逻辑与 PowerShell 版一一对应：RTK_TOOLS 列表、拆分正则、前缀逻辑、rtk 检测行为均一致

## 注意事项

- rtk 检测结果在进程生命周期内只探测一次（模块级缓存）。如果用户运行中安装了 rtk，需要重启进程才能生效。
- `prepare` 签名为 `(execution, context, signal?)`，当前只用了 `execution.command`。
