/**
 * 会话系统提示词的「系统级 append 段」模板。
 *
 * 根据 main / sub 角色和组上下文，在会话启动时动态拼接行为约束。
 */

import type { SystemPromptSegment } from '../types.js';
import type { SubAgentProfile } from '../services/settings-types.js';
import { createDefaultSubAgentProfile } from '../services/settings-types.js';

export type SystemPromptSegmentKey =
  | 'group-context'
  | 'memory-guidance'
  | 'notes-discipline'
  | 'git-history-guidance'
  | 'shunt-guidance'
  | 'sub-agent-contract'
  | 'main-agent-delegation'
  | 'web-research-guidance'
  | 'app-data-guidance';

/** 记忆系统使用规范（仅主会话 + 有工作区时注入）。 */
export const MEMORY_GUIDANCE_APPEND =
  '\n## 记忆系统\n' +
  '- 记忆是给未来 agent 用的「怎么做」知识，标准严苛：只有踩过的坑（非显而易见的根因与解法）、稳定的使用模式、影响未来实施判断的硬决策才够格\n' +
  '- 不进记忆：一次性实施/修复流水账（docs/plans 和代码承载）、脑暴/思路/方案（用 dogear__CreateNote 存笔记卡片给用户）、尚未收敛的探索\n' +
  '- 讨论用户可能已有偏好的话题时，先 dogear__RecallMemory 查一下有没有相关记忆';

/** 主会话笔记存卡纪律（仅 role='main' 且有工作区时注入）。 */
export const NOTES_DISCIPLINE_APPEND =
  '\n## 笔记存卡纪律\n' +
  '- 笔记是用户的工作台与生命周期池：脑暴思路、未定型方案、待办、未决讨论、调研报告、用户明确要求记录的内容、琐事备忘进这里；状态流转用标签标记（如 待办 / 待议 / 已转入计划），多条待办可合一张卡（正文用 - [ ] 勾选项）；完全体可实施工作一律走任务（dogear__CreateTask，planPath 必传），不要为任务存笔记卡\n' +
  '- 与用户聊完方案后的动线：落盘设计文档（docs/plans/...）→ 过「是否分步骤」判断 → dogear__CreateTask 挂到计划栏（planPath 必传，任务是完全体）→ 在回复中告知用户；方案未定型、待讨论的内容记笔记卡片（打状态标签），拍板落盘 plan 后才挂任务\n' +
  '- 是否分步骤判断：满足任一（改动跨 ≥3 文件且步骤有依赖 / 需跨会话续做 / 架构层变更）→ 先用 staged-impl 写实施计划（plan.md + stepN-*.md），CreateTask 的 planPath 指向 plan.md；都不满足 → 回复里明说「不分步骤，理由」——「不分」也是决策，不能默默跳过\n' +
  '- 执行动线：用户明确说做 → dogear__ExecuteTask（计划/待办均可入队）；执行结果摘要由系统自动写回任务详情，无需 dogear__AppendNote';

