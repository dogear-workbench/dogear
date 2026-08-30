/**
 * 人待办 agent 工具（dogear-todos 工具组，仅挂主会话）
 *
 * 人的待办与任务（agent 执行）分离：琐事记这里由人勾选，
 * 可实施工作（有 plan）走 dogear__CreateTask 落任务积压。
 */
import { z } from 'zod';
import * as todoService from '../../services/todo-service.js';
import type { HumanTodo } from '../../services/todo-service.js';
import { registerToolGroup } from './tool-registry.js';
import { defineTool, type ToolDef } from '../pi/tool-adapter.js';

function errorResult(text: string) {
  return { content: [{ type: 'text' as const, text }], isError: true as const };
}

function textResult(text: string) {
  return { content: [{ type: 'text' as const, text }] };
}

function todoLine(todo: HumanTodo): string {
  const mark = todo.status === 'done' ? '[x]' : '[ ]';
  const parts = [`${mark} ${todo.id} ${todo.text}`];
  if (todo.due) parts.push(`due: ${todo.due}`);
  if (todo.noteId) parts.push(`笔记: ${todo.noteId}`);
  return `- ${parts.join(' | ')}`;
}

export function createTodoToolDefs(workspacePath: string): ToolDef[] {
  return [
    defineTool(
      'mcp__dogear-todos__createTodo',
      '创建人待办',
      '记录一条给用户自己完成的待办（如「买牛奶」「回邮件」），用户在待办面板勾选。仅用于琐事备忘；可实施工作（有 plan 文档）用 dogear__CreateTask 落任务积压，不要混入。',
      z.object({
        text: z.string().min(1).describe('待办内容'),
        due: z.string().min(1).optional().describe('截止日期（YYYY-MM-DD 或 ISO 时间），可选'),
        noteId: z.string().min(1).optional().describe('关联的笔记卡片 ID，可选'),
      }),
      async (args) => {
        try {
          const todo = await todoService.createTodo(workspacePath, {
            text: args.text,
            ...(args.due ? { due: args.due } : {}),
            ...(args.noteId ? { noteId: args.noteId } : {}),
            source: 'agent',
          });
          return textResult(`✅ 已创建待办\n${todoLine(todo)}`);
        } catch (error) {
          return errorResult(`创建待办失败: ${error}`);
        }
      },
    ),

    defineTool(
      'mcp__dogear-todos__completeTodo',
      '完成人待办',
      '将一条人待办标记为完成。',
      z.object({
        id: z.string().min(1).describe('待办 ID（mcp__dogear-todos__listHumanTodos 查看）'),
      }),
      async (args) => {
        try {
          const todo = await todoService.setTodoStatus(workspacePath, args.id, 'done');
          return textResult(`✅ 已完成待办\n${todoLine(todo)}`);
        } catch (error) {
          return errorResult(`完成待办失败: ${error}`);
        }
      },
    ),

    defineTool(
      'mcp__dogear-todos__listHumanTodos',
      '列出人待办',
      '列出人待办（未完成在前，已完成在后）。',
      z.object({}),
      async () => {
        try {
          const todos = await todoService.listTodos(workspacePath);
          if (todos.length === 0) return textResult('当前没有任何待办。');
          const pending = todos.filter((t) => t.status === 'pending');
          const done = todos.filter((t) => t.status === 'done');
          const sections: string[] = [];
          if (pending.length > 0) sections.push(`未完成 ${pending.length} 条：\n${pending.map(todoLine).join('\n')}`);
          if (done.length > 0) sections.push(`已完成 ${done.length} 条：\n${done.map(todoLine).join('\n')}`);
          return textResult(`共 ${todos.length} 条待办：\n\n${sections.join('\n\n')}`);
        } catch (error) {
          return errorResult(`列出待办失败: ${error}`);
        }
      },
    ),
  ];
}

registerToolGroup({
  server: 'dogear-todos',
  label: '人待办',
  create: createTodoToolDefs,
  placeholder: [''],
});
