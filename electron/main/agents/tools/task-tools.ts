/**
 * 任务系统 agent 工具（dogear-tasks 工具组，仅挂主会话）
 *
 * 任务产生唯一入口：会话侧 dogear__CreateTask 挂载即排队；UI 不做「转任务」按钮。
 * originSessionId 由挂载点闭包注入（与 notes source 同款决策），不让 LLM 抄会话 ID。
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
  parts.push(`plan: ${task.planPath}`);
  if (task.result) parts.push(`结果: ${task.result.slice(0, 100)}`);
  return `- ${parts.join(' | ')}`;
}

export function createTaskToolDefs(workspacePath: string, sourceContext?: TaskToolSourceContext): ToolDef[] {
  return [
    defineTool(
      'dogear__CreateTask',
      '挂载实施任务',
      '将一个已有 plan 文档挂载为实施任务并进入执行队列。系统会串行执行：自动创建一个执行会话按 plan 实施，完成后任务进入待审核状态并通过系统通知用户。\n' +
        '前提：plan 文档已落盘（如 docs/plans/...）；与用户聊透方案、plan 写完后再挂载。\n' +
        '挂载后在回复中告知用户任务已排队（标题与任务 ID）。',
      z.object({
        title: z.string().min(1).describe('任务标题，简短概括要实施的内容'),
        planPath: z.string().min(1).describe('plan 文档的绝对路径'),
      }),
      async (args) => {
        try {
          await fs.access(args.planPath);
        } catch {
          return errorResult(`plan 文件不存在: ${args.planPath}，请先落盘 plan 文档再挂载任务。`);
        }
        try {
          const task = await taskService.createTask(workspacePath, {
            title: args.title,
            planPath: args.planPath,
            originSessionId: sourceContext?.conversationId,
          });
          getTaskQueue().kick();
          return textResult(
            `✅ 任务已挂载排队\n- 任务 ID: ${task.id}\n- 标题: ${task.title}\n- plan: ${task.planPath}\n` +
            '队列串行执行：轮到后会自动创建执行会话按 plan 实施，完成进入待审核并系统通知。',
          );
        } catch (error) {
          return errorResult(`挂载任务失败: ${error}`);
        }
      },
    ),

    defineTool(
      'dogear__ListTasks',
      '列出实施任务',
      '列出实施任务及其状态（queued 排队 / running 执行中 / review 待审核 / done 已通过 / rejected 已打回）。status 省略时列出全部。',
      z.object({
        status: z.enum(['queued', 'running', 'review', 'done', 'rejected']).optional().describe('按状态过滤'),
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