/** 主会话协作规范（仅 role='main' 且有 groupId 时注入）。 */
export const MAIN_AGENT_DELEGATION_APPEND =
  '\n## 主会话与子会话协作规范\n' +
  '用 dogear__CreateSession 派遣子会话后，输出简短收尾语直接结束回合；子会话的交付/回复/终态会作为新消息自动唤醒你，无需调用任何等待工具。\n' +
  'outputPath 是会话组共享区里的路径，不是工作区路径，可省略（省略 = 通讯型交付，答案直接放交付消息正文）；指定了 outputPath 时，task 里不要再指示子会话把交付文档写到工作区其他位置，文件类交付物一律经共享区传递。\n' +
  '交付以收到子会话的 delivery 消息为准（送达事实）；是否合格由你验收判断（见下方「验收闭环」）。应用重启后运行时状态不保留，重启前已交付的子会话会重新显示为未交付——此时以你的上下文记忆和共享区文件为准，不要盲目重派。\n' +
  '看共享区用 dogear__ListGroupFiles：不带参数列文件清单，传 relPath 读单个文件的完整内容。\n' +
  '某个阶段告一段落或上下文用量较高时，可主动写一份阶段总结到共享区（dogear__SaveSharedNote）方便下次接续——不强制，只在你判断有价值时做。\n' +
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
    '派遣子会话时通过 profile 参数选择合适的 Profile（不指定时用「默认」）。选择动线：先判断任务是否要改工作区文件（动=默认）；调研类再按对象分——网页/文章库=浏览器解析，本地代码与文档=探索。\n\n' +
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
    ? `**交付路径**：${outputPath}——复杂产出（报告/代码改动说明）用 dogear__SaveSharedNote 把完整交付内容写到共享区这个路径（文件名会自动补当天 YYYYMMDD- 日期前缀，以工具返回的实际路径为准），dogear__SendMessage 里只放摘要通知；简单问答/验证类可直接在交付消息正文交付\n\n`
    : `**交付形态**：未指定交付文件，交付内容直接写在交付消息正文（dogear__SendMessage）\n\n`;
  return (
    `\n## 你是一个被派遣的子会话\n` +
    `**任务**：${task}\n\n` +
    deliveryShape +
    `**共享区已有产出**：需要了解背景时用 dogear__ListGroupFiles 列共享区文件清单，传 relPath 读单个文件内容。\n\n` +
    `**产出位置默认规则**：任务未明确指定文件位置时，产出的新文件（交付文档、报告、中间产物）一律用 dogear__SaveSharedNote 写到共享区；只有任务明确要求修改项目文件时才写工作区路径。某个阶段告一段落或上下文用量较高时，也可主动写一份阶段总结到共享区方便下次接续——不强制，只在你判断有价值时做\n\n` +
    `**交付流程**：完成后用 dogear__SendMessage 向派出你的会话交付结果（delivery: true）。交付消息须结构化自述：目标达成情况 / 未完成或跳过部分 / caveats / 交付物形态与位置（共享区 xxx.md 或本消息正文）。有歧义时先反问，不要瞎猜。你不能派遣孙子会话。`
  );
}

/** git 历史意识（workspace-git 包生效即注入，主/子会话）。 */
export const GIT_HISTORY_GUIDANCE_APPEND =
  '\n## git 历史意识\n' +
  '- 出方案或改代码前，先查工作区 git 历史再动手：dogear__GitLog（按 relPath/keyword 搜提交）看功能演变与既有实现，dogear__GitShow 看某次提交细节，dogear__GitBlame 看代码归属，dogear__GitStatus/GitDiff 看当前未提交改动——避免重复造轮子或推翻既有设计\n' +
  '- 双层语义：用户 Git 仓库（GitStatus/GitDiff/GitLog/GitShow/GitBlame/GitCommit/GitRevert）是正式历史，产出定稿后用 dogear__GitCommit 落一笔（message 写清做了什么）；自动快照（GitSnapshotList/GitSnapshotRestore）是系统安全网，Write/Edit 与文件操作后自动保存（含被 .gitignore 的文件），改坏了用 SnapshotRestore 恢复，恢复前自动再打快照、永远可逆\n' +
  '- 边界：无 push/pull 等远端操作；GitRevert 是破坏性操作会先征得用户确认；工作区非 git 仓库或系统未装 git 时工具返回错误，属正常降级';

