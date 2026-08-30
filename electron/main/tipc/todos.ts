import { tipc } from '@egoist/tipc/main';
import * as todoService from '../services/todo-service.js';

const t = tipc.create();

export const todosRouter = {
  listTodos: t.procedure
    .input<{ workspacePath: string }>()
    .action(async ({ input }) => {
      try {
        return { todos: await todoService.listTodos(input.workspacePath) };
      } catch (e) {
        return { error: String(e) };
      }
    }),

  createTodo: t.procedure
    .input<{
      workspacePath: string;
      input: { text: string; due?: string; noteId?: string };
    }>()
    .action(async ({ input }) => {
      try {
        return { todo: await todoService.createTodo(input.workspacePath, input.input) };
      } catch (e) {
        return { error: String(e) };
      }
    }),

  updateTodo: t.procedure
    .input<{
      workspacePath: string;
      todoId: string;
      patch: { text?: string; due?: string | null };
    }>()
    .action(async ({ input }) => {
      try {
        let todo = await todoService.getTodo(input.workspacePath, input.todoId);
        if (!todo) return { error: `待办 ${input.todoId} 不存在` };
        if (input.patch.text !== undefined) {
          todo = await todoService.updateTodoText(input.workspacePath, input.todoId, input.patch.text);
        }
        if (input.patch.due !== undefined) {
          todo = await todoService.updateTodoDue(input.workspacePath, input.todoId, input.patch.due);
        }
        return { todo };
      } catch (e) {
        return { error: String(e) };
      }
    }),

  setTodoStatus: t.procedure
    .input<{ workspacePath: string; todoId: string; status: 'pending' | 'done' }>()
    .action(async ({ input }) => {
      try {
        return { todo: await todoService.setTodoStatus(input.workspacePath, input.todoId, input.status) };
      } catch (e) {
        return { error: String(e) };
      }
    }),

  deleteTodo: t.procedure
    .input<{ workspacePath: string; todoId: string }>()
    .action(async ({ input }) => {
      try {
        return { todo: await todoService.softDeleteTodo(input.workspacePath, input.todoId) };
      } catch (e) {
        return { error: String(e) };
      }
    }),

  restoreTodo: t.procedure
    .input<{ workspacePath: string; todoId: string }>()
    .action(async ({ input }) => {
      try {
        return { todo: await todoService.restoreTodo(input.workspacePath, input.todoId) };
      } catch (e) {
        return { error: String(e) };
      }
    }),

  purgeTodo: t.procedure
    .input<{ workspacePath: string; todoId: string }>()
    .action(async ({ input }) => {
      try {
        return { success: await todoService.purgeTodo(input.workspacePath, input.todoId) };
      } catch (e) {
        return { error: String(e) };
      }
    }),
};
