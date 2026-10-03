/**
 * 任务系统 agent 工具（dogear-tasks 工具组，仅挂主会话）
 *
 * 任务产生唯一入口：会话侧 dogear__CreateTask 挂载落计划栏（planPath 必传，任务=完全体）；UI 不做「转任务」按钮。
 * originSessionId 由挂载点闭包注入（与 notes source 同款决策），不让 LLM 抄会话 ID。
 * autoExecute 走「先 createTask 落 plan 再 executeTask」两步：同标题 plan 态任务已存在时 createTask 直接拒绝，不会撞车。
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import * as taskService from '../../services/task-service.js';
import type { Task } from '../../services/task-service.js';
import type { ExecProfile } from '../../services/task-execution-prompt.js';
import { getTaskQueue } from '../../services/task-queue.js';
import { registerToolGroup } from './tool-registry.js';
import { defineTool, type ToolDef } from '../pi/tool-adapter.js';

/** 挂载上下文：CreateTask 自动写入任务来源会话，agent 无需也不应传会话标识 */
export interface TaskToolSourceContext {
  workspaceId: string;
  conversationId: string;
}

function errorResult(text: string) {
  return { content: [{ type: 'text' as const, text }], isError: true as const };
}

function textResult(text: string) {
  return { content: [{ type: 'text' as const, text }] };
}

const EXEC_PROFILE_LABEL: Record<ExecProfile, string> = {
  default: '默认',
  'code-impl': '代码实施',
};

function taskLine(task: Task): string {
  const parts = [`${task.id} [${task.status}] 《${task.title}》`];
  parts.push(`类型: ${EXEC_PROFILE_LABEL[task.execProfile ?? 'default']}`);
  parts.push(`plan: ${task.planPath ?? '（缺失）'}`);
  if (task.result) parts.push(`结果: ${task.result.slice(0, 100)}`);
  return `- ${parts.join(' | ')}`;
}

