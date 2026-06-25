import fs from 'fs/promises';
import path from 'path';
import electron from 'electron';
import { tipc } from '@egoist/tipc/main';
import * as groupService from '../services/group-service.js';
import * as groupSharedService from '../services/group-shared-service.js';
import * as conversationService from '../services/conversation-service.js';

const t = tipc.create();

export const groupRouter = {
  listGroups: t.procedure
    .input<{ workspaceId: string }>()
    .action(async ({ input }) => {
      try {
        const groups = await groupService.listGroups(input.workspaceId);
        return { groups, error: undefined };
      } catch (error) {
        console.error('获取会话组列表失败:', error);
        return { groups: [], error: error instanceof Error ? error.message : String(error) };
      }
    }),

  getGroup: t.procedure
    .input<{ workspaceId: string; groupId: string }>()
    .action(async ({ input }) => {
      try {
        const group = await groupService.getGroup(input.workspaceId, input.groupId);
        return { group, error: undefined };
      } catch (error) {
        console.error('获取会话组失败:', error);
        return { group: null, error: error instanceof Error ? error.message : String(error) };
      }
    }),

  createGroup: t.procedure
    .input<{ workspaceId: string; title?: string }>()
    .action(async ({ input }) => {
      try {
        const group = await groupService.createGroup(input.workspaceId, { title: input.title });
        return { group, error: undefined };
      } catch (error) {
        console.error('创建会话组失败:', error);
        return { group: null, error: error instanceof Error ? error.message : String(error) };
      }
    }),

  updateGroup: t.procedure
    .input<{ workspaceId: string; groupId: string; patch: { title?: string } }>()
    .action(async ({ input }) => {
      try {
        const group = await groupService.updateGroup(input.workspaceId, input.groupId, input.patch);
        return { group, error: undefined };
      } catch (error) {
        console.error('更新会话组失败:', error);
        return { group: null, error: error instanceof Error ? error.message : String(error) };
      }
    }),

  deleteGroup: t.procedure
    .input<{ workspaceId: string; groupId: string }>()
    .action(async ({ input }) => {
      try {
        const conversations = await conversationService.getByWorkspaceId(input.workspaceId, { includeArchived: true });
        const count = conversations.filter((c) => c.groupId === input.groupId).length;
        if (count > 0) {
          return { ok: false, error: `组内还有 ${count} 个对话，请先清理` };
        }
        await groupService.deleteGroup(input.workspaceId, input.groupId);
        try {
          const sharedDir = await groupSharedService.getSharedDir(input.workspaceId, input.groupId);
          await fs.rm(path.dirname(sharedDir), { recursive: true, force: true });
        } catch (cleanupError) {
          console.warn('[deleteGroup] 清理共享目录失败:', cleanupError);
        }
        return { ok: true, error: undefined };
      } catch (error) {
        console.error('删除会话组失败:', error);
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
    }),

  listSharedFiles: t.procedure
    .input<{ workspaceId: string; groupId: string }>()
    .action(async ({ input }) => {
      try {
        const { files, sharedDir } = await groupSharedService.listNativeFiles(input.workspaceId, input.groupId);
        return { files, sharedDir, error: undefined };
      } catch (error) {
        console.error('列出共享文件失败:', error);
        return { files: [], sharedDir: '', error: error instanceof Error ? error.message : String(error) };
      }
    }),

  readSharedFile: t.procedure
    .input<{ workspaceId: string; groupId: string; relPath: string }>()
    .action(async ({ input }) => {
      try {
        const content = await groupSharedService.readNativeFile(input.workspaceId, input.groupId, input.relPath);
        return { content, error: undefined };
      } catch (error) {
        console.error('读取共享文件失败:', error);
        return { content: null, error: error instanceof Error ? error.message : String(error) };
      }
    }),

  writeSharedFile: t.procedure
    .input<{ workspaceId: string; groupId: string; relPath: string; content: string }>()
    .action(async ({ input }) => {
      try {
        await groupSharedService.writeNativeFile(input.workspaceId, input.groupId, input.relPath, input.content);
        return { ok: true, error: undefined };
      } catch (error) {
        console.error('写入共享文件失败:', error);
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
    }),

  deleteSharedFile: t.procedure
    .input<{ workspaceId: string; groupId: string; relPath: string }>()
    .action(async ({ input }) => {
      try {
        await groupSharedService.deleteNativeFile(input.workspaceId, input.groupId, input.relPath);
        return { ok: true, error: undefined };
      } catch (error) {
        console.error('删除共享文件失败:', error);
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
    }),

  openSharedAreaInExplorer: t.procedure
    .input<{ workspaceId: string; groupId: string }>()
    .action(async ({ input }) => {
      try {
        const dir = await groupSharedService.getSharedDir(input.workspaceId, input.groupId);
        const result = await electron.shell.openPath(dir);
        return { ok: !result, error: result || undefined };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
    }),
};
