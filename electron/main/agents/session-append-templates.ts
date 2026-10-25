/**
 * 会话系统提示词的「系统级 append 段」模板。
 *
 * 根据 main / sub 角色在会话启动时动态拼接行为约束。
 */

import type { SystemPromptSegment } from '../types.js';
import type { SubAgentProfile } from '../services/settings-types.js';
import { createDefaultSubAgentProfile } from '../services/settings-types.js';

export type SystemPromptSegmentKey =
  | 'memory-guidance'
  | 'notes-discipline'
  | 'git-history-guidance'
  | 'snapshot-safety-guidance'
  | 'shunt-guidance'
  | 'sub-agent-contract'
  | 'main-agent-delegation'
  | 'web-research-guidance'
  | 'extension-browser-discipline'
  | 'app-data-guidance'
  | 'unattended-mode'
  | 'low-freq-tool-guide';

/** 记忆系统使用规范（仅主会话 + 有工作区时注入）。 */
export const MEMORY_GUIDANCE_APPEND =
  '\n## 记忆系统\n' +
  '- 记忆是给未来 agent 用的「怎么做」知识，标准严苛：只有踩过的坑（非显而易见的根因与解法）、稳定的使用模式、影响未来实施判断的硬决策才够格\n' +
  '- 不进记忆：一次性实施/修复流水账（dogear/plans 和代码承载）、脑暴/思路/方案（用 dogear__CreateNote 存笔记卡片给用户）、尚未收敛的探索\n' +
  '- 开始实施/调研类任务前，先 dogear__RecallMemory 查相关坑与决策；讨论用户可能已有偏好的话题时同样先查\n' +
  '- 用户明确纠偏工作方式（"以后要/不要这样做"）且可长期适用时，用 dogear__SavePreference 沉淀进常驻偏好层（仅稳定习惯，一次性要求不收；写入前先 dogear__ListPreferences 查重）';

/** 主会话笔记存卡纪律（仅 role='main' 且有工作区时注入）。 */
export const NOTES_DISCIPLINE_APPEND =
  '\n## 笔记存卡纪律\n' +
  '- 笔记是用户的工作台与生命周期池：脑暴思路、未定型方案、待办、未决讨论、调研报告、用户明确要求记录的内容、琐事备忘进这里；状态流转用标签标记（如 待办 / 待议 / 已转入计划），多条待办可合一张卡（正文用 - [ ] 勾选项）；完全体可实施工作一律走任务（dogear__CreateTask，planPath 必传），不要为任务存笔记卡\n' +
  '- 与用户聊完方案后的动线：落盘设计文档（dogear/plans/...）→ 过「是否分步骤」判断 → dogear__CreateTask 挂到计划栏（planPath 必传，任务是完全体）→ 在回复中告知用户；方案未定型、待讨论的内容记笔记卡片（打状态标签），拍板落盘 plan 后才挂任务\n' +
  '- 是否分步骤判断：满足任一（改动跨 ≥3 文件且步骤有依赖 / 需跨会话续做 / 架构层变更）→ 先用 staged-impl 写实施计划（plan.md + stepN-*.md），CreateTask 的 planPath 指向 plan.md；都不满足 → 回复里明说「不分步骤，理由」——「不分」也是决策，不能默默跳过\n' +
  '- 执行动线：用户明确说做 → dogear__ExecuteTask（计划/待办均可入队）；完成后任务进待审核，执行过程就在执行会话里，无需再写结果摘要';

/**
 * 主会话低频能力导览：任务管理/Skill 管理/定时任务行按包生效拼装。
 * 行文案写「是什么+能干什么+搜索词」——这是 deferred 工具的发现性兜底（工具面不可见时模型靠 tool_search 自主加载），不复述挂载机制。
 */
export function buildLowFreqToolGuide(packs: { tasks: boolean; skillAdmin: boolean; scheduler: boolean }): string {
  const rows: string[] = [];
  if (packs.tasks) {
    rows.push(
      '- 任务管理 dogear__CreateTask / dogear__ListTasks / dogear__ExecuteTask：把定稿方案挂上计划栏、查看与推进执行；需要时用 tool_search 搜「task」加载',
    );
  }
  if (packs.skillAdmin) {
    rows.push(
      '- Skill 管理 dogear__SaveSkill / dogear__ListCustomSkills / dogear__GetSkill：保存、查看、清除用户沉淀的自定义 skill；需要时用 tool_search 搜「skill」加载',
    );
  }
  if (packs.scheduler) {
    rows.push(
      '- 定时任务 dogear__ListScheduledTasks / dogear__CreateScheduledTask / dogear__RunScheduledTaskNow：把重复性工作（每日简报、定期巡检、事件后续）交给系统按触发规则自动运行，可手动触发并查运行历史；需要时用 tool_search 搜「定时任务」或「scheduled」加载',
    );
  }
  if (rows.length === 0) return '';
  return '\n## 低频能力导览\n' + rows.join('\n');
}

