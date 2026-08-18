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
  '- 讨论用户可能已有偏好的话题时，先 dogear__RecallMemory 查一下有没有相关记忆';

/** 主会话协作规范（仅 role='main' 且有 groupId 时注入）。 */
export const MAIN_AGENT_DELEGATION_APPEND =
  '\n## 主会话与子会话协作规范\n' +
  '用 dogear__CreateSession 派遣子会话后，必须紧接着调用 dogear__WaitForMessage 挂起等待，不要在创建后直接结束本轮——否则子会话的交付无人接收。\n' +
  'outputPath 是会话组共享区里的路径，不是工作区路径；task 里不要再指示子会话把交付文档写到工作区其他位置，交付物一律经共享区传递。';

/**
 * 生成可用的子会话 Profile 索引（仅主会话注入，让模型按描述选择 profile 参数）。
 */
export function buildSubAgentProfileIndex(profiles: SubAgentProfile[]): string {
  const visible = profiles.filter((p) => p.enabled !== false);
  if (visible.length === 0) {
    return (
      '\n## 可用的子会话 Profile\n' +
      '派遣子会话时可通过 profile 参数选择合适的 Profile（不指定时用「默认」）。'
    );
  }
  const rows = visible.map((p) => `| ${p.name} | ${p.description} |`).join('\n');
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
    `**交付路径**：${outputPath}——用 dogear__SaveSharedNote 把完整交付内容写到共享区这个路径，dogear__SendMessage 里只放摘要通知\n\n` +
    `**产出位置默认规则**：任务未明确指定文件位置时，产出的新文件（交付文档、报告、中间产物）一律用 dogear__SaveSharedNote 写到共享区；只有任务明确要求修改项目文件时才写工作区路径\n\n` +
    `**交付流程**：完成后用 dogear__SendMessage 向派出你的会话交付结果（delivery: true）；有歧义时先反问，不要瞎猜。你不能派遣孙子会话。`
  );
}

/** 组上下文段（buildGroupContextPrompt 的输出示例） */
const GROUP_CONTEXT_EXAMPLE =
  '## 当前会话组上下文\n' +
  '\n' +
  '**组**：<组标题 或 未命名组（创建于 …）>\n' +
  '\n' +
  '共享区是会话组内跨会话传递文件的区域。遇到不清楚的背景，先看看共享区有没有相关文件（dogear__ListGroupFiles）。\n' +
  '当某个阶段告一段落或上下文用量较高时，可以主动写一份阶段总结到共享区（dogear__SaveSharedNote），方便下次接续或组卡提炼。这不是强制——只在你判断有价值时做。';

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
      triggerDescription: '会话属于某个组时注入。列出组标题，引导 Agent 用 dogear__ListGroupFiles 按需查看共享区文件。',
      isDynamic: true,
    },
    {
      key: 'memory-guidance',
      label: '记忆系统使用规范',
      category: 'memory',
      template: MEMORY_GUIDANCE_APPEND,
      triggerDescription: '仅主会话 + 绑定了工作区时注入。引导 Agent 只记长期价值信息、讨论相关话题时先 dogear__RecallMemory 查询。',
      isDynamic: false,
    },
    {
      key: 'sub-agent-contract',
      label: '子会话交付契约',
      category: 'sub-agent',
      template: subAgentContractFor({ task: '<任务描述>', outputPath: '<交付路径>' }),
      triggerDescription: '仅子会话（role=\'sub\'）注入。给子 agent 明确任务、交付路径，以及交付流程。',
      isDynamic: true,
    },
    {
      key: 'main-agent-delegation',
      label: '主会话协作规范 + 子会话 Profile 索引',
      category: 'sub-agent',
      template: MAIN_AGENT_DELEGATION_APPEND + '\n\n' + buildSubAgentProfileIndex([createDefaultSubAgentProfile()]),
      triggerDescription: '仅主会话（role=\'main\'）且属于某个会话组时注入。告诉主 agent 派遣子会话后必须 dogear__WaitForMessage 挂起等待交付，并列出可用的子会话 Profile 供选择。',
      isDynamic: false,
    },
  ];
}
