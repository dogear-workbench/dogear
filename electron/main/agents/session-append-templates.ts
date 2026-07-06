/**
 * 会话系统提示词的「系统级 append 段」模板。
 *
 * 这些不是用户可编辑的提示词，也不是人设——是根据会话所处的组上下文，
 * 在会话启动时动态拼接、告诉主 agent 如何优雅地引用历史会话 / 组背景。
 *
 * 关联：Step 4 装到子会话的 dogear-reference 工具（ReadReferenceSession /
 * ReadGroupBackground / ListSiblingSessions），主 agent 通过 DelegateTo
 * 派子会话来间接使用它们，避免污染主上下文。
 */

import { buildToolPackGuide } from './tool-pack-guide.js';
import type { SystemPromptSegment } from '../types.js';

/** 通用引用会话提示（组内会话默认加，主 agent 侧）。 */
export const REFERENCE_APPEND =
  '\n## 引用历史会话\n' +
  '如需引用某个具体历史会话的内容作为参考，用 DelegateTo 派子会话去消化并交回摘要。\n' +
  '子会话有 ReadReferenceSession 工具能读任意 SDK 会话的去噪原文，会分析后只回给你精炼版本。\n' +
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
    '需要了解组之前的进展 / 结论 / 待办、或某个兄弟会话最近动向时，用 DelegateTo 派子会话去梳理。\n' +
    '子会话有这些专用工具：\n' +
    '- ReadGroupBackground：读本组结构化背景（topic / progress / keyDecisions / openQuestions）\n' +
    '- ListSiblingSessions：列本组其他兄弟会话（含活跃状态 / 是否已被组卡收录）\n' +
    '- ReadGroupDigest：读本组的组级摘要卡（items / keyOutputs / tags）\n' +
    '- ReadReferenceSession：读任意兄弟会话的去噪原文\n' +
    '**都是子会话独占**——你自己没有这些工具，只能派子会话，等它 SubmitDelivery 交摘要回来。'
  );
}

/** 共享区阶段总结引导（仅主会话 + 有工作区时注入）。 */
export const NOTES_GUIDANCE_APPEND =
  `\n## 共享区阶段总结（可选）\n` +
  `当某个阶段告一段落、或上下文用量已较高时，你可以主动调用 \`WriteGroupFile\` 把一份阶段总结写到 \`shared/_notes/<YYYY-MM-DD-HHmm>-<phase>.md\`，` +
  `frontmatter 带 \`summary:\` 一行。这不是强制——只在你判断「现在写下来对下次接续/组卡有价值」时做。` +
  `不要为了凑数而写，也不要把工具用法、流程细节往里堆。`;

/**
 * 子会话交付契约（仅 role='sub' 注入）。
 * 告诉子 agent 自己的任务 / 交付路径 / 必须调 SubmitDelivery 收尾。
 */
export function subAgentContractFor(opts: { task: string; outputPath: string }): string {
  const { task, outputPath } = opts;
  return (
    `\n## 你是一个被派遣的子会话\n` +
    `**任务**：${task}\n\n` +
    `**交付路径**：${outputPath}（共享区相对路径）\n\n` +
    `**交付契约**（必须遵守）：\n` +
    `1. 完成任务后，用 WriteGroupFile 把交付物正文写入 \`${outputPath}\`。\n` +
    `2. 然后调 SubmitDelivery({ summary, outputPath: '${outputPath}' }) 通知父会话；summary ≤500 字总结你做了什么。\n` +
    `3. **未调 SubmitDelivery 就停下**会被视作未交付（no_delivery），父会话拿不到结果。\n` +
    `4. 不要派遣孙子会话（你没有 DelegateTo 工具）。\n` +
    `5. 遇到歧义、缺少关键信息时调 AskParent({ question }) 反问父会话，不要瞎猜。一次只能挂起一个问题，父会话回复后才能再问下一个。\n`
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
      triggerDescription: '所有主会话都注入（子会话没有 DelegateTo 工具，跳过）。引导 Agent 通过派子会话消化历史会话，避免自己直接读会话原文污染上下文。',
      isDynamic: false,
    },
    {
      key: 'group-append',
      label: '组背景提示（组内非首个）',
      category: 'group',
      template: groupAppendFor('<组名>'),
      triggerDescription:
        '主会话 + 所在组已有其他兄弟会话时注入。告诉 Agent 组里的专用子会话工具（ReadGroupBackground / ListSiblingSessions / ReadGroupDigest / ReadReferenceSession），都必须通过 DelegateTo 派子会话使用。',
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
      key: 'sub-agent-contract',
      label: '子会话交付契约',
      category: 'sub-agent',
      template: subAgentContractFor({ task: '<任务描述>', outputPath: '<交付路径>' }),
      triggerDescription: '仅子会话（role=\'sub\'）注入。给子 agent 明确任务、交付路径与「必须调 SubmitDelivery 收尾」契约，禁止派孙子会话，遇歧义走 AskParent。',
      isDynamic: true,
    },
  ];
}
