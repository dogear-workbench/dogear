---
step: 2
title: rtk 重写移植
status: done
---

## 目标

把 `.claude/hooks/rtk-rewrite.ps1` 的命令重写逻辑移植成 TypeScript 函数，挂到 `createBashTool` 的 `prepare` 回调上。

## 依赖上下文（接力棒输入）

- 原始 PowerShell 实现：`.claude/hooks/rtk-rewrite.ps1`
- `createBashTool` 的 `prepare` 签名（`node_modules/@earendil-works/pi-agent-core/dist/harness/tools/bash.d.ts`）：

```ts
type BashPrepare = (execution: BashExecution, context: TContext, signal?: AbortSignal) => void | Promise<void>;

interface BashExecution {
  command: string;
  cwd: string;
  env: Record<string, string>;
  inheritEnv: boolean;
}
```

- `prepare` 直接修改 `execution.command` 即可，无需返回值

## 计划改动

- [x] `electron/main/agents/pi-session/rtk-rewrite.ts`（新建）
  - `RTK_TOOLS` 常量：`['git', 'gh', 'pnpm', 'npm', 'npx', 'yarn', 'bun', 'cargo', 'tsc', 'jest', 'vitest', 'playwright', 'pytest', 'rspec', 'prisma', 'prettier', 'eslint', 'next', 'docker', 'kubectl', 'curl', 'wget', 'ls', 'grep', 'find']`（与 PowerShell 版完全一致）
  - `rewriteWithRtk(command: string): string` — 移植拆分 + 加前缀逻辑
    1. 检测系统是否有 `rtk`（首次调用缓存，不每次 spawn）
    2. 按 `&& || ; |` 拆分命令（保留分隔符）
    3. 对每个片段检查第一个 token，在 `RTK_TOOLS` 中且不是 `rtk` 开头 → 加 `rtk ` 前缀
    4. 拼回完整命令
  - rtk 不在 PATH 时直接返回原 command（与 PowerShell 脚本行为一致）
- [x] `electron/main/agents/pi-session/builtin-tools.ts`
  - `createBashTool()` 改为 `createBashTool({ prepare(execution) { execution.command = rewriteWithRtk(execution.command); } })`

## 关键细节

### rtk 可用性检测

PowerShell 版每次调用都 `Get-Command rtk`，TS 版应缓存检测结果避免每次 spawn：
```ts
let rtkAvailable: boolean | null = null;
function isRtkAvailable(): boolean {
  if (rtkAvailable !== null) return rtkAvailable;
  try {
    require('child_process').execFileSync('rtk', ['--version'], { stdio: 'ignore' });
    rtkAvailable = true;
  } catch {
    rtkAvailable = false;
  }
  return rtkAvailable;
}
```

### 拆分正则

PowerShell 版用 `[regex]::Split($command, '(\s*(?:&&|\|\||;|\|)\s*)')`，TS 版等效：
```ts
command.split(/(\s*(?:&&|\|\||;|\|)\s*)/)
```
奇数索引是分隔符，偶数索引是命令片段。

## 实施回填（做完后填）

### 实际改动

1. **新建 `electron/main/agents/pi-session/rtk-rewrite.ts`**
   - `RTK_TOOLS`：`Set<string>`，与 PowerShell 版完全一致的 24 个工具名
   - `isRtkAvailable()`：模块级 `rtkAvailable` 缓存，首次用 `execFileSync('rtk', ['--version'], { stdio: 'ignore' })` 探测；不可用时返回 `false` 并永久跳过
   - `rewriteWithRtk(command)`：
     - rtk 不可用 → 原样返回
     - `command.split(/(\s*(?:&&|\|\||;|\|)\s*)/)` 拆分，偶数索引为命令片段
     - 每片段 trim 前导空白取 firstToken，命中 RTK_TOOLS 且非 `rtk` 开头 → 前导空白 + `rtk ` + trimmed
     - 拼回完整命令

2. **修改 `electron/main/agents/pi-session/builtin-tools.ts`**
   - 新增 `import { rewriteWithRtk } from './rtk-rewrite'`
   - `createBashTool()` → `createBashTool({ prepare(execution) { execution.command = rewriteWithRtk(execution.command); } })`

### 给下一步的接力棒

- rtk 检测结果在模块级缓存（`rtkAvailable` 变量），进程生命周期内只探测一次。如果后续步骤需要重置（如用户安装了 rtk 后），需暴露 reset 接口或改为动态检测。
- `prepare` 回调签名是 `(execution, context, signal?)`，当前只用了 `execution.command`，`context` 和 `signal` 未使用但可扩展（如根据 workspace 配置决定是否启用 rtk）。
- TypeScript 编译无新增错误（项目有若干 pre-existing TS errors，与本改动无关）。
