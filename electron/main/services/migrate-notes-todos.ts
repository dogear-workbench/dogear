/**
 * 存量笔记 frontmatter todos 迁移：可实施待办（带 plan）→ 任务体系，普通待办 → 人待办
 *
 * - 幂等：frontmatter 无 todos 的文件直接跳过；迁完置空 todos 回写文件并刷新索引
 * - in_progress 带 plan 归 backlog（未完成即未决定执行）；plan 文件缺失时仍创建任务保留记录
 * - 逐文件「创建实体 → 回写」两步，进程崩溃窗口内可能重复创建实体（概率低，可手动删）
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import * as taskService from './task-service.js';
import * as todoStore from './todo-service.js';
import * as workspaceJsonService from './workspace-json-service.js';
import {
  getNotesDir,
  listNoteFiles,
  readNoteFile,
  writeNoteFile,
  updateIndexEntry,
  noteToIndexItem,
} from './notes/notes-store.js';
import { broadcastNotesChanged } from './notes/notes-service.js';
import { mainLogger } from '../agents/logger.js';

const log = mainLogger.child('migrate-notes-todos');

export interface MigrateNotesTodosResult {
  scannedNotes: number;
  migratedNotes: number;
  createdTasks: number;
  createdHumanTodos: number;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function migrateNotesTodos(workspacePath: string): Promise<MigrateNotesTodosResult> {
  const notesDir = getNotesDir(workspacePath);
  const files = await listNoteFiles(notesDir);
  const result: MigrateNotesTodosResult = { scannedNotes: files.length, migratedNotes: 0, createdTasks: 0, createdHumanTodos: 0 };

  for (const file of files) {
    const filePath = path.join(notesDir, file);
    const note = await readNoteFile(filePath);
    if (!note || note.todos.length === 0) continue;

    for (const todo of note.todos) {
      try {
        if (todo.plan) {
          const planPath = path.resolve(workspacePath, todo.plan);
          const exists = await fileExists(planPath);
          if (!exists) log.warn(`plan 文件缺失，仍创建任务保留记录: ${planPath}`);
          await taskService.createTask(workspacePath, {
            title: todo.text,
            planPath,
            noteId: note.id,
            status: todo.status === 'done' ? 'done' : 'backlog',
            skipPlanCheck: !exists,
          });
          result.createdTasks++;
        } else {
          await todoStore.createTodo(workspacePath, {
            text: todo.text,
            noteId: note.id,
            source: 'manual',
            status: todo.status === 'done' ? 'done' : 'pending',
          });
          result.createdHumanTodos++;
        }
      } catch (err) {
        log.error(`卡片 ${note.id} 待办「${todo.text}」迁移失败，跳过该条`, err);
      }
    }

    const cleaned: typeof note = { ...note, todos: [] };
    await writeNoteFile(filePath, cleaned);
    await updateIndexEntry(workspacePath, noteToIndexItem(cleaned));
    result.migratedNotes++;
    log.info(`卡片 ${note.id}《${note.title}》已迁移 ${note.todos.length} 条待办`);
  }

  if (result.migratedNotes > 0) await broadcastNotesChanged(workspacePath);
  return result;
}

/** 应用启动入口：遍历全部工作区执行迁移，单工作区失败不影响其他 */
export async function migrateNotesTodosAllWorkspaces(): Promise<void> {
  const workspaces = await workspaceJsonService.getAll();
  for (const ws of workspaces) {
    try {
      const result = await migrateNotesTodos(ws.path);
      if (result.migratedNotes > 0) {
        log.info(`工作区 ${ws.id} 迁移完成：${result.migratedNotes} 张卡片，${result.createdTasks} 个任务，${result.createdHumanTodos} 条人待办`);
      }
    } catch (err) {
      log.error(`工作区 ${ws.id} 笔记 todos 迁移失败`, err);
    }
  }
}
