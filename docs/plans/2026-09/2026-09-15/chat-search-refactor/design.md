# 会话内搜索修缮（第二轮）设计

**背景**：搜索功能第一轮做了基本链路（mark 高亮、块级 fallback、折叠自动展开），实际使用暴露四个问题：
1. 流式输出期间每次 stable 提升触发重扫，`setActiveIndex(0)` 把激活项拉回第 1 个 → 「不停地上下走」
2. 索引端按源文本顺序编号（`hitIndexInBlock`），渲染端按实际渲染出的 mark 顺序编号（`highlight.ts` 的 `take()`）；代码块内、html 注释等命中渲染不出 → 同一 text 块后续编号全部左移错位 → 跳转指错词、高亮错位
3. 四种特殊工具卡（任务申报/用户待办/Agent 通讯/子会话派遣）渲染时不接收 `searchHit`，命中后无高亮无展开；工具块多处命中时用户不知道块内命中情况
4. 搜索框在消息区右上角，用户希望悬浮在输入框正上方

**目标**：搜索命中每一跳都落到看得见的东西上；数字与体感一致；搜索框贴近输入区。

**架构**：两层搜索域。
- **准入原则：「用户能到达的内容才可搜」**——展开/交互后能看到的进索引，任何方式都看不到的不进。
- 精确域（词级 mark + 精确跳转）：用户消息、text 正文、thinking 块。
- 块级域（跳转 + 展开 + 描边 + 「命中 n 处」徽标 + 翻看）：所有 tool_use 块（普通工具卡 + 四种特殊卡）。**不做工具卡内部词级高亮，不碰 ToolBlock 渲染链路**。
- 排除的选项：递归进 hljs span 做代码块词级高亮（侵入渲染、收益低）——改为索引端剥离代码块，两端口径对齐。

**关键取舍（已拍板）**：
- 索引剥离 text 块内 fenced 代码块与 html 注释 → 模型直接贴在回答里的代码不再可搜；通过工具调用读到的代码仍在工具卡块级域可搜。换来编号永不错位。
- thinking 强制展开不可手动收起（activeMatch 停留期间）——现状保持，用户认可。

**模块边界**：
- `components/agent-chat/hooks/useMessageSearch.ts`：重扫保持激活位置 + 扫描剥离
- `components/agent-chat/AgentChat.tsx`：计算 `activeBlockMatchCount` 下传；SearchBar 挪位；Minimap/等待指示常驻
- `components/agent-chat/MessageItem.tsx`：中转 `activeBlockMatchCount`
- `components/agent-chat/ContentBlockItem.tsx`：特殊卡传 `searchHit` + 徽标数
- `TaskReportMessage.tsx` / `UserActionsCard.tsx` / `AgentCommCard.tsx` / `SessionDispatchCard.tsx`：根元素接收描边 + 徽标
- `components/ToolBlock.tsx`：头部加「命中 n 处」徽标
- `components/agent-chat/SearchBar.tsx`：定位改底部

**数据流**：
- 搜索索引：`stableHistory + liveTail` → text 块剥离代码/注释后扫描、thinking/用户消息原样、tool_use 拼三子域 → `SearchMatch[]`（id = `${messageId}-${blockIndex}-${hit}`，不变）
- 激活反馈：`activeMatchId` → 精确域由 mark `data-match-id` 匹配；块级域由 `isBlockActive()` 前缀匹配驱动描边/展开/徽标；徽标数字 = AgentChat 按 `messageId+blockIndex` 分组统计的 `activeBlockMatchCount`
- 重扫保持位置：以 `activeMatchId` 字符串为锚，query 未变时重扫后同 id 优先 → 消失则同块首个 → 再 fallback clamp 原 index

**错误处理 / 边界**：
- 剥离正则局限（嵌套围栏、`~~~`、缩进代码块）：覆盖主路径即可，残余错位由块级 fallback 兜底（`jumpToActiveMatch` 三级 fallback 已有）
- 重扫后激活项内容消失（compact/edit）：clamp 到新 matches 长度
- URL 内含关键词：极罕见，接受块级 fallback
- 徽标仅在该块为当前激活块时显示，避免常驻噪音

**未决问题**：无（方案已与用户逐条拍板）。
