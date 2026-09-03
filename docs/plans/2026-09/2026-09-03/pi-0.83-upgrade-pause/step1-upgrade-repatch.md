---
step: 1
title: 升级 0.83.0 并重做 Windows patch
status: done
---

## 目标

两包依赖 0.82.1 → 0.83.0，通过 bun patch 流程重建 Windows 路径归一 patch（旧 patch 内容原样复用），保证 `bun install` 后项目构建与既有测试全绿。

## 依赖上下文（接力棒输入）

- 前置 step 产出：无（首步）
- 当前关键文件状态：`package.json:29-30` 为 `^0.82.1`；`package.json:105-107` patchedDependencies 锁 `@earendil-works/pi-agent-core@0.82.1`；现有 patch 在 `patches/@earendil-works%2Fpi-agent-core@0.82.1.patch`
- 关键决策回顾：0.83.0 的 dist 与 0.82.1 仅 `dist/proxy.js` 3 处差异（stopReason "stop"→"pending"），项目不用 proxy 子路径，无影响；三个 patch 目标文件 byte-identical，改动可原样复用

## 计划改动

- [ ] `package.json:29-30`：`@earendil-works/pi-agent-core` 和 `@earendil-works/pi-ai` 改 `^0.83.0`
- [ ] `bun install`
- [ ] 重建 patch：`bun patch @earendil-works/pi-agent-core@0.83.0`（输出临时编辑目录），把旧 patch 的 6 处改动应用到编辑目录（内容见下），然后 `bun patch --commit <编辑目录>`
- [ ] 确认 `package.json` patchedDependencies key 自动变为 `@0.83.0`，旧 patch 文件被清理
- [ ] 验证：`node_modules/@earendil-works/pi-agent-core/dist/harness/skills.js` 的 `joinEnvPath` 等函数已含 `replace(/\\/g, "/")`
- [ ] 跑测试：`bun test electron/main/agents/pi-session/`（builtin-tools / permission-rules / usage-extractor 三组）

### 6 处 Windows 路径改动清单（从旧 patch 原样抄）

每处都是在现有 replace 链最前面加 `.replace(/\\/g, "/")`：

1. `dist/harness/env/nodejs.js` — `fileInfoFromStats` 的 `name:` 行
2. `dist/harness/prompt-templates.js` — `basenameEnvPath` 的 `normalized`
3. `dist/harness/skills.js` — `joinEnvPath` 的 base 和 child 两处
4. `dist/harness/skills.js` — `dirnameEnvPath` 的 `normalized`
5. `dist/harness/skills.js` — `basenameEnvPath` 的 `normalized`
6. `dist/harness/skills.js` — `relativeEnvPath` 的 `normalizedRoot` 和 `normalizedPath`

精确 diff 参照 `patches/@earendil-works%2Fpi-agent-core@0.82.1.patch`（动手前先 cat 一遍）。

## 实施回填（做完后填）

### 实际改动
- 与计划差异：① `bun patch --commit` 不会自动清理旧 patchedDependencies 条目和旧 patch 文件，已手动删；② 反斜杠正则的文本替换改用提取旧 patch diff 块 + `patch -p1 --dry-run`（通过即 byte-identical 证明）后正式应用，结果等价；③ 新 patch 不再含旧版 `.bun-tag-xxx` 头部 diff，更干净
- 改动文件清单：package.json（依赖 ^0.83.0 ×2 + patchedDependencies 锁 @0.83.0）、bun.lock、patches/@earendil-works%2Fpi-agent-core@0.83.0.patch（新建，3 diff 块 8 处 replace）、旧 0.82.1 patch 删除

### 给下一步的接力棒
- 关键签名 / 数据结构：patch 位置 `patches/@earendil-works%2Fpi-agent-core@0.83.0.patch`；Step 2 的 4 行透出继续合入此 patch：`bun patch @earendil-works/pi-agent-core@0.83.0` 重开编辑目录 → 改 → `bun patch --commit node_modules/@earendil-works/pi-agent-core`
- 下个 step 该从哪里继续：直接重开编辑目录追加 shouldStopAfterTurn 透出（types.d.ts + agent-harness.js 各 2 行）
- 待办或已知限制：无；验证 node_modules 8/8 处替换到位、35 测试全绿、build:electron 过
- 坑：向含反斜杠正则的 JS 文件做文本替换不要用 edit/bash 内联转义（工具链吃一层 `\`），用 write 写脚本/patch 文件执行
