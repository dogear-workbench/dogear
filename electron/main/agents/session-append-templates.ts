/**
 * 会话系统提示词的「系统级 append 段」模板。
 *
 * 这些不是用户可编辑的提示词，也不是人设——是根据会话所处的组上下文，
 * 在会话启动时动态拼接、告诉主 agent 如何优雅地引用历史会话 / 组背景。
 *
 * 关联：装到子会话的 dogear-reference 工具（ReadReferenceSession /
 * ReadGroupBackground / ListSiblingSessions），主 agent 通过 CreateSession
 * 派新会话来间接使用它们，避免污染主上下文。
 */

import { buildToolPackGuide } from './tool-pack-guide.js';
import type { SystemPromptSegment } from '../types.js';

/** 通用引用会话提示（组内会话默认加，主 agent 侧）。 */
export const REFERENCE_APPEND =
  '\n## 引用历史会话\n' +
  '如需引用某个具体历史会话的内容作为参考，用 CreateSession 派一个新会话去消化并交回摘要。\n' +
  '新会话有 ReadReferenceSession 工具能读任意 SDK 会话的去噪原文，会分析后只回给你精炼版本。\n' +
  '**不要自己直接读会话原文** —— 那会污染你的上下文。';

/**
 * 组背景提示（组内非首个主会话追加，主 agent 侧）。
 * groupName 已做基础转义（不允许 backtick 破坏 markdown 结构）。
 */