/** 主会话岔题分流引导（shunt 包：仅 role='main' 且有工作区且有组时注入；执行会话不注入）。 */
export const SHUNT_GUIDANCE_APPEND =
  '\n## 岔题分流建议\n' +
  '- 对话中出现值得单独处理但本轮不展开的新话题时——无论用户岔开（「另外我想到…」「顺便问下」「以后能不能支持…」）还是你主动搁置（「这是另一个话题，下次单独讨论」）——在搁置发生的那条回复末尾追加一个建议块（fenced JSON，语言标签 shunt-suggestions），格式严格如下：\n' +
  '```shunt-suggestions\n{"summary":"<岔题一句话摘要，自含且≤60字>","options":["new-session","new-topic","note"]}\n```\n' +
  '- options 从三个动作里选合适的子集（1~3 个）：new-session=在本话题组另起会话、new-topic=另起新话题、note=记为笔记；按当前可用工具裁剪（CreateNote 未注册时不再提供 note 选项）\n' +
  '- 克制：正常工作消息不输出建议块；一条回复最多一个；summary 要短且自含（用户点按钮后不依赖对话上下文即可分流）\n' +
  '- 用户明确说「另开一个」「先记下来」类意图时不必输出建议块，正常回应；分流动作只由用户点建议卡按钮触发，没有 <shunt> 标签你永不自行变更会话结构\n' +
  '- 建议块必须位于回复最末尾，JSON 独占块内正文，块外不加修饰\n' +
  '- 用户消息含 <shunt action="..." summary="...">用户补充</shunt> 标签时（用户已通过操作气泡确认执行），按 action 执行后简短回执（一两句），然后继续当前话题——不等待、不追问分流结果；new-session/new-topic 走 dogear__ForkSession，note 走 dogear__CreateNote（tags 含「分流暂存」）';

/** 主会话联网调研分工（web-mcp 或 browser 包任一生效，仅 role='main' 注入）。 */
export const WEB_RESEARCH_GUIDANCE_MAIN_APPEND =
  '\n## 联网调研分工\n' +
  '- 快档直查：检索与静态文章直接用 bigmodel__webSearch / bigmodel__webReader（API 直出），不派会话\n' +
  '- 深度浏览（翻页拼接、JS 渲染、页面交互、登录态）派「浏览器解析」子会话（profile: browser-parse），浏览器通道独占、并行调研请串行派遣\n' +
  '- 纯本地代码/文档调研派普通子会话，不占浏览器独占通道';

/** 子会话联网调研分工（同触发条件，仅 role='sub' 注入）；子会话不能派单，不出现派遣指引。 */
export const WEB_RESEARCH_GUIDANCE_SUB_APPEND =
  '\n## 联网调研分工\n' +
  '- 快档优先：检索与静态文章用 bigmodel__webSearch / bigmodel__webReader（API 直出）\n' +
  '- 需 JS 渲染、页面交互或登录态时用本会话 dogear__browser__* 工具';

/** 应用数据目录认知（系统行为，固定注入每个会话）：定位 + 禁写区 */
export function buildAppDataGuidance(configDir: string, workspaceId: string): string {
  return (
    '\n## 应用数据目录\n' +
    `应用数据目录 ${configDir}（绝对路径）已挂载进会话文件边界：settings.json 是应用设置与子会话 Profile/能力开关，定时任务存 plans.json，本工作区配置在 workspaces/${workspaceId}/config.json。\n` +
    'notes/、memory/、tasks.json 等应用数据由 dogear__* 工具统一管理，直接写文件会被禁写区拦截，一律走工具。'
  );
}

/** 组上下文段（buildGroupContextPrompt 的输出示例） */
const GROUP_CONTEXT_EXAMPLE =
  '## 当前会话组上下文\n' +
  '\n' +
  '**组**：<组标题 或 未命名组（创建于 …）>\n' +
  '\n' +
  '### 话题状态\n' +
  '【话题背景】（确立于 <时间>，<来源>）\n' +
  '<当前生效话题一句话>\n' +
  '【最近未提炼会话】\n' +
  '- <时间>「<会话标题>」\n' +
  '【指引】本会话属于上方话题。若用户消息缺少上下文、所指对象不明、或需接续历史脉络/查看进行中事项时，调 dogear__ReadGroupBackground 获取最新状态（存在未提炼会话时会自动同步，可能需等待；未提炼会话中可能有更晚的事实）；深挖某会话可 dogear__ReadReferenceSession。\n' +
  '（话题背景 / 最近未提炼会话两段按实际内容可选；组内无前人状态——无话题且除自己外无未提炼会话——时不注入【指引】，仅保留「本组还没有提炼过的话题状态，不要虚构。」一句）'

/**
 * 收集当前所有「系统级 append 段」的模板与触发说明，供设置页展示。
 */