/** 主会话协作规范（仅 role='main' 且有 groupId 时注入）。 */
export const MAIN_AGENT_DELEGATION_APPEND =
  '\n## 主会话与子会话协作规范\n' +
  '用 dogear__CreateSession 派遣子会话后，输出简短收尾语直接结束回合；子会话的交付/回复/终态会作为新消息自动唤醒你，无需调用任何等待工具。\n' +
  'outputPath 是会话组共享区里的路径，不是工作区路径，可省略（省略 = 通讯型交付，答案直接放交付消息正文）；指定了 outputPath 时，task 里不要再指示子会话把交付文档写到工作区其他位置，文件类交付物一律经共享区传递。\n' +
  '交付以收到子会话的 delivery 消息为准（送达事实）；是否合格由你验收判断（见下方「验收闭环」）。应用重启后运行时状态不保留，重启前已交付的子会话会重新显示为未交付——此时以你的上下文记忆和共享区文件为准，不要盲目重派。\n' +
  '看共享区用 dogear__ListGroupFiles：不带参数列文件清单，传 relPath 读单个文件的完整内容。\n' +
  '某个阶段告一段落或上下文用量较高时，可主动写一份阶段总结到共享区（dogear__SaveSharedNote）方便下次接续——不强制，只在你判断有价值时做。\n' +
  '重启或中断后，用 dogear__ResumeSession 调起之前 stopped 且未交付的子会话继续（保留消息历史，它会自检进度从中断处续跑），而不是重新 CreateSession。\n' +
  '\n### 派遣成本判断\n' +
  '决定是否派子会话先算成本：探索类任务（要读 ≥2 个不熟悉的文件、需 ≥3 轮搜索迭代、或回答「在哪里/怎么实现」类问题）→ 派子会话，主会话只看摘要；已知文件路径的单点查询、改一两行 → 主会话直接做，子会话有启动开销；不为「用子会话」而拆分本可一次做完的任务\n' +
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
  '- 出方案或动手前先查 git 历史看做过什么、怎么演变：dogear__GitLog（按 relPath/keyword 搜提交）、dogear__GitShow 看某次提交细节、dogear__GitBlame 看归属、dogear__GitStatus/GitDiff 看当前未提交改动——git 历史是既有事实的佐证，避免重复造轮子或推翻既有设计\n' +
  '- 产出定稿后用 dogear__GitCommit 落一笔（message 写清做了什么与为什么）\n' +
  '- 边界：无 push/pull 等远端操作；GitRevert 是破坏性操作会先征得用户确认';

/** 快照安全网（workspace-snapshot 包生效即注入，主/子会话）。 */
export const SNAPSHOT_SAFETY_GUIDANCE_APPEND =
  '\n## 快照安全网\n' +
  '- 自动快照是编辑安全网：Write/Edit 与 UI 文件操作后系统自动打快照（含被 .gitignore 的私人文件），放心改\n' +
  '- 改坏了用 dogear__GitSnapshotList 查、dogear__GitSnapshotRestore 恢复；恢复前自动打 pre-restore 快照，永远可逆\n' +
  '- 快照有保留窗口会过期（默认近 7 天全留、30 天外丢弃），正式历史请用 git 提交（工作区有仓库时）';

/** 主会话岔题分流引导（shunt 包：仅 role='main' 且有工作区且有组时注入；执行会话不注入）。 */
export const SHUNT_GUIDANCE_APPEND =
  '\n## 岔题分流建议\n' +
  '- 识别岔题或用户口头要求分流时（「帮我另起会话聊 X」「另起一个话题」「先记下来」），在回复末尾输出 shunt-suggestions 建议卡（fenced JSON，语言标签 shunt-suggestions），格式严格如下：\n' +
  '```shunt-suggestions\n{"summary":"<岔题一句话摘要，自含且≤60字>","options":["new-session","new-topic","note"]}\n```\n' +
  '- options 从三个动作里选合适的子集（1~3 个）：new-session=在本话题组另起会话、new-topic=另起新话题、note=记为笔记\n' +
  '- 用户点卡后由代码直接创建（会话/话题/笔记），agent 不执行创建、不写回执、继续当前话题——会话结构变更没有任何工具可调，也不要在后续回复里复述分流结果\n' +
  '- 克制：正常工作消息不输出建议卡；一条回复最多一个；summary 要短且自含（用户点按钮后不依赖对话上下文即可分流）\n' +
  '- 建议卡必须位于回复最末尾，JSON 独占块内正文，块外不加修饰';

