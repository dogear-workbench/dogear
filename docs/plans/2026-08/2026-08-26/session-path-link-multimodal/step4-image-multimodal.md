---
step: 4
title: 图片多模态链路
status: done
---

## 目标

打通聊天贴图：图片从渲染层到达 GLM glm-5.3-flash，历史回放显示缩略图。只修 pi-session + adapter 两文件断点。

## 依赖上下文（接力棒输入）

- 现状链路（前三段已就绪，不动）：
  - 渲染层收集：`useImageAttachment.ts:5-9,18-32` → PendingImage `{file, preview: blobURL, base64(无前缀), mediaType}`
  - IPC 发送：`useSendMessage.ts:446-450` `images: [{media_type, data}]`；跨 profile 重发队列也带（useAgentSession.ts:149）
  - tipc 组装：`electron/main/tipc/agent.ts:229-238` 把 images 组成 `{type:'image', source:{type:'base64', media_type, data}}`（Anthropic 形状）传 `activeSession.sendMessage(contentBlocks)`
  - 历史回放：`history-adapter.ts` extractUserContent :53-61 已支持 image block → data URL；`MessageItem.tsx:271-281` 缩略图渲染已就绪（当前为死路径，修好自动活）
- **断点**：
  - `electron/main/agents/pi-session/pi-session.ts:858-880` `sendMessage(content: string | ContentBlockParam[])`：非 string 走 `extractTextFromBlocks`（:183-192，注释「阶段一不支持图像，静默丢弃非文本块」）→ 只传 text
  - `electron/main/agents/pi-session/pi-harness-adapter.ts:125-130`：`prompt(text: string)` / `steer(text: string)` 未暴露 images
- pi 侧接口（node_modules 实测确认）：
  - pi-ai `ImageContent = {type:'image', data: base64无前缀, mimeType}`（UserMessage content 支持）
  - harness：`prompt(text, options?: {images?: ImageContent[]})` / `steer(text, options?)`（agent-harness.d.ts:49-55）
- 关键决策回顾：格式转换放 pi-session.ts（tipc 的 Anthropic 形状 → ImageContent）；steer 插话同样支持带图；图片 base64 全量落 JSONL 是接受的取舍

## 计划改动

- [ ] `pi-session.ts`：`extractTextFromBlocks` 改为 `splitContentBlocks`（返回 `{text, images: ImageContent[]}`，image 块转 `{data: block.source.data, mimeType: block.source.media_type}`）；`sendMessage` 把 images 传给 `adapter.prompt(text, images)`；插话路径（steer）同样透传
- [ ] `pi-harness-adapter.ts`：`prompt(text, images?)` / `steer(text, images?)` 签名扩展，透传 `harness.prompt(text, {images})` / `harness.steer(text, {images})`
- [ ] `bun run build:electron` 重编译

## 验证

1. 重启应用，贴一张 png 发「这张图里有什么」→ 模型能描述图片内容（GLM glm-5.3-flash）
2. 发送中本地缩略图显示（原有乐观渲染）；会话刷新/重开后历史消息缩略图仍在（JSONL 落盘回放链路激活）
3. 运行中插话带图：steer 路径同样到达模型
4. 旧纯文本会话回归：无图片的消息行为不变
5. agent read 一张工作区 png（如文章配图）→ 模型能描述（tool result image 块，agent-loop 原样透传，本步零改动开箱即用；若 glm-5.3-flash 对 tool result 图支持异常记录到回填，不阻塞）
6. 大图边界：贴 >1MB 图不崩溃（JSONL 膨胀为已知取舍）

## 实施回填（做完后填）

### 实际改动
- 与计划差异：无实质差异。额外两处低风险增强：日志增加 `imageCount` 字段（pi-session.ts:875-880）；string 直入分支用 `images: [] as ImageContent[]` 解构统一后续路径。url 形状 image 块不支持、静默丢弃（与旧丢弃行为一致，仅注释说明）
- 改动文件清单：
  - `electron/main/agents/pi-session/pi-session.ts`：:18 导入 ImageContent；:182-196 extractTextFromBlocks → splitContentBlocks；:870-871 sendMessage 解构 text+images；:875-880 日志加 imageCount；:890 steer(text, images)；:899 prompt(text, images)
  - `electron/main/agents/pi-session/pi-harness-adapter.ts`：:18 导入 ImageContent；:125-127 prompt 签名 + harness.prompt(text, {images})；:129-131 steer 签名 + harness.steer(text, {images})
- 验证：bun run build:electron ✅；bun run lint 0 errors（两文件在 eslint ignore 列表，类型检查由 tsc 承担）

### 给下一步的接力棒
- 关键签名 / 数据结构：`splitContentBlocks(ContentBlockParam[]) → {text, images: ImageContent[]}`（Anthropic base64 块 → pi-ai {type:'image', data, mimeType}）；`adapter.prompt/steer(text, images?)` 透传 harness options
- 下个 step 该从哪里继续：本计划最后一步，无后续 step；GUI 实测见 step4-delivery.md 遗留清单
- 待办或已知限制：图片 base64 全量落 JSONL（已接受取舍）；url 形状 image 块静默丢弃；glm-5.3-flash 对 tool result image 块的支持待实测
