---
step: 1
title: RTK Hook 自动化
status: done
---

## 目标
PreToolUse hook 自动给 Bash 命令加 rtk 前缀，删 CLAUDE.md 约 80 行 RTK 规则段（节省常驻 system token，避免靠 prompt 引导）。

## 依赖上下文（接力棒输入）
- 当前 `.claude/hooks/` 目录不存在，需新建
- 当前 `.claude/settings.json` 在工程根，需先 Read 确认结构
- 当前 `.claude/CLAUDE.md` 末尾有 "RTK (Rust Token Killer)" 整段（约 80 行）
- 风险点：Claude Code `updatedInput` 需 v2.0.10+；执行前 Read `.claude/settings.json` 确认本机版本兼容

## 计划改动
- [ ] 新增 `.claude/hooks/rtk-rewrite.ps1`：
  - 读 stdin JSON（PreToolUse payload）
  - tool 非 Bash 直接放行返回空 JSON
  - 解析 `tool_input.command`，按 `&&` / `|` / `;` 拆段
  - 每段首 token 在 RTK 支持列表（git / pnpm / npm / npx / vitest / jest / playwright / cargo / tsc / lint / prettier / next / pytest / gh / docker / kubectl / curl / wget / ls / grep / find / read / pnpm / yarn / docker / 等）且未带 rtk 前缀 → 加 rtk
  - 拼回 → 输出 `{ "hookSpecificOutput": { "hookEventName": "PreToolUse", "permissionDecision": "allow", "updatedInput": { "command": "..." } } }`
  - rtk.exe 未安装 → 不改写 + stderr 警告
  - 解析异常 → 不改写
  - UTF-8 编码：脚本头部 `[Console]::InputEncoding = [Console]::OutputEncoding = [Text.Encoding]::UTF8`
- [ ] 改 `.claude/settings.json` 注册 PreToolUse hook：
  ```json
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          { "type": "command", "command": "powershell -ExecutionPolicy Bypass -File .claude/hooks/rtk-rewrite.ps1" }
        ]
      }
    ]
  }
  ```
- [ ] 改 `.claude/CLAUDE.md`：
  - 删除 "# RTK (Rust Token Killer) - Token-Optimized Commands" 整段（标题到结尾）
  - 在「禁止事项」或合适位置加一行：
    > - Bash 命令的 RTK 包装由 `.claude/hooks/rtk-rewrite.ps1` 自动处理，无需手动加前缀

## 实施回填

### 实际改动
- 与计划差异：
  - `.claude/settings.json` 原本不存在（只有 `settings.local.json`），新建文件而非修改
  - RTK 工具白名单收紧：剔除 rtk 专属伪命令（`gain` / `discover` / `proxy` / `init` / `err` / `log` / `json` / `deps` / `env` / `summary` / `diff` / `test` / `read` / `lint`），只保留真实 shell 命令（git / gh / pnpm / npm / npx / yarn / bun / cargo / tsc / jest / vitest / playwright / pytest / rspec / prisma / prettier / eslint / next / docker / kubectl / curl / wget / ls / grep / find）
  - 拆分符多加了 `||`（原计划只列 `&&` / `|` / `;`）
  - CLAUDE.md 用截断方式删整段（116 行后全部清掉），保留代码地图段末尾换行
- 改动文件清单：
  - 新建 `.claude/hooks/rtk-rewrite.ps1`
  - 新建 `.claude/settings.json`（仅注册 hook，不含 permissions）
  - 改 `.claude/CLAUDE.md`：256 行 → 117 行，删 RTK 整段 + 在「禁止事项」加一行 hook 说明

### 给下一步的接力棒
- hook 验证方法：
  - `echo '{"tool_name":"Bash","tool_input":{"command":"git status && bun run lint"}}' | powershell -ExecutionPolicy Bypass -File .claude/hooks/rtk-rewrite.ps1` → 应返回 `updatedInput.command = "rtk git status && rtk bun run lint"`
  - 三种 no-op 情形（已带 rtk / 非 Bash / 命令不在白名单）应 exit 0 且无 stdout 输出
- 已知限制 / 待办：
  - 拆分用的正则不解析引号/子 shell，遇到 `sh -c "git status; echo x"` 这种嵌套场景只会处理外层；目前 Claude Code 常用命令不会触碰
  - 命令首 token 必须严格相等，所以 `/usr/bin/git` 这种绝对路径不会被改写（项目里用不到）
  - 需要 Claude Code v2.0.10+ 才支持 `updatedInput` 字段；旧版会忽略 hook 返回值（命令照常执行，不阻塞）
