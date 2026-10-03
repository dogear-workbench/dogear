---
step: 1
title: 视觉链路修复（read ImageContent + 识图复测）
status: pending
---

## 目标

read 工具支持读图片文件返回 ImageContent（修实测断点），并用存量截图复测 Flash 识图质量。

## 依赖上下文（接力棒输入）

- 实测断点（2026-10-03 子会话 01a10183）：screenshot 产出 PNG 正常（`C:\dogear\.dogear\tmp\dogear-browser-1791026771690.png` 仍在，可作复测素材），read 读 PNG 静默返回空
- 根因：`electron/main/agents/tools/workspace-file-tools.ts` read 用 `fs.readFile(abs, 'utf-8')` 硬解码，无图片分支；工具描述「图片等二进制内容不支持」与 screenshot 描述「read 原生支持图片附件」矛盾
- 底层支持：pi-ai `ToolResultContent` 原生含 `ImageContent`（`node_modules/@earendil-works/pi-ai/dist/types.d.ts:307`，`{ type: 'image', data: base64, mimeType }`），无需动管线
- 用户消息侧图片注入已通（`tipc/agent.ts:233` + `pi-session.ts` splitContentBlocks），本步只修工具结果侧

## 计划改动

- [ ] `workspace-file-tools.ts` read：按扩展名（png/jpg/jpeg/gif/webp/bmp）检测 → `fs.readFile` 无编码读 Buffer → base64 → 返回 `{ type: 'image', data, mimeType }`（文本文件走原逻辑不动）
- [ ] 图片大小上限（如 5MB 超限返回明确错误，防 context 爆炸）
- [ ] read 工具描述改为「支持图片（png/jpg/gif/webp/bmp），以图片附件进入上下文」，与 screenshot 描述对齐
- [ ] 非图片二进制保持不支持文案
- [ ] 复测：build:electron 后派子会话 read 存量 HN 截图，交付「从像素读到的内容」（≥5 条标题要点/主色/logo）+ 置信度自评

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
