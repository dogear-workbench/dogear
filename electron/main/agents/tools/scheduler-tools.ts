/**
 * 定时任务管理 agent 工具（dogear-scheduler 工具组，仅主会话）
 *
 * 管理动作（查看/创建/修改/删除/手动运行/查运行历史）全部归主会话；任务到点由系统后台派会话执行 prompt，与本组无关。
 * 服务层全复用薄封装：plan-store 读写、plan-validate 校验消毒、scheduler-service.runTaskManual、run-history-store 查询，不新造存储。
 */
import { z } from 'zod';
import type { CustomScheduledTask, RunHistoryEntry, ScheduledTask, Trigger } from '../../services/scheduler/types.js';
import { loadTasks, saveTasks } from '../../services/scheduler/plan-store.js';
import { queryHistory } from '../../services/scheduler/run-history-store.js';
import { describeTrigger, minNextDueAt } from '../../services/scheduler/time-rule-engine.js';
import { getSchedulerService } from '../../services/scheduler/scheduler-service.js';
import {
  KNOWN_TOOL_PACKS,
  assignTaskIds,
  mergeFiredState,
  sanitizeSkillsOverride,
  sanitizeToolPacksOverride,
  validateTaskForSave,
} from '../../services/scheduler/plan-validate.js';
import { getAll as getAllWorkspaces } from '../../services/workspace-json-service.js';
import { registerToolGroup } from './tool-registry.js';
import { defineTool, type ToolDef } from '../pi/tool-adapter.js';

function errorResult(text: string) {
  return { content: [{ type: 'text' as const, text }], isError: true as const };
}

function textResult(text: string) {
  return { content: [{ type: 'text' as const, text }] };
}

function formatTs(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const HHMM_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

const weekdaysSchema = z
  .array(z.number().int().min(0).max(6))
  .min(1)
  .describe('生效星期（0=周日..6=周六），省略=不限星期');

const windowSpecSchema = z.object({
  start: z.string().regex(HHMM_RE, '时间格式须为 HH:mm').describe('窗口开始时间 HH:mm'),
  end: z.string().regex(HHMM_RE, '时间格式须为 HH:mm').describe('窗口结束时间 HH:mm'),
  weekdays: weekdaysSchema.optional(),
});

const modelSelectionSchema = z.object({
  profileId: z.string().min(1).describe('模型供应商 Profile ID'),
  tier: z.string().min(1).describe('模型 ID（pi 请求体 model 字段）'),
  effort: z.enum(['off', 'low', 'medium', 'high', 'xhigh', 'max']).nullable().optional().describe('推理力度，省略=跟随模型预设'),
});

const triggerInputSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('daily_at'),
    at: z.string().regex(HHMM_RE, '时间格式须为 HH:mm').describe('每天触发时刻 HH:mm'),
    weekdays: weekdaysSchema.optional(),
  }).describe('每天固定时刻运行'),
  z.object({
    type: z.literal('monthly_at'),
    at: z.string().regex(HHMM_RE, '时间格式须为 HH:mm').describe('触发时刻 HH:mm'),
    daysOfMonth: z
      .array(z.union([z.number().int().min(1).max(31), z.literal('last')]))
      .min(1)
      .describe('几号触发（1-31 或 "last"=月末），可多选，重复无效'),
  }).describe('每月指定日期固定时刻运行'),
  z.object({
    type: z.literal('interval'),
    minutes: z.number().int().positive().describe('间隔分钟数（正整数）'),
    weekdays: weekdaysSchema.optional(),
  }).describe('固定间隔轮询运行'),
  z.object({
    type: z.literal('window'),
    start: z.string().regex(HHMM_RE, '时间格式须为 HH:mm').describe('窗口开始 HH:mm'),
    end: z.string().regex(HHMM_RE, '时间格式须为 HH:mm').describe('窗口结束 HH:mm'),
    weekdays: weekdaysSchema.optional(),
  }).describe('时间窗口开启时运行一次（支持 start>end 跨午夜窗口）'),
  z.object({
    type: z.literal('once'),
    at: z.number().int().positive().describe('触发时间戳（毫秒，须为未来时间，触发一次后不再运行）'),
  }).describe('指定时刻运行一次'),
  z.object({
    type: z.literal('on_window_close'),
    window: windowSpecSchema,
  }).describe('时间窗口关闭时运行一次'),
  z.object({
    type: z.literal('on_app_start'),
  }).describe('应用启动时运行'),
  z.object({
    type: z.literal('on_session_close'),
  }).describe('会话关闭时运行'),
  z.object({
    type: z.literal('on_task_done'),
    taskId: z.string().min(1).describe('上游定时任务 ID（其运行完成后触发本任务，不可构成循环）'),
  }).describe('上游任务完成后运行'),
]);