/** 主会话联网调研分工（web-mcp / browser / browser-extension 包任一生效，仅 role='main' 注入）。 */
export const WEB_RESEARCH_GUIDANCE_MAIN_APPEND =
  '\n## 联网调研分工\n' +
  '- 快档直查：检索与静态文章直接用 bigmodel__webSearch / bigmodel__webReader（API 直出），不派会话\n' +
  '- 深度浏览（翻页拼接、JS 渲染、页面交互、登录态）派「浏览器解析」子会话（profile: browser-parse），扩展通道全局独占、并行调研请串行派遣\n' +
  '- 网页文章入库与摘要（含用户「发送到 Dogear」移交的链接）：先 dogear__SaveArticle 服务端管线，静态解析失败或需登录态/JS 渲染时派「浏览器解析」子会话；入库后返回的是文件路径，读取全文用 Read 读该路径，检索用 Grep/Glob\n' +
  '- 纯本地代码/文档调研派普通子会话，不占扩展独占通道';

/** 子会话联网调研分工（同触发条件，仅 role='sub' 注入）；子会话不能派单，不出现派遣指引。 */
export const WEB_RESEARCH_GUIDANCE_SUB_APPEND =
  '\n## 联网调研分工\n' +
  '- 快档优先：检索与静态文章用 bigmodel__webSearch / bigmodel__webReader（API 直出）\n' +
  '- 需 JS 渲染、页面交互或登录态时用本会话扩展通道工具（dogear__extension__*，用户真实浏览器）';

/** 扩展通道常驻纪律（browser-extension 包生效的子会话注入；主会话不注入——主会话只有派遣视角，不做页面操作）。 */
export const EXTENSION_BROWSER_DISCIPLINE_APPEND =
  '\n## 扩展通道纪律\n' +
  '- 登录墙/验证墙：等待卡弹出后交给用户处理，不轮询不重试；用户跳过则换来源，并在交付中如实说明该站未获取\n' +
  '- tab 生命周期：单会话最多 16 个标签页，超限先 close_tab 释放；交付前关闭纯过程页，需留观的成果页让用户右键「发送到 Dogear」移交（移交过的页豁免收尾清理）\n' +
  '- 风控预算：调用变慢、被拒是站点保护，不绕过不硬闯；同一页面连续 3 次失败即停，换路径或换源\n' +
  '- 站点档案：工具返回带档案指针时先调 dogear__extension__site_knowledge 读已知地图；探索出的新发现用 dogear__extension__site_finding 沉淀，交付前写入\n' +
  '- 交付：明确告诉用户去哪个标签页看什么';

/** 无人值守模式（系统行为，不归能力包；装配条件 = settings.ai.unattended）：行为契约告知 */
export const UNATTENDED_MODE_APPEND =
  '\n## 无人值守模式\n' +
  '- 用户不在电脑前，不会响应任何确认请求：权限确认已由系统自动放行，浏览器人工介入（登录墙/验证墙等）会被自动跳过\n' +
  '- 遇到需要人工介入的步骤不要原地等待或反复重试，直接自主决策换路：换数据源、降级方案或跳过该步骤\n' +
  '- 收尾报告写清三件事：实际做了什么、跳过了什么（及原因）、还有什么需要用户回来后确认';

/** 应用数据目录认知（系统行为，固定注入每个会话）：定位 + 禁写区 */
export function buildAppDataGuidance(configDir: string, workspaceId: string): string {
  return (
    '\n## 应用数据目录\n' +
    `应用数据目录 ${configDir}（绝对路径）已挂载进会话文件边界：settings.json 是应用设置与子会话 Profile/能力开关，定时任务存 plans.json，本工作区配置在 workspaces/${workspaceId}/config.json。\n` +
    'notes/、memory/、tasks.json 等应用数据由 dogear__* 工具统一管理，直接写文件会被禁写区拦截，一律走工具。'
  );
}

/**
 * 收集当前所有「系统级 append 段」的模板与触发说明，供设置页展示。
 */
