---
step: 2
title: screenshot 路径修复
status: pending
---

## 目标

修复 `dogear__browser__screenshot` 的路径越界 bug：当前写 `os.tmpdir()`，子会话 read 工具被 workspace-boundary.ts 沙箱拦在工作区内，工具描述承诺的「read 可读」注定失败（2026-09-14 调研会话实际踩坑：截图成功 → read 报路径受限）。

## 依赖上下文（接力棒输入）

- Bug 位置：`electron/main/agents/tools/browser-tools.ts` 工具 5（screenshot），`const file = path.join(os.tmpdir(), \`dogear-browser-${Date.now()}.png\`)`
- 沙箱约束：`agents/pi-session/workspace-boundary.ts:15`——子会话文件访问限工作区内
- `createBrowserToolDefs` 已有 `opts?.workspacePath`（save_article 在用），可直接取
- 背景：`.dogear` 目录是工作区数据目录，`workspacePath/.dogear/tmp/` 无既有清理机制（设计已拍板：量小暂不做 TTL，标注已知限制即可）

## 计划改动

- [ ] `electron/main/agents/tools/browser-tools.ts` screenshot 工具：无 `workspacePath` 时直接 `isErrorResult`（「当前会话未关联工作区，无法提供 read 可读的截图路径」）；有则写 `path.join(workspacePath, '.dogear', 'tmp', \`dogear-browser-${Date.now()}.png\`)`，写前 `fs.promises.mkdir(dir, { recursive: true })`
- [ ] 返回文案与 `emitAction` 的 result 路径同步用新 file
- [ ] 工具描述补一句路径在工作区 `.dogear/tmp/` 下（可删）
- [ ] 清理 import：`os` 若无其他使用点则移除

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
