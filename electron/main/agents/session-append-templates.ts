/**
 * 会话系统提示词的「系统级 append 段」模板。
 *
 * 根据 main / sub 角色和组上下文，在会话启动时动态拼接行为约束。
 */

import type { SystemPromptSegment } from '../types.js';
import type { SubAgentProfile } from '../services/settings-types.js';
import { createDefaultSubAgentProfile } from '../services/settings-types.js';

/** 记忆系统使用规范（仅主会话 + 有工作区时注入）。 */
export const MEMORY_GUIDANCE_APPEND =
  '\n## 记忆系统\n' +
  '- 只记录有长期价值的信息（稳定的偏好、重要决策、反复出现的模式），不要存一次性对话内容\n' +
  '- 讨论用户可能已有偏好的话题时，先 RecallMemory 查一下有没有相关记忆';

/** 共享区阶段总结引导（仅主会话 + 有工作区时注入）。 */
export const NOTES_GUIDANCE_APPEND =
  `\n## 共享区阶段总结（可选）\n` +
  `当某个阶段告一段落、或上下文用量已较高时，你可以主动调用 \`SaveSharedNote\` 把一份阶段总结写到 \`shared/_notes/<YYYY-MM-DD-HHmm>-<phase>.md\`，` +
  `frontmatter 带 \`summary:\` 一行。这不是强制——只在你判断「现在写下来对下次接续/组卡有价值」时做。` +
  `不要为了凑数而写，也不要把工具用法、流程细节往里堆。`;

/** 主会话协作规范（仅 role='main' 且有 groupId 时注入）。 */
export const MAIN_AGENT_DELEGATION_APPEND =
  '\n## 主会话与子会话协作规范\n' +
  '用 CreateSession 派遣子会话后，必须紧接着调用 WaitForMessage 挂起等待，不要在创建后直接结束本轮——否则子会话的交付无人接收。';

/**
 * 生成可用的子会话 Profile 索引（仅主会话注入，让模型按描述选择 profile 参数）。
 */
export function buildSubAgentProfileIndex(profiles: SubAgentProfile[]): string {
  if (profiles.length === 0) {
    return (
      '\n## 可用的子会话 Profile\n' +
      '派遣子会话时可通过 profile 参数选择合适的 Profile（不指定时用「默认」）。'
    );
  }
  const rows = profiles.map((p) => `| ${p.name} | ${p.description} |`).join('\n');
  return (
    '\n## 可用的子会话 Profile\n' +
    '派遣子会话时可通过 profile 参数选择合适的 Profile（不指定时用「默认」）：\n\n' +
    '| Profile | 说明 |\n' +
    '|---------|------|\n' +
    rows
  );
}

/** 子会话交付契约（仅 role='sub' 注入）。 */
export function subAgentContractFor(opts: { task: string; outputPath: string }): string {
  const { task, outputPath } = opts;
  return (
    `\n## 你是一个被派遣的子会话\n` +
    `**任务**：${task}\n\n` +
    `**建议交付路径**：${outputPath}（内容较长时先用 SaveSharedNote 写进去，SendMessage 里只放摘要）\n\n` +
    `**交付流程**：完成后用 SendMessage 向派出你的会话交付结果（delivery: true）；有歧义时先反问，不要瞎猜。你不能派遣孙子会话。`
  );
}

/** 组上下文段（buildGroupContextPrompt 的输出示例） */
const GROUP_CONTEXT_EXAMPLE =
  '## 当前会话组上下文\n' +
  '\n' +
  '**组**：<组标题 或 未命名组（创建于 …）>\n' +
  '\n' +
  '遇到不清楚的背景，可以先看看共享区有没有相关文件（ListGroupFiles）。';

/**
 * 收集当前所有「系统级 append 段」的模板与触发说明，供设置页展示。
 */
export function getSystemPromptSegments(): SystemPromptSegment[] {
  return [
    {
      key: 'group-context',
      label: '会话组上下文（模板说明）',
      category: 'group',
      template: GROUP_CONTEXT_EXAMPLE,
      triggerDescription: '会话属于某个组时注入。列出组标题，引导 Agent 用 ListGroupFiles 按需查看共享区文件。',
      isDynamic: true,
    },
    {
      key: 'notes-guidance',
      label: '共享区阶段总结引导',
      category: 'notes',
      template: NOTES_GUIDANCE_APPEND,
      triggerDescription: '仅主会话 + 绑定了工作区时注入。引导 Agent 在阶段告一段落时主动写 `shared/_notes/` 阶段总结。',
      isDynamic: false,
    },
    {
      key: 'memory-guidance',
      label: '记忆系统使用规范',
      category: 'memory',
      template: MEMORY_GUIDANCE_APPEND,
      triggerDescription: '仅主会话 + 绑定了工作区时注入。引导 Agent 只记长期价值信息、讨论相关话题时先 RecallMemory 查询。',
      isDynamic: false,
    },
    {
      key: 'sub-agent-contract',
      label: '子会话交付契约',
      category: 'sub-agent',
      template: subAgentContractFor({ task: '<任务描述>', outputPath: '<交付路径>' }),
      triggerDescription: '仅子会话（role=\'sub\'）注入。给子 agent 明确任务、建议交付路径，以及交付流程。',
      isDynamic: true,
    },
    {
      key: 'main-agent-delegation',
      label: '主会话协作规范 + 子会话 Profile 索引',
      category: 'sub-agent',
      template: MAIN_AGENT_DELEGATION_APPEND + '\n\n' + buildSubAgentProfileIndex([createDefaultSubAgentProfile()]),
      triggerDescription: '仅主会话（role=\'main\'）且属于某个会话组时注入。告诉主 agent 派遣子会话后必须 WaitForMessage 挂起等待交付，并列出可用的子会话 Profile 供选择。',
      isDynamic: false,
    },
  ];
}
