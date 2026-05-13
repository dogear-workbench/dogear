// electron/main/tipc/conversations.ts
import { tipc } from '@egoist/tipc/main';
import { deleteSession } from '@anthropic-ai/claude-agent-sdk';
import * as conversationService from '../services/conversation-service.js';
import * as treeService from '../services/conversation-tree-service.js';
import * as workspaceJsonService from '../services/workspace-json-service.js';
import { getClaudeConfigDir } from './agent.js';

const t = tipc.create();

/**
 * 调用 SDK deleteSession 清理 JSONL 历史文件。
 * 失败不抛异常（静默），避免阻塞索引删除。
 *
 * 注意：SDK 的 deleteSession 是主进程内直接调用的函数（非 spawn CLI），
 * 它会读取 process.env.CLAUDE_CONFIG_DIR 来定位 JSONL 文件。为保证准确，
 * 调用前临时设置 process.env.CLAUDE_CONFIG_DIR，调用完毕后恢复。
 */
async function tryDeleteSdkSession(workspaceId: string, sdkSessionId: string): Promise<void> {
  const originalEnv = process.env.CLAUDE_CONFIG_DIR;
  try {
    const workspace = await workspaceJsonService.getById(workspaceId);
    if (!workspace?.path) {
      console.warn('[deleteSession] 工作区路径不存在，跳过 JSONL 清理:', workspaceId);
      return;
    }
    process.env.CLAUDE_CONFIG_DIR = getClaudeConfigDir();
    await deleteSession(sdkSessionId, { dir: workspace.path });
    console.log('[deleteSession] 已清理 SDK 历史:', sdkSessionId);
  } catch (error) {
    console.warn('[deleteSession] 清理 SDK 历史失败（对话索引仍会被删除）:', error);
  } finally {
    // 恢复原值（无论之前是否设置）
    if (originalEnv === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = originalEnv;
  }
}

export const conversationsRouter = {
  // ── 对话 CRUD ─────────────────────────────────────────────

  getById: t.procedure
    .input<{ conversationId: string; workspaceId: string }>()
    .action(async ({ input }) => {
      try {
        const conversation = await conversationService.getById(input.workspaceId, input.conversationId);
        return { conversation: conversation ? conversationService.toCompat(conversation) : null, error: undefined };
      } catch (error) {
        console.error('获取对话失败:', error);
        return { conversation: null, error: error instanceof Error ? error.message : String(error) };
      }
    }),

  create: t.procedure
    .input<{ workspaceId: string; title?: string }>()
    .action(async ({ input }) => {
      try {
        const conversationId = await conversationService.create(
          input.workspaceId,
          input.title || '新对话',
        );
        // 同步添加到树
        await treeService.addConversationToTree(input.workspaceId, conversationId);
        return { conversationId, error: undefined };
      } catch (error) {
        console.error('创建对话失败:', error);
        return { conversationId: null, error: error instanceof Error ? error.message : String(error) };
      }
    }),

  updateTitle: t.procedure
    .input<{ conversationId: string; title: string; workspaceId: string }>()
    .action(async ({ input }) => {
      try {
        await conversationService.updateTitle(input.workspaceId, input.conversationId, input.title);
        return { success: true, error: undefined };
      } catch (error) {
        console.error('更新对话标题失败:', error);
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    }),

  updateSdkSessionId: t.procedure
    .input<{ conversationId: string; sdkSessionId: string; workspaceId: string }>()
    .action(async ({ input }) => {
      try {
        await conversationService.updateSdkSessionId(input.workspaceId, input.conversationId, input.sdkSessionId);
        return { success: true, error: undefined };
      } catch (error) {
        console.error('更新 SDK session ID 失败:', error);
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    }),

  deleteConversation: t.procedure
    .input<{ conversationId: string; workspaceId: string }>()
    .action(async ({ input }) => {
      try {
        // 如果对话有 sdkSessionId，先通过 SDK 清理 JSONL 历史文件（失败静默）
        const conv = await conversationService.getById(input.workspaceId, input.conversationId);
        if (conv?.sdkSessionId) {
          await tryDeleteSdkSession(input.workspaceId, conv.sdkSessionId);
        }

        await conversationService.deleteConversation(input.workspaceId, input.conversationId);
        // 同步从树中移除
        await treeService.removeConversationFromTree(input.workspaceId, input.conversationId);
        return { success: true, error: undefined };
      } catch (error) {
        console.error('删除对话失败:', error);
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    }),

  archiveConversation: t.procedure
    .input<{ conversationId: string; workspaceId: string }>()
    .action(async ({ input }) => {
      try {
        await conversationService.archiveConversation(input.workspaceId, input.conversationId);
        return { success: true, error: undefined };
      } catch (error) {
        console.error('归档对话失败:', error);
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    }),

  unarchiveConversation: t.procedure
    .input<{ conversationId: string; workspaceId: string }>()
    .action(async ({ input }) => {
      try {
        await conversationService.unarchiveConversation(input.workspaceId, input.conversationId);
        return { success: true, error: undefined };
      } catch (error) {
        console.error('取消归档失败:', error);
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    }),

  /** 列出工作区的已归档对话（按归档时间倒序） */
  listArchivedConversations: t.procedure
    .input<{ workspaceId: string }>()
    .action(async ({ input }) => {
      try {
        const conversations = await conversationService.getArchivedByWorkspace(input.workspaceId);
        return { conversations: conversations.map(conversationService.toCompat), error: undefined };
      } catch (error) {
        console.error('获取归档对话列表失败:', error);
        return { conversations: [], error: error instanceof Error ? error.message : String(error) };
      }
    }),

  // 获取工作区下所有对话（按 updatedAt 倒序）
  getByWorkspaceId: t.procedure
    .input<{ workspaceId: string }>()
    .action(async ({ input }) => {
      try {
        const conversations = await conversationService.getByWorkspaceId(input.workspaceId);
        return { conversations: conversations.map(conversationService.toCompat), error: undefined };
      } catch (error) {
        console.error('获取工作区对话列表失败:', error);
        return { conversations: [], error: error instanceof Error ? error.message : String(error) };
      }
    }),

  createFork: t.procedure
    .input<{ workspaceId: string; title: string; parentConversationId: string; forkMessageSdkUuid: string }>()
    .action(async ({ input }) => {
      try {
        const conversationId = await conversationService.createFork(
          input.workspaceId,
          input.title,
          input.parentConversationId,
          input.forkMessageSdkUuid,
        );
        // 同步添加到树
        await treeService.addConversationToTree(input.workspaceId, conversationId);
        return { conversationId, error: undefined };
      } catch (error) {
        console.error('创建分叉对话失败:', error);
        return { conversationId: null, error: error instanceof Error ? error.message : String(error) };
      }
    }),

  clearForkPending: t.procedure
    .input<{ conversationId: string; workspaceId: string }>()
    .action(async ({ input }) => {
      try {
        await conversationService.clearForkPending(input.workspaceId, input.conversationId);
        return { success: true, error: undefined };
      } catch (error) {
        console.error('清除 fork_pending 失败:', error);
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    }),

  updateConversationPersona: t.procedure
    .input<{ workspaceId: string; conversationId: string; personaId?: string; tempPrompt?: string }>()
    .action(async ({ input }) => {
      try {
        await conversationService.updatePersona(
          input.workspaceId,
          input.conversationId,
          input.personaId,
          input.tempPrompt,
        );
        return { success: true, error: undefined };
      } catch (error) {
        console.error('更新对话人设失败:', error);
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    }),

  // ── 跨工作区查找 ──────────────────────────────────────────

  /** 通过 conversationId 全局查找对话及其所属工作区（独立窗口初始化用） */
  getConversationWithWorkspace: t.procedure
    .input<{ conversationId: string }>()
    .action(async ({ input }) => {
      try {
        const result = await conversationService.getByIdGlobal(input.conversationId);
        if (!result) return { conversation: null, workspaceId: null };
        return {
          conversation: conversationService.toCompat(result.conv),
          workspaceId: result.workspaceId,
        };
      } catch (error) {
        console.error('跨工作区查找对话失败:', error);
        return { conversation: null, workspaceId: null };
      }
    }),

  // ── 对话树操作 ────────────────────────────────────────────

  getConversationTree: t.procedure
    .input<{ workspaceId: string }>()
    .action(async ({ input }) => {
      try {
        const tree = await treeService.getTree(input.workspaceId);
        return { tree, error: undefined };
      } catch (error) {
        console.error('获取对话树失败:', error);
        return { tree: null, error: error instanceof Error ? error.message : String(error) };
      }
    }),

  createConversationFolder: t.procedure
    .input<{ workspaceId: string; name: string; parentId?: string }>()
    .action(async ({ input }) => {
      try {
        const folderId = await treeService.createFolder(input.workspaceId, input.name, input.parentId);
        return { folderId, error: undefined };
      } catch (error) {
        console.error('创建对话文件夹失败:', error);
        return { folderId: null, error: error instanceof Error ? error.message : String(error) };
      }
    }),

  renameConversationFolder: t.procedure
    .input<{ workspaceId: string; folderId: string; name: string }>()
    .action(async ({ input }) => {
      try {
        await treeService.renameFolder(input.workspaceId, input.folderId, input.name);
        return { success: true, error: undefined };
      } catch (error) {
        console.error('重命名对话文件夹失败:', error);
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    }),

  deleteConversationFolder: t.procedure
    .input<{ workspaceId: string; folderId: string }>()
    .action(async ({ input }) => {
      try {
        await treeService.deleteFolder(input.workspaceId, input.folderId);
        return { success: true, error: undefined };
      } catch (error) {
        console.error('删除对话文件夹失败:', error);
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    }),

  moveConversationItem: t.procedure
    .input<{ workspaceId: string; itemId: string; targetParentId: string; targetIndex?: number }>()
    .action(async ({ input }) => {
      try {
        await treeService.moveItem(input.workspaceId, input.itemId, input.targetParentId, input.targetIndex);
        return { success: true, error: undefined };
      } catch (error) {
        console.error('移动对话项目失败:', error);
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    }),
};