export function getSystemPromptSegments(): (SystemPromptSegment & { key: SystemPromptSegmentKey })[] {
  return [
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
      triggerDescription: '仅主会话 + 绑定了工作区时注入。笔记是用户工作台与生命周期池（脑暴思路/未定型方案/待办/调研底稿，状态流转用标签标记）；完全体可实施工作一律走任务——聊完方案落设计文档、过「是否分步骤」判断后 CreateTask 挂计划栏（planPath 必传），执行用 ExecuteTask，完成后申报进待审核。任务执行会话跳过本段。',
      isDynamic: false,
    },
    {
      key: 'low-freq-tool-guide',
      label: '低频能力导览',
      category: 'tool-guide',
      template: buildLowFreqToolGuide({ tasks: true, skillAdmin: true, scheduler: true }),
      triggerDescription: 'notes / skill-admin / scheduler 包任一生效的主会话注入（任务执行会话不注入），行按包生效拼装：任务管理（notes 包）、Skill 管理（skill-admin 包）、定时任务（scheduler 包）各一行，写明是什么、能干什么、tool_search 搜索词。这是低频工具不随请求下发时的发现性兜底目录。',
      isDynamic: true,
    },
    {
      key: 'git-history-guidance',
      label: 'git 历史意识',
      category: 'tool-guide',
      template: GIT_HISTORY_GUIDANCE_APPEND,
      triggerDescription: '「git 历史与提交」包开 + 会话绑定工作区且路径下有 .git 时注入（主/子会话均含，任务执行会话同样生效）。出方案/动手前先用 GitLog/GitShow/GitBlame 查既有实现与演变，产出定稿用 GitCommit 落库；声明「无远端操作」与 GitRevert 需确认的边界。',
      isDynamic: false,
    },
    {
      key: 'snapshot-safety-guidance',
      label: '快照安全网',
      category: 'tool-guide',
      template: SNAPSHOT_SAFETY_GUIDANCE_APPEND,
      triggerDescription: '「快照安全网」包开 + 绑定工作区时注入（主/子会话均含，任务执行会话同样生效）。声明自动快照安全网语义：Write/Edit 与 UI 文件操作后自动打快照（含 .gitignore 私人文件），改坏了用 GitSnapshotList/GitSnapshotRestore 查询恢复、永远可逆；快照有保留窗口会过期，正式历史走 git 提交。',
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
      triggerDescription: '「会话分流」包开 + 仅主会话 + 绑定了工作区 + 属于组时注入（任务执行会话不注入）。识别岔题或用户口头要求分流时，在回复末尾输出 shunt-suggestions fenced JSON 建议卡（summary + options 三动作子集），前端渲染为建议卡；用户点卡后由前端代码直接创建（会话/话题/笔记），无 agent 执行环节——不执行创建、不写回执，也没有任何分流工具挂载。',
      isDynamic: false,
    },
    {
      key: 'web-research-guidance',
      label: '联网调研分工',
      category: 'tool-guide',
      template: WEB_RESEARCH_GUIDANCE_MAIN_APPEND,
      triggerDescription: 'web-mcp / browser-extension 包任一生效时按会话角色注入：主会话版含派遣动线（快档直查 → 派「浏览器解析」子会话 → 本地调研派普通子会话）；子会话版精简两行（快档优先 + 扩展通道工具指向），不出现派单指引。',
      isDynamic: false,
    },
    {
      key: 'extension-browser-discipline',
      label: '扩展通道纪律',
      category: 'tool-guide',
      template: EXTENSION_BROWSER_DISCIPLINE_APPEND,
      triggerDescription: '「浏览器扩展」包生效且挂载扩展工具的子会话注入（主会话不注入，主会话只有派遣视角）。五条：登录墙语义（弹卡等用户，不轮询）、tab 生命周期（16 上限，交付前过程页关闭成果页移交）、风控预算（被拒是保护，同页 3 败即停）、站点档案（site_knowledge 先读 / site_finding 沉淀）、交付指明标签页。',
      isDynamic: false,
    },
    {
      key: 'unattended-mode',
      label: '无人值守模式',
      category: 'reference',
      template: UNATTENDED_MODE_APPEND,
      triggerDescription: '系统行为，无人值守开关（settings.ai.unattended）开启时注入每个会话（主/子/执行会话均含，不归能力包）。告知用户不在电脑前：权限确认已自动放行、人工介入会被跳过，遇到需人工的步骤自主换路（换源/降级/跳过），收尾报告写清做了什么/跳过了什么/待确认项。开关切换不重注入运行中会话，仅新会话生效。',
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