type TriggerInput = z.infer<typeof triggerInputSchema>;

const toStoredTrigger = (t: TriggerInput): Trigger => ({ ...t, id: '' }) as Trigger;

async function prepareTaskForSave(draft: ScheduledTask): Promise<ScheduledTask> {
  let prepared = assignTaskIds(draft);
  prepared = {
    ...prepared,
    toolPacksOverride: sanitizeToolPacksOverride(prepared),
    skillsOverride: await sanitizeSkillsOverride(prepared),
  };
  const [existing, workspaces] = await Promise.all([loadTasks(), getAllWorkspaces().catch(() => [])]);
  const isNew = !existing.some((t) => t.id === prepared.id);
  const allTasks = isNew ? [...existing, prepared] : existing.map((t) => (t.id === prepared.id ? prepared : t));
  const error = validateTaskForSave(prepared, {
    workspaceIds: new Set(workspaces.map((w) => w.id)),
    allTasks,
  });
  if (error) throw new Error(error);
  if (!isNew) mergeFiredState(prepared, existing.find((t) => t.id === prepared.id));
  await saveTasks(allTasks);
  return prepared;
}

async function taskSummaryLine(task: ScheduledTask, currentWorkspaceId: string, allTasks: ScheduledTask[]): Promise<string> {
  const nameOf = (taskId: string) => allTasks.find((t) => t.id === taskId)?.name;
  const triggersDesc = task.triggers.map((t) => describeTrigger(t, nameOf)).join('；') || '（无触发规则）';
  const nextAt = task.enabled ? minNextDueAt(task, Date.now()) : null;
  const nextDesc = !task.enabled ? '已停用' : nextAt ? formatTs(nextAt) : '未排期';
  const { entries } = await queryHistory({ planId: task.id, limit: 1 }).catch(() => ({ entries: [] as RunHistoryEntry[] }));
  const recent = entries[0];
  const recentDesc = recent
    ? `${formatTs(recent.ts)} ${recent.status}${recent.error ? `（${recent.error.slice(0, 80)}）` : recent.summary ? `：${recent.summary.slice(0, 80)}` : ''}`
    : '从未运行';
  const wsMark = task.workspaceId && task.workspaceId !== currentWorkspaceId ? '（其他工作区）' : '';
  return `- ${task.id} 《${task.name}》${wsMark} ${task.enabled ? '启用' : '停用'}\n  触发: ${triggersDesc}\n  下次运行: ${nextDesc}\n  最近运行: ${recentDesc}`;
}

function runHistoryLine(entry: RunHistoryEntry): string {
  const parts = [`${formatTs(entry.ts)} [${entry.status}]`, entry.triggerDesc ?? entry.triggerReason];
  if (entry.error) parts.push(`错误: ${entry.error.slice(0, 150)}`);
  else if (entry.summary) parts.push(entry.summary.slice(0, 150));
  if (entry.tokens) parts.push(`tokens ${entry.tokens.inputTokens}+${entry.tokens.outputTokens}`);
  return `- ${parts.filter(Boolean).join(' | ')}`;
}

/**
 * 定时任务管理工具中立定义（ToolDef[]）
 * @param workspaceId - 当前主会话工作区（新任务绑定于此；跨工作区任务仅展示标注，不改变读写范围）
 */
