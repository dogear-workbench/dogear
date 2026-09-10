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
  '- 记忆是给未来 agent 用的「怎么做」知识，标准严苛：只有踩过的坑（非显而易见的根因与解法）、稳定的使用模式、影响未来实施判断的硬决策才够格\n' +
  '- 不进记忆：一次性实施/修复流水账（docs/plans 和代码承载）、脑暴/思路/方案（用 dogear__CreateNote 存笔记卡片给用户）、尚未收敛的探索\n' +
  '- 讨论用户可能已有偏好的话题时，先 dogear__RecallMemory 查一下有没有相关记忆';

/** 主会话笔记存卡纪律（仅 role='main' 且有工作区时注入）。 */
export const NOTES_DISCIPLINE_APPEND =
  '\n## 笔记存卡纪律\n' +
  '- 笔记是用户的工作台：脑暴思路、用户明确要求记录的内容、琐事备忘（正文用 - [ ] 勾选项）进这里；可实施工作一律走任务（dogear__CreateTask），不要为任务存笔记卡\n' +
  '- 与用户聊完方案后的动线：落盘设计文档（docs/plans/...）→ 过「是否分步骤」判断 → dogear__CreateTask 挂到计划栏 → 在回复中告知用户；方案未定型、想先记一笔时 CreateTask 可省略 planPath 占位，文档落盘后同标题再调一次自动补路径\n' +
  '- 是否分步骤判断：满足任一（改动跨 ≥3 文件且步骤有依赖 / 需跨会话续做 / 架构层变更）→ 先用 staged-impl 写实施计划（plan.md + stepN-*.md），CreateTask 的 planPath 指向 plan.md；都不满足 → 回复里明说「不分步骤，理由」——「不分」也是决策，不能默默跳过\n' +
  '- 执行动线：用户明确说做 → dogear__ExecuteTask（计划/待办均可入队）；执行结果摘要由系统自动写回任务详情，无需 dogear__AppendNote';

/** 主会话协作规范（仅 role='main' 且有 groupId 时注入）。 */
export const MAIN_AGENT_DELEGATION_APPEND =
  '\n## 主会话与子会话协作规范\n' +
  '用 dogear__CreateSession 派遣子会话后，输出简短收尾语直接结束回合；子会话的交付/回复/终态会作为新消息自动唤醒你，无需调用任何等待工具。\n' +
  'outputPath 是会话组共享区里的路径，不是工作区路径，可省略（省略 = 通讯型交付，答案直接放交付消息正文）；指定了 outputPath 时，task 里不要再指示子会话把交付文档写到工作区其他位置，文件类交付物一律经共享区传递。\n' +
  '交付以收到子会话的 delivery 消息为准（送达事实）；是否合格由你验收判断（见下方「验收闭环」）。应用重启后运行时状态不保留，重启前已交付的子会话会重新显示为未交付——此时以你的上下文记忆和共享区文件为准，不要盲目重派。\n' +
  '看共享区用 dogear__ListGroupFiles：不带参数列文件清单，传 relPath 读单个文件的完整内容。\n' +
  '重启或中断后，用 dogear__ResumeSession 调起之前 stopped 且未交付的子会话继续（保留消息历史，它会自检进度从中断处续跑），而不是重新 CreateSession。\n' +
  '\n### 子会话复用判断\n' +
  '需要子会话继续做事时，先判断复用原子会话还是新派：\n' +
  '- 追问深挖（调研结果展开、验证结论）→ 优先原子会话，它的上下文还在\n' +
  '- 失败/超时 → 先向原子会话发消息查询情况，它对自己的进度最清楚；盲目重派会丢掉已积累的上下文\n' +
  '- 新任务与原子会话上下文无关（如一次性实施已完成）→ 新派\n' +
  '- 追问链已很长、上下文价值稀释（auto-compact 有损压缩累积损耗）→ 换新会话从共享区产出起步\n' +
  '\n### 验收闭环\n' +
  '收到交付 ≠ 接受交付。读交付物（共享区文件或消息正文），对照任务目标检查，三分支处理：合格 → 接受，继续主线；有缺口 → 用 dogear__SendMessage 向原子会话追问返工（已停机会话会自动调起，消息不会丢失）；方向全错 → 重派新会话。'

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