export function getSystemPromptSegments(): (SystemPromptSegment & { key: SystemPromptSegmentKey })[] {
  return [
    {
      key: 'group-context',
      label: '会话组上下文（模板说明）',
      category: 'group',
      template: GROUP_CONTEXT_EXAMPLE,
      triggerDescription: '会话属于某个组且「会话组」包开时注入。内容 = 组头（组标题）+ 话题状态轻量头（生效话题、最近未提炼会话；组内有前人状态才含按需调 dogear__ReadGroupBackground 的指引，排除自己后无前人状态时不注入指引）。任务执行会话（无人值守）只注入组头，不含话题状态段。',
      isDynamic: true,
    },
    {
      key: 'memory-guidance',
      label: '记忆系统使用规范',
      category: 'memory',
      template: MEMORY_GUIDANCE_APPEND,
      triggerDescription: '仅主会话 + 绑定了工作区时注入（无工作区主会话现状兜底注册 memory 工具，工具注册不受此段开关约束）。记忆标准严苛（踩坑/稳定模式/硬决策），脑暴思路走笔记；讨论相关话题时先 dogear__RecallMemory 查询。',
      isDynamic: false,
    },
    {
      key: 'notes-discipline',
      label: '笔记存卡纪律',
      category: 'notes',
      template: NOTES_DISCIPLINE_APPEND,
      triggerDescription: '仅主会话 + 绑定了工作区时注入。笔记是用户工作台与生命周期池（脑暴思路/未定型方案/待办/调研底稿，状态流转用标签标记）；完全体可实施工作一律走任务——聊完方案落设计文档、过「是否分步骤」判断后 CreateTask 挂计划栏（planPath 必传），执行用 ExecuteTask，结果系统自动写回。任务执行会话跳过本段。',
      isDynamic: false,
    },
    {
      key: 'git-history-guidance',
      label: 'git 历史意识',
      category: 'tool-guide',
      template: GIT_HISTORY_GUIDANCE_APPEND,
      triggerDescription: '「git 版本管理」包开 + 会话绑定工作区时注入（主/子会话均含，任务执行会话同样生效）。出方案/改代码前先用 GitLog/GitShow/GitBlame 查既有实现与演变；声明用户 Git 仓库（正式历史）与自动快照（安全网）双层语义与「无远端操作」边界。',
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
    {
      key: 'shunt-guidance',
      label: '岔题分流建议',
      category: 'shunt',
      template: SHUNT_GUIDANCE_APPEND,
      triggerDescription: '「会话分流」包开 + 仅主会话 + 绑定了工作区 + 属于组时注入（任务执行会话不注入）。岔题时在回复末尾输出 shunt-suggestions fenced JSON 建议块（summary + options 三动作子集，按当前可用工具裁剪），前端渲染为建议卡；用户点卡插入操作气泡、发出后消息携带 <shunt> 标签，agent 才执行 dogear__ForkSession（new-session/new-topic）或 dogear__CreateNote（note，tag 分流暂存）并简短回执（Fork 回执含 dogear:// 会话跳转链接）。',
      isDynamic: false,
    },
    {
      key: 'web-research-guidance',
      label: '联网调研分工',
      category: 'tool-guide',
      template: WEB_RESEARCH_GUIDANCE_MAIN_APPEND,
      triggerDescription: 'web-mcp 或 browser 包任一生效时按会话角色注入：主会话版含派遣动线（快档直查 → 派「浏览器解析」子会话 → 本地调研派普通子会话）；子会话版精简两行（快档优先 + dogear__browser__* 备选），不出现派单指引。',
      isDynamic: false,
    },
    {
      key: 'app-data-guidance',
      label: '应用数据目录',
      category: 'reference',
      template: buildAppDataGuidance('<应用数据目录绝对路径>', '<workspaceId>'),
      triggerDescription: '系统行为，固定注入每个会话（主/子/任务执行会话均含，不可关闭；后台定时任务 headless 装配不注入）。声明应用数据目录绝对路径与文件边界、settings/plans/工作区配置位置、应用数据由工具管理（禁写区拦截直接写）。描述的挂载边界与禁写区机制由代码固定生效，本段仅作认知告知。',
      isDynamic: true,
    },
  ];
}