export function createSchedulerToolDefs(workspaceId: string): ToolDef[] {
  return [
    defineTool(
      'dogear__ListScheduledTasks',
      '列出定时任务',
      '列出全部定时任务及其启用状态、触发规则、下次运行时间、最近一次运行结果。',
      z.object({}),
      async () => {
        try {
          const tasks = await loadTasks();
          if (tasks.length === 0) return textResult('当前没有定时任务，可用 dogear__CreateScheduledTask 创建。');
          const lines = await Promise.all(tasks.map((t) => taskSummaryLine(t, workspaceId, tasks)));
          return textResult(`共 ${tasks.length} 个定时任务：\n\n${lines.join('\n')}`);
        } catch (error) {
          return errorResult(`列出定时任务失败: ${error}`);
        }
      },
      { replay: 'safe' },
    ),

    defineTool(
      'dogear__CreateScheduledTask',
      '创建定时任务',
      '创建定时任务：按触发规则自动运行一段 prompt（到点由系统派 agent 会话执行），创建后立即启用。\n' +
        'prompt 要自含：无人值守时执行会话只能看到这段话与挂载的工具，看不到当前对话。\n' +
        '任务绑定当前工作区；modelSelection 省略=跟随默认模型；toolPacksOverride 省略=跟随工作区可选工具包配置（空数组=运行时不挂任何可选工具包）；skillsOverride 传 skill 名列表=任务级挂载 skill（须为已有 skill）。',
      z.object({
        name: z.string().min(1).describe('任务名称'),
        prompt: z.string().min(1).describe('触发时执行的提示词，须自含全部上下文与期望产出'),
        triggers: z.array(triggerInputSchema).min(1).describe('触发规则列表，可组合多条'),
        modelSelection: modelSelectionSchema.optional().describe('指定执行模型，省略跟随默认'),
        toolPacksOverride: z.array(z.enum(KNOWN_TOOL_PACKS)).optional().describe('运行时可选工具包覆盖'),
        skillsOverride: z.array(z.string().min(1)).optional().describe('任务级 skill 挂载（skill 名列表）'),
      }),
      async (args) => {
        try {
          const draft: CustomScheduledTask = {
            id: '',
            name: args.name.trim(),
            kind: 'custom',
            enabled: true,
            triggers: args.triggers.map(toStoredTrigger),
            workspaceId,
            prompt: args.prompt,
            createdAt: 0,
            updatedAt: 0,
            ...(args.modelSelection !== undefined && { modelSelection: args.modelSelection }),
            ...(args.toolPacksOverride !== undefined && { toolPacksOverride: args.toolPacksOverride }),
            ...(args.skillsOverride !== undefined && { skillsOverride: args.skillsOverride }),
          };
          const prepared = await prepareTaskForSave(draft);
          const nextAt = minNextDueAt(prepared, Date.now());
          return textResult(
            `✅ 定时任务已创建并启用\n- 任务 ID: ${prepared.id}\n- 名称: ${prepared.name}\n` +
              `- 下次运行: ${nextAt ? formatTs(nextAt) : '视触发规则（事件型触发无固定时刻）'}\n` +
              '到点自动运行，结果写入运行历史（dogear__GetScheduledTaskRuns 查询）。',
          );
        } catch (error) {
          return errorResult(`创建定时任务失败: ${error instanceof Error ? error.message : String(error)}`);
        }
      },
    ),

    defineTool(
      'dogear__UpdateScheduledTask',
      '修改定时任务',
      '修改定时任务的名称、启停状态、提示词、触发规则、执行模型或覆盖配置；只传需要修改的字段。\n' +
        'triggers 传入时整组替换且各触发器重新起算（已触发记录不保留）；modelSelection 传 null=恢复跟随默认模型；toolPacksOverride 传 null=恢复跟随工作区配置；skillsOverride 传 null 或空数组=清除任务级 skill。',
      z.object({
        taskId: z.string().min(1).describe('任务 ID（dogear__ListScheduledTasks 查看）'),
        name: z.string().min(1).optional().describe('新名称'),
        enabled: z.boolean().optional().describe('true=启用，false=停用'),
        prompt: z.string().min(1).optional().describe('新提示词'),
        triggers: z.array(triggerInputSchema).min(1).optional().describe('整组替换触发规则（重新起算）'),
        modelSelection: modelSelectionSchema.nullable().optional().describe('null=恢复跟随默认模型'),
        toolPacksOverride: z.array(z.enum(KNOWN_TOOL_PACKS)).nullable().optional().describe('null=恢复跟随工作区配置'),
        skillsOverride: z.array(z.string().min(1)).nullable().optional().describe('null/空数组=清除任务级 skill'),
      }).refine(
        (v) =>
          v.name !== undefined ||
          v.enabled !== undefined ||
          v.prompt !== undefined ||
          v.triggers !== undefined ||
          v.modelSelection !== undefined ||
          v.toolPacksOverride !== undefined ||
          v.skillsOverride !== undefined,
        { message: '至少提供一项要修改的字段' },
      ),
      async (args) => {
        try {
          const tasks = await loadTasks();
          const task = tasks.find((t) => t.id === args.taskId);
          if (!task) return errorResult(`任务 ${args.taskId} 不存在，可用 dogear__ListScheduledTasks 查看。`);
          const draft: ScheduledTask = {
            ...task,
            ...(args.name !== undefined && { name: args.name.trim() }),
            ...(args.enabled !== undefined && { enabled: args.enabled }),
            ...(args.prompt !== undefined && { prompt: args.prompt }),
            ...(args.triggers !== undefined && { triggers: args.triggers.map(toStoredTrigger) }),
            ...('modelSelection' in args && { modelSelection: args.modelSelection ?? undefined }),
            ...('toolPacksOverride' in args && { toolPacksOverride: args.toolPacksOverride ?? undefined }),
            ...('skillsOverride' in args && { skillsOverride: args.skillsOverride ?? undefined }),
          };
          const prepared = await prepareTaskForSave(draft);
          return textResult(`✅ 定时任务已更新\n${await taskSummaryLine(prepared, workspaceId, await loadTasks())}`);
        } catch (error) {
          return errorResult(`修改定时任务失败: ${error instanceof Error ? error.message : String(error)}`);
        }
      },
    ),

    defineTool(
      'dogear__DeleteScheduledTask',
      '删除定时任务',
      '删除定时任务（运行历史保留可查）。若有其他任务由该任务完成触发，会一并提示，建议处理依赖任务。',
      z.object({
        taskId: z.string().min(1).describe('任务 ID（dogear__ListScheduledTasks 查看）'),
      }),
      async (args) => {
        try {
          const tasks = await loadTasks();
          const target = tasks.find((t) => t.id === args.taskId);
          if (!target) return errorResult(`任务 ${args.taskId} 不存在，可用 dogear__ListScheduledTasks 查看。`);
          const remaining = tasks.filter((t) => t.id !== args.taskId);
          await saveTasks(remaining);
          const dependents = remaining.filter((t) =>
            t.triggers.some((tr) => tr.type === 'on_task_done' && tr.taskId === args.taskId),
          );
          const depHint =
            dependents.length > 0
              ? `\n⚠️ ${dependents.map((d) => `《${d.name}》`).join('、')}由该任务完成触发，删除后其触发不再命中，建议一并更新或删除。`
              : '';
          return textResult(`✅ 定时任务《${target.name}》已删除（运行历史保留）${depHint}`);
        } catch (error) {
          return errorResult(`删除定时任务失败: ${error}`);
        }
      },
    ),

    defineTool(
      'dogear__RunScheduledTaskNow',
      '手动运行定时任务',
      '立即手动触发一个定时任务，后台运行；正在运行中的任务不会重复触发。完成后写入运行历史，可用 dogear__GetScheduledTaskRuns 查询结果。',
      z.object({
        taskId: z.string().min(1).describe('任务 ID（dogear__ListScheduledTasks 查看）'),
      }),
      async (args) => {
        try {
          const tasks = await loadTasks();
          const task = tasks.find((t) => t.id === args.taskId);
          if (!task) return errorResult(`任务 ${args.taskId} 不存在，可用 dogear__ListScheduledTasks 查看。`);
          const { started } = await getSchedulerService().runTaskManual(task.id);
          if (!started) {
            const running = getSchedulerService().getActivity().running.some((r) => r.taskId === task.id);
            return errorResult(running ? `任务《${task.name}》正在运行中，无需重复触发。` : `任务《${task.name}》未能启动。`);
          }
          return textResult(
            `✅ 任务《${task.name}》已手动触发，后台运行中；完成后写入运行历史，可用 dogear__GetScheduledTaskRuns 查询结果。`,
          );
        } catch (error) {
          return errorResult(`手动运行失败: ${error}`);
        }
      },
    ),

    defineTool(
      'dogear__GetScheduledTaskRuns',
      '查询定时任务运行历史',
      '查询定时任务的运行历史（时间、状态、触发原因、结果摘要、token 消耗），按时间倒序；无记录时提示从未运行。',
      z.object({
        taskId: z.string().min(1).describe('任务 ID（dogear__ListScheduledTasks 查看）'),
        limit: z.number().int().min(1).max(100).optional().describe('返回条数，默认 20'),
        before: z.number().int().optional().describe('翻页游标：传上一页结果末尾提示的 before 值，返回更早记录'),
      }),
      async (args) => {
        try {
          const tasks = await loadTasks();
          const task = tasks.find((t) => t.id === args.taskId);
          if (!task) return errorResult(`任务 ${args.taskId} 不存在，可用 dogear__ListScheduledTasks 查看。`);
          const { entries, nextCursor } = await queryHistory({
            planId: task.id,
            before: args.before,
            limit: args.limit,
          });
          if (entries.length === 0) {
            return textResult(args.before ? `任务《${task.name}》没有更早的运行记录。` : `任务《${task.name}》还没有运行记录。`);
          }
          const tail = nextCursor ? `\n\n更早记录可传 before=${nextCursor} 继续查询` : '';
          return textResult(`任务《${task.name}》运行记录（${entries.length} 条，倒序）：\n\n${entries.map(runHistoryLine).join('\n')}${tail}`);
        } catch (error) {
          return errorResult(`查询运行历史失败: ${error}`);
        }
      },
      { replay: 'safe' },
    ),
  ];
}

registerToolGroup({
  server: 'dogear-scheduler',
  label: '定时任务',
  create: createSchedulerToolDefs,
  placeholder: [''],
});
