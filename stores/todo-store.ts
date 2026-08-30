import { create } from 'zustand';
import { client } from '@/lib/client';
import { rendererEvents } from '@/lib/events';
import type { HumanTodo, HumanTodoStatus } from '@/types/todo';

interface TodoState {
  todos: HumanTodo[];
  loading: boolean;
  /** 当前已加载的工作区路径，用于惰性加载去重与 todosChanged 事件匹配 */
  loadedWorkspacePath: string | null;

  loadTodos: (workspacePath: string) => Promise<void>;
  /** 快速建待办；成功后本地插入列表，最终一致靠 todosChanged 广播兜底 */
  createTodo: (
    workspacePath: string,
    input: { text: string; due?: string; noteId?: string },
  ) => Promise<HumanTodo | null>;
  updateTodo: (
    workspacePath: string,
    todoId: string,
    patch: { text?: string; due?: string | null },
  ) => Promise<boolean>;
  setTodoStatus: (workspacePath: string, todoId: string, status: HumanTodoStatus) => Promise<boolean>;
  /** 软删除进回收站；成功后本地移除 */
  softDeleteTodo: (workspacePath: string, todoId: string) => Promise<boolean>;
  /** 监听主进程 todosChanged 广播，工作区匹配时重新拉取列表；返回取消订阅函数 */
  subscribeTodosChanged: () => () => void;
}

export const useTodoStore = create<TodoState>((set, get) => ({
  todos: [],
  loading: false,
  loadedWorkspacePath: null,

  loadTodos: async (workspacePath) => {
    set({ loading: true });
    try {
      const result = await client.listTodos({ workspacePath });
      if ('todos' in result) {
        set({ todos: result.todos ?? [], loadedWorkspacePath: workspacePath });
      } else {
        console.error('[todos] listTodos 失败:', result.error);
      }
    } catch (error) {
      console.error('[todos] listTodos 失败:', error);
    } finally {
      set({ loading: false });
    }
  },

  createTodo: async (workspacePath, input) => {
    try {
      const result = await client.createTodo({ workspacePath, input });
      const todo = 'todo' in result ? result.todo : undefined;
      if (todo) {
        set({ todos: [todo, ...get().todos] });
        return todo;
      }
      if ('error' in result) console.error('[todos] createTodo 失败:', result.error);
      return null;
    } catch (error) {
      console.error('[todos] createTodo 失败:', error);
      return null;
    }
  },

  updateTodo: async (workspacePath, todoId, patch) => {
    try {
      const result = await client.updateTodo({ workspacePath, todoId, patch });
      const todo = 'todo' in result ? result.todo : undefined;
      if (todo) {
        set({ todos: get().todos.map((t) => (t.id === todoId ? todo : t)) });
        return true;
      }
      if ('error' in result) console.error('[todos] updateTodo 失败:', result.error);
      return false;
    } catch (error) {
      console.error('[todos] updateTodo 失败:', error);
      return false;
    }
  },

  setTodoStatus: async (workspacePath, todoId, status) => {
    try {
      const result = await client.setTodoStatus({ workspacePath, todoId, status });
      const todo = 'todo' in result ? result.todo : undefined;
      if (todo) {
        set({ todos: get().todos.map((t) => (t.id === todoId ? todo : t)) });
        return true;
      }
      if ('error' in result) console.error('[todos] setTodoStatus 失败:', result.error);
      return false;
    } catch (error) {
      console.error('[todos] setTodoStatus 失败:', error);
      return false;
    }
  },

  softDeleteTodo: async (workspacePath, todoId) => {
    try {
      const result = await client.deleteTodo({ workspacePath, todoId });
      if ('todo' in result && result.todo) {
        set({ todos: get().todos.filter((t) => t.id !== todoId) });
        return true;
      }
      if ('error' in result) console.error('[todos] deleteTodo 失败:', result.error);
      return false;
    } catch (error) {
      console.error('[todos] deleteTodo 失败:', error);
      return false;
    }
  },

  subscribeTodosChanged: () => {
    const unsub = rendererEvents.todosChanged.listen((data) => {
      const { loadedWorkspacePath, loadTodos } = get();
      if (loadedWorkspacePath && data.workspacePath === loadedWorkspacePath) {
        void loadTodos(loadedWorkspacePath);
      }
    });
    return () => unsub();
  },
}));

/** 分域搜索：待办文本前端过滤（顶栏 query 传入时用） */
export function filterByQuery(todos: HumanTodo[], query: string): HumanTodo[] {
  const q = query.trim().toLowerCase();
  if (!q) return todos;
  return todos.filter((t) => t.text.toLowerCase().includes(q));
}
