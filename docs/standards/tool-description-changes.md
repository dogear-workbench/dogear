# Agent 协作工具描述改动清单

配合 `tool-description-guide.md` 规范，对 11 个协作工具的 description 和参数描述做对应修改。

## delegation-tools.ts

### CreateSession

**description**

```
旧：创建一个平级的新会话来协作处理任务。新会话与当前会话建立契约通道，可通过 SendMessage / WaitForMessage 双向通信。outputPath 用于建议新会话把较长的交付内容写到共享区（不可与其它在跑的会话冲突）；简短交付可以直接放进 SendMessage 里。profile 参数用于选择子会话 Profile（决定模型、工具集、能力域）；不传时用默认 Profile。

新：创建一个子会话来执行独立任务，与当前会话建立双向通信通道。仅用于需要把任务委派给独立会话处理时。
```

**outputPath 参数**

```
旧：建议新会话写入共享区的相对路径（如 hello.md），用于承载较长的交付内容
新：子会话交付文件写入共享区的相对路径（如 step1-delivery.md）
```

### CreateSessionBatch

**description**

```
旧：原子批量创建多个新会话。先一次性 dry-run 校验所有 outputPath 不冲突，任何一个冲突则整批拒绝；全部 ok 才依次拉起。中途任意一个拉起失败将回滚已创建的会话。

新：批量创建多个子会话（原子操作：要么全部成功，要么全部不创建）。仅用于需要同时派出多个互相独立的任务时。
```

**outputPath 参数**（items 内）

```
旧：建议写入共享区的相对路径
新：子会话交付文件写入共享区的相对路径
```

### StopSession

**description**

```
旧：停止当前会话直接派出的某个会话（仅对 running 有效）。停止后该会话状态变为 cancelled。

新：停止当前会话直接派出的正在运行的子会话。仅用于需要中止子会话任务时。
```

### SendMessage

**description**

```
旧：向已建立契约通道的会话发送消息。目标会话必须与当前会话有直接派出关系（当前会话派出的，或派出当前会话的）。可选 options.delivery=true 标记这是一次正式交付（任务完成通知），配合 WaitForMessage 使用。

新：向与当前会话有直接派出关系的会话发送消息。仅用于与协作会话通信时。
```

### WaitForMessage

**description**

```
旧：挂起当前回合，等待来自指定 sessionId 列表中任意一方的下一条消息（第一条到达即返回，不等齐全部）。超时未收到任何消息则返回超时提示。

新：挂起当前回合，等待指定会话列表中任一方的消息（第一条到达即返回）。仅用于派出子会话后等待其交付或回复时。
```

### ListLinkedSessions

**description**

```
旧：列出当前会话所有直接契约通道对方（既包含当前会话派出的，也包含派出当前会话的），用于获取可通信的 sessionId。

新：列出当前会话所有直接契约通道对方，用于获取可通信的 sessionId。
```

## group-tools.ts

### ListGroupFiles

**description**

```
旧：列出当前会话组共享区的所有文件并返回内容。不要用于查看工作区项目文件。

新：列出会话组共享区的所有文件并返回内容。仅用于查看同组会话放到共享区的文件时。
```

### SaveSharedNote

**description**

```
旧：写入会话组共享区的文件（覆盖已有内容）。工作区项目代码/文档请用 write 工具。

新：向会话组共享区写入文件（覆盖已有内容）。仅用于需要向同组其他会话传递文件时。
```

## reference-tools.ts

### ReadReferenceSession

**description**

```
旧：读指定 SDK 会话的去噪原文。不传 tail/range 返回全量；tail=N 返回后 N 条；range=[start, end) 按去噪后 index 切。返回值前几行是 meta（count / totalCount），下面才是正文。正文里每块以 `## [role · ts · uuid] ` 开头。会话不存在或读失败时返回 error 字符串。

新：读指定会话的去噪原文（可尾切或区间切）。仅用于需要查看其他会话的完整对话内容时。
```

**参数补充**

```
tail
  旧：尾 N 条（去噪后计数）
  新：返回最后 N 条；不传则返回全量

rangeStart
  旧：起始 index（含），与 rangeEnd 配合使用，闭开区间 [rangeStart, rangeEnd)
  新：区间起始（含），与 rangeEnd 配合使用；不传则不切区间

rangeEnd
  旧：结束 index（不含），与 rangeStart 配合使用
  新：区间结束（不含），与 rangeStart 配合使用
```

### ReadGroupBackground

**description**

```
旧：读本组 background.md（结构化背景）。返回 topic / progress / keyDecisions[] / openQuestions[]。当前组：closure 已注入，无需入参。如果 background 尚未生成（例如组卡刚创建、还没跑过组提炼），返回明确的 null 说明。

新：读取当前会话组的结构化背景摘要（主题、进展、已拍板决策、待议问题）。仅用于需要了解当前组整体上下文时。
```

### ListSiblingSessions

**description**

```
旧：列出本组的兄弟会话（不含派出你的父会话本身、不含子会话、不含已归档）。每条给出 sessionId / conversationTitle / lastActivity / isActive（近 5 分钟有活动）/ hasDigestCoverage（是否已被组卡收录）。

新：列出当前会话组内的兄弟会话（不含父/子会话和已归档）。仅用于需要了解组内还有哪些活跃会话时。
```