/** 子会话交付契约（仅 role='sub' 注入）；outputPath 为空 = 通讯型交付，不渲染「交付路径」行。 */
export function subAgentContractFor(opts: { task: string; outputPath: string }): string {
  const { task, outputPath } = opts;
  const hasPath = outputPath.trim().length > 0;
  const deliveryShape = hasPath
    ? `**交付路径**：${outputPath}——复杂产出（报告/代码改动说明）用 dogear__SaveSharedNote 把完整交付内容写到共享区这个路径，dogear__SendMessage 里只放摘要通知；简单问答/验证类可直接在交付消息正文交付\n\n`
    : `**交付形态**：未指定交付文件，交付内容直接写在交付消息正文（dogear__SendMessage）\n\n`;
  return (
    `\n## 你是一个被派遣的子会话\n` +
    `**任务**：${task}\n\n` +
    deliveryShape +
    `**共享区已有产出**：需要了解背景时用 dogear__ListGroupFiles 列共享区文件清单，传 relPath 读单个文件内容。\n\n` +
    `**产出位置默认规则**：任务未明确指定文件位置时，产出的新文件（交付文档、报告、中间产物）一律用 dogear__SaveSharedNote 写到共享区；只有任务明确要求修改项目文件时才写工作区路径\n\n` +
    `**交付流程**：完成后用 dogear__SendMessage 向派出你的会话交付结果（delivery: true）。交付消息须结构化自述：目标达成情况 / 未完成或跳过部分 / caveats / 交付物形态与位置（共享区 xxx.md 或本消息正文）。有歧义时先反问，不要瞎猜。你不能派遣孙子会话。`
  );
}

/** 组上下文段（buildGroupContextPrompt 的输出示例） */
const GROUP_CONTEXT_EXAMPLE =
  '## 当前会话组上下文\n' +
  '\n' +
  '**组**：<组标题 或 未命名组（创建于 …）>\n' +
  '\n' +
  '共享区是会话组内跨会话传递文件的区域。遇到不清楚的背景，先用 dogear__ListGroupFiles 列共享区文件清单，需要细看时传 relPath 读单个文件。\n' +
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
      triggerDescription: '会话属于某个组时注入。列出组标题，引导 Agent 用 dogear__ListGroupFiles 列共享区文件清单、传 relPath 按需读单个文件。',
      isDynamic: true,
    },
    {
      key: 'memory-guidance',
      label: '记忆系统使用规范',
      category: 'memory',
      template: MEMORY_GUIDANCE_APPEND,
      triggerDescription: '仅主会话 + 绑定了工作区时注入。记忆标准严苛（踩坑/稳定模式/硬决策），脑暴思路走笔记；讨论相关话题时先 dogear__RecallMemory 查询。',
      isDynamic: false,
    },
    {
      key: 'notes-discipline',
      label: '笔记存卡纪律',
      category: 'notes',
      template: NOTES_DISCIPLINE_APPEND,
      triggerDescription: '仅主会话 + 绑定了工作区时注入。笔记是用户工作台（脑暴思路/琐事备忘）；可实施工作一律走任务——聊完方案落设计文档、过「是否分步骤」判断后 CreateTask 挂计划栏（可省略 planPath 占位），执行用 ExecuteTask，结果系统自动写回。',
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
      triggerDescription: '仅主会话（role=\'main\'）且属于某个会话组时注入。告诉主 agent 派遣子会话后结束回合即可，交付/终态作为新消息自动唤醒，并列出可用的子会话 Profile 供选择。',
      isDynamic: false,
    },
  ];
}