export function createTaskToolDefs(workspacePath: string, sourceContext?: TaskToolSourceContext): ToolDef[] {
  return [
    defineTool(
      'dogear__CreateTask',
      '挂载实施任务',
      '将实施任务挂到计划栏。默认落计划（plan），由用户决定何时推进执行；与用户聊透方案后挂载。\n' +
        '任务须是完全体：planPath 必传且文件须已落盘；方案未定型先记笔记卡片，落盘 plan 文档后再挂载。\n' +
        '同标题计划（plan 态）任务已存在时拒绝创建，标题勿重复。\n' +
        'execProfile 判断标准：plan 为分步实施文档（stepN-*.md）且要动代码时填 code-impl（执行会话按 staged-execution 语境逐 step 派子会话实施）；调研/整理类不填。\n' +
        'autoExecute=true 仅当用户明确要求立即执行：直接转入执行队列（串行执行，完成后待审核并系统通知）。\n' +
        '存入计划栏时告知用户（标题与任务 ID）。',
      z.object({
        title: z.string().min(1).describe('任务标题，简短概括要实施的内容'),
        planPath: z.string().min(1).describe('plan 文档路径（绝对路径，或相对工作区根的相对路径），必传；文件须已落盘'),
        execProfile: z
          .enum(['default', 'code-impl'])
          .optional()
          .describe(
            "执行类型：plan 为分步实施文档（stepN-*.md）且要动代码时填 'code-impl'；调研/整理类不填（默认）",
          ),
        autoExecute: z.boolean().optional().describe('仅当用户明确要求立即执行时传 true：直接转入执行队列；默认 false 落计划栏'),
      }),
      async (args) => {
        const planPath = path.resolve(workspacePath, args.planPath);
        try {
          await fs.access(planPath);
        } catch {
          return errorResult(`plan 文件不存在: ${planPath}，请先落盘 plan 文档再挂载（方案未定型先记笔记）。`);
        }
        try {
          const created = await taskService.createTask(workspacePath, {
            title: args.title,
            planPath,
            ...(args.execProfile ? { execProfile: args.execProfile } : {}),
            originSessionId: sourceContext?.conversationId,
            status: 'plan',
          });
          const profileLine = `\n- 类型: ${EXEC_PROFILE_LABEL[created.execProfile ?? 'default']}`;
          if (args.autoExecute === true) {
            const task = await taskService.executeTask(workspacePath, created.id);
            getTaskQueue().kick();
            return textResult(
              `✅ 任务已排队\n- 任务 ID: ${task.id}\n- 标题: ${task.title}${profileLine}\n- plan: ${task.planPath}\n` +
                '队列串行执行：轮到后会自动创建执行会话按 plan 实施，完成进入待审核并系统通知。',
            );
          }
          return textResult(
            `✅ 任务已存入计划栏\n- 任务 ID: ${created.id}\n- 标题: ${created.title}${profileLine}\n- plan: ${created.planPath}\n` +
              '计划任务不会自动执行；用户确认后可用 dogear__ExecuteTask 转入队列。',
          );
        } catch (error) {
          return errorResult(`挂载任务失败: ${error}`);
        }
      },
    ),

    defineTool(
      'dogear__ExecuteTask',
      '执行任务',
      '将一个计划（plan）或待办（backlog）任务转入执行队列（queued），轮到后会自动创建执行会话按 plan 实施；对 plan 态任务执行等价于用户确认。\n' +
        '任务尚无 plan 文档（planPath 缺失）会报错——先落盘 plan 文档，再用 dogear__CreateTask 重新挂载（planPath 必传）。',
      z.object({
        taskId: z.string().min(1).describe('任务 ID（dogear__ListTasks 查看）'),
      }),
      async (args) => {
        try {
          const existing = await taskService.getTask(workspacePath, args.taskId);
          if (!existing) return errorResult(`任务 ${args.taskId} 不存在，可用 dogear__ListTasks 查看。`);
          if (!existing.planPath) {
            return errorResult(
              `任务《${existing.title}》尚无 plan 文档，无法执行；请落盘 plan 文档后用 dogear__CreateTask 重新挂载（planPath 必传）。`,
            );
          }
          const task = await taskService.executeTask(workspacePath, args.taskId);
          getTaskQueue().kick();
          return textResult(
            `✅ 任务已转入队列\n- 任务 ID: ${task.id}\n- 标题: ${task.title}\n- plan: ${task.planPath}\n` +
            '队列串行执行：轮到后会自动创建执行会话按 plan 实施，完成进入待审核并系统通知。',
          );
        } catch (error) {
          return errorResult(`执行任务失败: ${error}`);
        }
      },
    ),

    defineTool(
      'dogear__ListTasks',
      '列出实施任务',
      '列出实施任务及其状态（plan 计划 / backlog 待办 / queued 排队 / running 执行中 / review 待审核 / done 已通过 / rejected 已打回 / interrupted 已中断）。status 省略时列出全部；看计划用 status=\'plan\'，看待办用 status=\'backlog\'，看中断待处理用 status=\'interrupted\'。',
      z.object({
        status: z.enum(['plan', 'backlog', 'queued', 'running', 'review', 'done', 'rejected', 'interrupted']).optional().describe('按状态过滤'),
      }),
      async (args) => {
        try {
          const tasks = await taskService.listTasks(workspacePath);
          const filtered = args.status ? tasks.filter((t) => t.status === args.status) : tasks;
          if (filtered.length === 0) {
            return textResult(args.status ? `没有 ${args.status} 状态的任务。` : '当前没有任何任务。');
          }
          return textResult(`共 ${filtered.length} 个任务：\n\n${filtered.map(taskLine).join('\n')}`);
        } catch (error) {
          return errorResult(`列出任务失败: ${error}`);
        }
      },
    ),

    defineTool(
      'dogear__ReportTaskResult',
      '申报任务执行结果',
      '申报任务执行结果（仅任务执行会话可用）：整个计划实施完成后调用，按当前会话归属校验，命中后任务进入待审核（review）并系统通知用户。\n' +
        'result 摘要要说清做了什么、关键改动位置、遗留问题，用户只凭这段做审核。摘要中若有必须用户本人完成的事项（登录/授权/线下操作/人工拍板），同时调用 dogear__TrackUserActions 提议勾选卡，不要只写在摘要里。任务已被中断时继续工作并申报同样有效（中断后让会话继续，完成后申报回写）。',
      z.object({
        result: z.string().min(1).describe('结果摘要：做了什么、关键改动位置、遗留问题'),
      }),
      async (args) => {
        if (!sourceContext) return errorResult('当前上下文缺少会话标识，无法申报任务结果。');
        try {
          const task = await taskService.reportTaskResult(workspacePath, sourceContext.conversationId, args.result.trim());
          if (!task) {
            const mine = (await taskService.listTasks(workspacePath)).find(
              (t) => t.execSessionId === sourceContext.conversationId,
            );
            if (mine && ['review', 'done'].includes(mine.status)) {
              return textResult(`任务《${mine.title}》的结果已回写（当前状态 ${mine.status}），无需重复申报。`);
            }
            return errorResult('当前会话不是任何待回写任务（running/interrupted/rejected）的执行会话，无法申报结果。');
          }
          return textResult(
            `✅ 结果已回写\n- 任务 ID: ${task.id}\n- 标题: ${task.title}\n- 状态: review（待审核）\n` +
              '用户会收到系统通知，等待其审核（通过 → done / 打回 → rejected）。',
          );
        } catch (error) {
          return errorResult(`申报任务结果失败: ${error}`);
        }
      },
    ),
  ];
}

registerToolGroup({
  server: 'dogear-tasks',
  label: '任务系统',
  create: createTaskToolDefs,
  placeholder: ['', { workspaceId: '', conversationId: '' }],
});