export function groupAppendFor(groupName: string): string {
  const safeName = groupName.replace(/`/g, "'");
  return (
    '\n## 当前会话组\n' +
    `你处在会话组「${safeName}」内，该组已有其他兄弟会话。\n` +
    '需要了解组之前的进展 / 结论 / 待办、或某个兄弟会话最近动向时，用 CreateSession 派一个新会话去梳理。\n' +
    '新会话有这些专用工具：\n' +
    '- ReadGroupBackground：读本组结构化背景（topic / progress / keyDecisions / openQuestions）\n' +
    '- ListSiblingSessions：列本组其他兄弟会话（含活跃状态 / 是否已被组卡收录）\n' +
    '- ReadGroupDigest：读本组的组级摘要卡（items / keyOutputs / tags）\n' +
    '- ReadReferenceSession：读任意兄弟会话的去噪原文\n' +
    '**都是被派出的会话独占**——你自己没有这些工具，只能派新会话，等它用 SendMessage(..., { delivery: true }) 把摘要交回来。'
  );
}

/** 记忆系统使用规范（仅主会话 + 有工作区时注入）。 */
export const MEMORY_GUIDANCE_APPEND =
  '\n## 记忆系统\n' +
  '- 只记录有长期价值的信息（稳定的偏好、重要决策、反复出现的模式），不要存一次性对话内容\n' +
  '- UpdateCoreProfile 是全量覆盖——调用前必须先 GetCoreProfile 拿现有内容合并后再写入';

/** 共享区阶段总结引导（仅主会话 + 有工作区时注入）。 */
export const NOTES_GUIDANCE_APPEND =
  `\n## 共享区阶段总结（可选）\n` +
  `当某个阶段告一段落、或上下文用量已较高时，你可以主动调用 \`WriteGroupFile\` 把一份阶段总结写到 \`shared/_notes/<YYYY-MM-DD-HHmm>-<phase>.md\`，` +
  `frontmatter 带 \`summary:\` 一行。这不是强制——只在你判断「现在写下来对下次接续/组卡有价值」时做。` +
  `不要为了凑数而写，也不要把工具用法、流程细节往里堆。`;

/**
 * 主会话协作规范（仅 role='main' 且有 groupId 时注入）。
 * 告诉主 agent 派遣子会话后的协作纪律：CreateSession 后必须 WaitForMessage、交付通过工具返回、反问同样 WaitForMessage。
 */
export const MAIN_AGENT_DELEGATION_APPEND =
  '\n## 主会话与子会话协作规范\n' +
  '当你用 CreateSession 派遣子会话后，**必须紧接着调用 WaitForMessage 挂起等待**，不要在创建后就结束本轮。\n' +
  '子会话执行任务需要时间，你的回合应在 WaitForMessage 中挂起，直到收到子会话的正式交付（delivery）或超时。\n\n' +
  '**协作要点**：\n' +
  '- 子会话完成后会用 SendMessage(..., { delivery: true }) 向你交付，你在 WaitForMessage 中收到结果。\n' +
  '- 如果子会话有歧义需要反问你，它也会用 SendMessage 发来，你在 WaitForMessage 中收到后回复即可。\n' +
  '- 同时派遣多个子会话时，可以用一个 WaitForMessage 等待它们中任意一个的消息（第一条到达即返回）。\n' +
  '- 不要在 CreateSession 后直接 end_turn——那会让你的回合提前结束，子会话的交付无人接收。\n' +
  '- SendMessage 的 delivery 标记仅用于正式交付（任务完成通知），普通往来消息（提问、回复、追加信息）不要设 delivery。';

/**
 * 子会话交付契约（仅 role='sub' 注入）。
 * 告诉子 agent 自己的任务 / 交付路径 / 如何用 SendMessage + WaitForMessage 与派出者协作。
 */
export function subAgentContractFor(opts: { task: string; outputPath: string }): string {
  const { task, outputPath } = opts;
  return (
    `\n## 你是一个被派遣的子会话\n` +
    `**任务**：${task}\n\n` +
    `**建议交付路径**：${outputPath}（共享区相对路径。交付内容较长时先用 WriteGroupFile 写进去，SendMessage 里只放摘要；内容简短可以直接写在 SendMessage 里）\n\n` +
    `**交付契约**：\n` +
    `1. 先用 \`ListLinkedSessions\` 查到派出你的会话的 sessionId。\n` +
    `2. 完成任务后，用 \`SendMessage(sessionId, summary, { delivery: true })\` 向它交付结果；summary ≤500 字总结你做了什么。\n` +
    `3. 有歧义、缺少关键信息时，用 \`SendMessage(sessionId, question)\` 反问，然后 \`WaitForMessage([sessionId])\` 挂起等待回复，不要瞎猜。\n` +
    `4. 你没有 CreateSession / CreateSessionBatch 工具，不能派遣孙子会话。\n` +
    `- 使用 ReadReferenceSession 读历史会话时，原样交回给主 agent，不要臆断或省略。\n`
  );
}

/** 组上下文段（buildGroupContextPrompt 的典型输出示例，实际值运行时由 group-context-builder 生成） */
const GROUP_CONTEXT_EXAMPLE =
  '## 当前会话组上下文\n' +
  '\n' +
  '**组**：<组标题 或 未命名组（创建于 …）>\n' +
  '\n' +
  '**共享区原生文件**（共 N 个）：\n' +
  '- `notes.md` (2.3KB, 5分钟前)\n' +
  '- `_notes/2026-07-06-1400-phase1.md` (1.1KB, 1小时前)\n' +
  '\n' +
  '需要查看这些文件的详情请使用 ListGroupFiles / ReadGroupFile 工具。';

/**
 * 收集当前所有「系统级 append 段」的模板与触发说明，供设置页展示。
 *
 * 只返回模板 + 触发条件文字说明，不抓当前活跃会话的实际拼接结果——
 * 用户可编辑的段（defaultSystemPrompt / persona / coreProfile）已有各自设置入口，此处不重复列出。
 */
export function getSystemPromptSegments(): SystemPromptSegment[] {
  return [
    {
      key: 'tool-pack-guide',
      label: '可用工具类目导览',
      category: 'tool-guide',
      template: buildToolPackGuide([], false),
      triggerDescription:
        '每次会话启动时注入。根据用户在「设置 → 工具包」启用的类目动态生成，帮助 Agent 判断"要不要 search 工具"。常驻记忆系统始终列出；有工作区绑定时会追加 requiresWorkspace 的工具包。',
      isDynamic: true,
    },
    {
      key: 'group-context',
      label: '会话组上下文（模板说明）',
      category: 'group',
      template: GROUP_CONTEXT_EXAMPLE,
      triggerDescription:
        '会话属于某个组时注入。列出组标题 + 共享区原生文件清单（按 mtime 倒序，最多 20 条）。详情靠 ListGroupFiles / ReadGroupFile 工具按需读取。',
      isDynamic: true,
    },
    {
      key: 'reference-append',
      label: '引用历史会话提示',
      category: 'reference',
      template: REFERENCE_APPEND,
      triggerDescription: '所有主会话都注入（子会话没有 CreateSession 工具，跳过）。引导 Agent 通过派新会话消化历史会话，避免自己直接读会话原文污染上下文。',
      isDynamic: false,
    },
    {
      key: 'group-append',
      label: '组背景提示（组内非首个）',
      category: 'group',
      template: groupAppendFor('<组名>'),
      triggerDescription:
        '主会话 + 所在组已有其他兄弟会话时注入。告诉 Agent 组里的专用子会话工具（ReadGroupBackground / ListSiblingSessions / ReadGroupDigest / ReadReferenceSession），都必须通过 CreateSession 派新会话使用。',
      isDynamic: true,
    },
    {
      key: 'notes-guidance',
      label: '共享区阶段总结引导',
      category: 'notes',
      template: NOTES_GUIDANCE_APPEND,
      triggerDescription: '仅主会话 + 绑定了工作区时注入（子会话不写 notes）。引导 Agent 在阶段告一段落时主动写 `shared/_notes/` 阶段总结，供组卡提炼参考。',
      isDynamic: false,
    },
    {
      key: 'memory-guidance',
      label: '记忆系统使用规范',
      category: 'memory',
      template: MEMORY_GUIDANCE_APPEND,
      triggerDescription: '仅主会话 + 绑定了工作区时注入。引导 Agent 正确使用记忆系统：只记长期价值信息、UpdateCoreProfile 前先 GetCoreProfile。',
      isDynamic: false,
    },
    {
      key: 'sub-agent-contract',
      label: '子会话交付契约',
      category: 'sub-agent',
      template: subAgentContractFor({ task: '<任务描述>', outputPath: '<交付路径>' }),
      triggerDescription: '仅子会话（role=\'sub\'）注入。给子 agent 明确任务、建议交付路径，以及如何用 SendMessage(delivery:true) 交付、SendMessage+WaitForMessage 反问，禁止派孙子会话。',
      isDynamic: true,
    },
    {
      key: 'main-agent-delegation',
      label: '主会话协作规范',
      category: 'sub-agent',
      template: MAIN_AGENT_DELEGATION_APPEND,
      triggerDescription: '仅主会话（role=\'main\'）且属于某个会话组时注入。告诉主 agent 派遣子会话后必须 WaitForMessage 挂起等待交付，不要在 CreateSession 后直接结束本轮。',
      isDynamic: false,
    },
  ];
}
