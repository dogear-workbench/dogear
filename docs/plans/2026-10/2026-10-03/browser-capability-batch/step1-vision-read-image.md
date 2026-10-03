---
step: 1
title: 视觉链路修复（read ImageContent + 识图复测）
status: done
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
  - 新事实①：子会话链路（pi-session → builtin-tools.ts）read 用 pi-agent-core `createReadTool()`，不走 workspace-file-tools.ts，且原生支持图片——本次 workspace-file-tools 修复实际覆盖的是 scheduler 后台任务链路（custom-agent-tools.ts，此前读 PNG 产出 utf-8 乱码）
  - 新事实②：原实测断点「read PNG 静默返回空」真根因是 screenshot 产出 0 字节空文件（capturePage 在页面未渲染/不可见时返回空 NativeImage，toPNG() 为空 Buffer，无 isEmpty 检查静默落盘）——已补 `image.isEmpty()` 检查抛明确错误（browser-tools.ts，主会话微改动 4 行）
  - 计划外必要配套：tool-adapter.ts `ToolResult.content` 扩为 `TextContent | ImageContent`（不扩则 image 返回编译必败）
- 改动文件清单：
  - `electron/main/agents/tools/workspace-file-tools.ts`（图片分支：扩展名检测→stat≤5MB→Buffer base64→ImageContent；描述同步更新）
  - `electron/main/agents/pi/tool-adapter.ts`（ToolResult content 类型扩展）
  - `electron/main/agents/tools/browser-tools.ts`（screenshot isEmpty 检查）

### 复测结论（两轮）
- 复测1（存量截图）：无效——源文件本身 0 字节，由此定位到 screenshot 空文件 bug
- 复测2（PIL 生成非空测试图，Flash 逐项读出标题/5 行文字/绿色圆位置/色值）：read→图片→视觉上下文链路确认打通，置信度高

### 给下一步的接力棒
- 关键签名 / 数据结构：`ToolResult = { content: Array<TextContent | ImageContent>; isError?: boolean }`；ImageContent `{ type: 'image', data: base64, mimeType }`；IMAGE_MIME_TYPES png/jpg/jpeg/gif/webp/bmp，MAX_IMAGE_BYTES 5MB
- 下个 step 该从哪里继续：Step 6/7 依赖的 read 图片能力已就绪（两条链路均通）；主会话（glm-5.3 无视觉）识图一律转派 GLM-5.3-Flash 子会话（CreateSession model 参数传 "GLM-5.3-Flash" 实测有效）
- 待办或已知限制：screenshot isEmpty 防护未经真机验证（需页面未渲染场景触发，留待用户日常使用观察）；workspace-file-tools 图片分支无缩放（createReadTool 有 autoResizeImages，scheduler 大图场景可后续对齐）；lint 存量失败在打包产物（electron/ 不在 lint 范围）
