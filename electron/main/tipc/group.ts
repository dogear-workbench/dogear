import electron from 'electron';
import { tipc } from '@egoist/tipc/main';
import * as groupService from '../services/group-service.js';
import { autoArchiveStaleGroups } from '../services/auto-archive-service.js';
import * as groupSharedService from '../services/group-shared-service.js';
import { readTopicStateCard, resolvePendingTopicChange } from '../services/memory/background-store.js';
import * as conversationService from '../services/conversation-service.js';
import * as topicLifecycleService from '../services/topic-lifecycle-service.js';
import { conversationRuntimeService } from '../services/conversation-runtime-service.js';

const t = tipc.create();

export const groupRouter = {
  listGroups: t.procedure
    .input<{ workspaceId: string }>()
    .action(async ({ input }) => {
      try {
        const groups = await groupService.listActiveGroups(input.workspaceId);
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
        await groupService.requireActiveGroup(input.workspaceId, input.groupId);
        const group = await groupService.updateGroup(input.workspaceId, input.groupId, input.patch);
        return { group, error: undefined };
      } catch (error) {
        console.error('更新会话组失败:', error);
        return { group: null, error: error instanceof Error ? error.message : String(error) };
      }
    }),

  archiveTopic: t.procedure
    .input<{ workspaceId: string; groupId: string }>()
    .action(async ({ input }) => {
      try {
        await groupService.requireActiveGroup(input.workspaceId, input.groupId);
        const conversations = await conversationService.getByWorkspaceId(input.workspaceId, { includeArchived: true });
        await Promise.all(
          conversations
            .filter((conversation) => conversation.groupId === input.groupId)
            .map((conversation) => conversationRuntimeService.closeConversation(conversation.id)),
        );
        const group = await groupService.archiveGroup(input.workspaceId, input.groupId);
        return { group, error: undefined };
      } catch (error) {
        console.error('归档话题失败:', error);
        return { group: null, error: error instanceof Error ? error.message : String(error) };
      }
    }),

  restoreTopic: t.procedure
    .input<{ workspaceId: string; groupId: string }>()
    .action(async ({ input }) => {
      try {
        const group = await groupService.restoreGroup(input.workspaceId, input.groupId);
        return { group, error: undefined };
      } catch (error) {
        console.error('恢复话题失败:', error);
        return { group: null, error: error instanceof Error ? error.message : String(error) };
      }
    }),

  listArchivedTopics: t.procedure
    .input<{ workspaceId: string }>()
    .action(async ({ input }) => {
      try {
        const [groups, conversations] = await Promise.all([
          groupService.listArchivedGroups(input.workspaceId),
          conversationService.getByWorkspaceId(input.workspaceId, { includeArchived: true }),
        ]);
        const topics = groups.map((group) => ({
          group,
          conversations: conversations
            .filter((conversation) => conversation.groupId === group.id)
            .map(conversationService.toCompat),
        }));
        return { topics, error: undefined };
      } catch (error) {
        console.error('获取归档话题失败:', error);
        return { topics: [], error: error instanceof Error ? error.message : String(error) };
      }
    }),

  deleteTopic: t.procedure
    .input<{ workspaceId: string; groupId: string }>()
    .action(async ({ input }) => {
      try {
        if (!await groupService.getGroup(input.workspaceId, input.groupId)) {
          return { ok: false, error: '话题不存在' };
        }
        const result = await topicLifecycleService.deleteTopic(input.workspaceId, input.groupId);
        return result.ok
          ? { ok: true, error: undefined }
          : { ok: false, error: result.error };
      } catch (error) {
        console.error('永久删除话题失败:', error);
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
        await groupService.requireActiveGroup(input.workspaceId, input.groupId);
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
        await groupService.requireActiveGroup(input.workspaceId, input.groupId);
        await groupSharedService.deleteNativeFile(input.workspaceId, input.groupId, input.relPath);
        return { ok: true, error: undefined };
      } catch (error) {
        console.error('删除共享文件失败:', error);
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
    }),

  autoArchiveStale: t.procedure
    .input<{ workspaceId: string }>()
    .action(async ({ input }) => {
      try {
        const archivedCount = await autoArchiveStaleGroups(input.workspaceId);
        return { archivedCount, error: undefined };
      } catch (error) {
        console.error('自动归档失败:', error);
        return { archivedCount: 0, error: error instanceof Error ? error.message : String(error) };
      }
    }),

  readTopicStateCard: t.procedure
    .input<{ workspaceId: string; groupId: string }>()
    .action(async ({ input }) => {
      try {
        const card = await readTopicStateCard(input.workspaceId, input.groupId);
        return { card, error: undefined };
      } catch (error) {
        console.error('读取话题状态卡失败:', error);
        return { card: null, error: error instanceof Error ? error.message : String(error) };
      }
    }),

  confirmTopicChange: t.procedure
    .input<{ workspaceId: string; groupId: string; index: number; accept: boolean }>()
    .action(async ({ input }) => {
      try {
        const card = await resolvePendingTopicChange(input.workspaceId, input.groupId, input.index, input.accept);
        if (!card) return { ok: false, error: '状态卡不存在或该变更已不在待确认列表' };
        return { ok: true, error: undefined };
      } catch (error) {
        console.error('确认话题变更失败:', error);
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
