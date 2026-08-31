/**
 * 任务系统 agent 工具（dogear-tasks 工具组，仅挂主会话）
 *
 * 任务产生唯一入口：会话侧 dogear__CreateTask 挂载落计划栏（planPath 可省略占位）；UI 不做「转任务」按钮。
 * originSessionId 由挂载点闭包注入（与 notes source 同款决策），不让 LLM 抄会话 ID。
 * autoExecute 走「先 createTask 落 plan 再 executeTask」两步：createTask 的 status 撞 plan 同标题会命中 upsert 丢失排队语义。
 */
import fs from 'node:fs/promises';
import { z } from 'zod';
import * as taskService from '../../services/task-service.js';
import type { Task } from '../../services/task-service.js';
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

function taskLine(task: Task): string {
  const parts = [`${task.id} [${task.status}] 《${task.title}》`];
  parts.push(`plan: ${task.planPath ?? '（未挂文档，占位）'}`);
  if (task.result) parts.push(`结果: ${task.result.slice(0, 100)}`);
  return `- ${parts.join(' | ')}`;
}

export function createTaskToolDefs(workspacePath: string, sourceContext?: TaskToolSourceContext): ToolDef[] {
  return [
    defineTool(
      'dogear__CreateTask',
      '挂载实施任务',
      '将实施任务挂到计划栏。默认落计划（plan），由用户决定何时推进执行；与用户聊透方案后挂载。\n' +
        'planPath 可省略——方案未定型先占位，后续再次调用（同标题）会自动补上文档路径；传入时要求文件已落盘。\n' +
        'autoExecute=true 仅当用户明确要求立即执行：直接转入执行队列（串行执行，完成后待审核并系统通知）。\n' +
        '存入计划栏时告知用户（标题与任务 ID）；占位任务要提醒补 plan 文档。',
      z.object({
        title: z.string().min(1).describe('任务标题，简短概括要实施的内容'),
        planPath: z.string().min(1).optional().describe('plan 文档的绝对路径；方案未定型可省略先占位，文档落盘后同标题再调一次自动补路径'),
        autoExecute: z.boolean().optional().describe('仅当用户明确要求立即执行时传 true：直接转入执行队列；默认 false 落计划栏'),
      }),
      async (args) => {
        if (args.planPath) {
          try {
            await fs.access(args.planPath);
          } catch {
            return errorResult(`plan 文件不存在: ${args.planPath}，请先落盘 plan 文档再挂载，或省略 planPath 先占位。`);
          }
        }
        try {
          const autoExecute = args.autoExecute === true;
          if (autoExecute && !args.planPath) {
            return errorResult(
              '该任务还没有 plan 文档，无法立即执行。请先落盘 plan 文档，再调用一次 dogear__CreateTask 传入 planPath（同标题会自动补路径），或落盘后用 dogear__ExecuteTask。',
            );
          }
          let isUpdate = false;
          if (args.planPath) {
            const title = args.title.trim();
            const tasks = await taskService.listTasks(workspacePath);
            isUpdate = tasks.some((t) => t.status === 'plan' && t.title === title);
          }
          const created = await taskService.createTask(workspacePath, {
            title: args.title,
            ...(args.planPath ? { planPath: args.planPath } : {}),
            originSessionId: sourceContext?.conversationId,
            status: 'plan',
          });
          if (autoExecute) {
            const task = await taskService.executeTask(workspacePath, created.id);
            getTaskQueue().kick();
            return textResult(
              `✅ 任务已排队\n- 任务 ID: ${task.id}\n- 标题: ${task.title}\n- plan: ${task.planPath}\n` +
                '队列串行执行：轮到后会自动创建执行会话按 plan 实施，完成进入待审核并系统通知。',
            );
          }
          if (isUpdate) {
            return textResult(
              `✅ 已补文档并更新计划任务\n- 任务 ID: ${created.id}\n- 标题: ${created.title}\n- plan: ${created.planPath}\n` +
                '计划任务不会自动执行；用户确认后可用 dogear__ExecuteTask 转入队列。',
            );
          }
          const planLine = args.planPath ? `- plan: ${created.planPath}\n` : '';
          const nextHint = args.planPath
            ? '计划任务不会自动执行；用户确认后可用 dogear__ExecuteTask 转入队列。'
            : '当前为占位任务（无 plan 文档），不会进入执行队列；plan 文档落盘后再次调用 dogear__CreateTask（同标题 + planPath）自动补路径。';
          return textResult(
            `✅ 任务已存入计划栏\n- 任务 ID: ${created.id}\n- 标题: ${created.title}\n${planLine}${nextHint}`,
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
        '任务尚无 plan 文档（planPath 缺失）会报错——先落盘 plan 文档并用 dogear__CreateTask 传入 planPath（同标题）补路径。',
      z.object({
        taskId: z.string().min(1).describe('任务 ID（dogear__ListTasks 查看）'),
      }),
      async (args) => {
        try {
          const existing = await taskService.getTask(workspacePath, args.taskId);
          if (!existing) return errorResult(`任务 ${args.taskId} 不存在，可用 dogear__ListTasks 查看。`);
          if (!existing.planPath) {
            return errorResult(
              `任务《${existing.title}》尚无 plan 文档，请先落盘 plan 文档并用 dogear__CreateTask 传入 planPath（同标题）补路径，再执行。`,
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
      '列出实施任务及其状态（plan 计划 / backlog 待办 / queued 排队 / running 执行中 / review 待审核 / done 已通过 / rejected 已打回）。status 省略时列出全部；看计划用 status=\'plan\'，看待办用 status=\'backlog\'。',
      z.object({
        status: z.enum(['plan', 'backlog', 'queued', 'running', 'review', 'done', 'rejected']).optional().describe('按状态过滤'),
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
  ];
}

registerToolGroup({
  server: 'dogear-tasks',
  label: '任务系统',
  create: createTaskToolDefs,
  placeholder: ['', { workspaceId: '', conversationId: '' }],
});
