// electron/main/tipc/conversations.ts
import { tipc } from '@egoist/tipc/main';
import { deleteSession } from '@anthropic-ai/claude-agent-sdk';
import fs from 'node:fs/promises';
import * as conversationService from '../services/conversation-service.js';
import * as treeService from '../services/conversation-tree-service.js';
import * as workspaceJsonService from '../services/workspace-json-service.js';
import * as groupService from '../services/group-service.js';
import { deleteUsage } from '../services/usage/usage-service.js';
import { getClaudeConfigDir } from './agent.js';
import { loadSettings } from '../services/settings-service.js';
import { readIndex, writeIndex, removeGroupEverywhere } from '../services/memory/smart-category-store.js';
import { getGroupDir } from '../services/memory/group-digest-store.js';

const t = tipc.create();

/**
 * 调用 SDK deleteSession 清理 JSONL 历史文件。
 * 失败不抛异常（静默），避免阻塞索引删除。
 *
 * 注意：SDK 的 deleteSession 是主进程内直接调用的函数（非 spawn CLI），
 * 它会读取 process.env.CLAUDE_CONFIG_DIR 来定位 JSONL 文件。为保证准确，
 * 调用前临时设置 process.env.CLAUDE_CONFIG_DIR，调用完毕后恢复。
 */
/**
 * 拉取工作区所有 group 的 updatedAt，按倒序重排树。
 * 失败静默：对话本身写入已成功，重排只是 UX 优化。
 */
async function reorderTreeByUpdatedAt(workspaceId: string): Promise<void> {
  try {
    const groups = await groupService.listGroups(workspaceId);
    const map: Record<string, number> = {};
    for (const g of groups) map[g.id] = g.updatedAt;
    await treeService.sortGroupsByUpdatedAt(workspaceId, map);
  } catch (error) {
    console.warn('[reorderTree] 重排对话树失败:', error);
  }
}

/**
 * 删除会话后如果组已空（含归档），联动删除组及其所有关联记录：
 * groups.json / conversation-tree / smart-categories / groups/<id>/ 目录。
 * 任一步失败不阻塞主流程，只 warn。
 */
async function deleteGroupIfEmpty(workspaceId: string, groupId: string): Promise<void> {
  try {
    const remaining = await conversationService.getByWorkspaceId(workspaceId, { includeArchived: true });
    const stillUsed = remaining.some((c) => c.groupId === groupId);
    if (stillUsed) return;

    await groupService.deleteGroup(workspaceId, groupId).catch((err) => {
      console.warn('[auto-delete-group] 删除组条目失败:', err);
    });
    await treeService.removeGroupFromTree(workspaceId, groupId).catch((err) => {
      console.warn('[auto-delete-group] 从对话树移除失败:', err);
    });
    try {
      const idx = await readIndex(workspaceId);
      await writeIndex(workspaceId, removeGroupEverywhere(idx, groupId));
    } catch (err) {
      console.warn('[auto-delete-group] 清理智能分类引用失败:', err);
    }
    try {
      await fs.rm(getGroupDir(workspaceId, groupId), { recursive: true, force: true });
    } catch (err) {
      console.warn('[auto-delete-group] 删除组目录失败:', err);
    }
    console.log('[auto-delete-group] 空组已清理:', groupId);
  } catch (error) {
    console.warn('[auto-delete-group] 空组检测失败:', error);
  }
}

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
    .input<{ workspaceId: string; title?: string; groupId?: string }>()
    .action(async ({ input }) => {
      try {
        const settings = await loadSettings();
        const title = input.title || '新对话';
        const groupId = input.groupId
          ?? (await groupService.createGroup(input.workspaceId, { title })).id;
        const conversationId = await conversationService.create(
          input.workspaceId,
          groupId,
          title,
          settings.ai.defaultModelSelection,
        );
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
        const orphanedGroupId = conv?.groupId;

        await conversationService.deleteConversation(input.workspaceId, input.conversationId);
        // 清理用量 JSONL（失败静默，不阻塞删除）
        await deleteUsage(input.conversationId).catch(() => {});
        if (orphanedGroupId) {
          await deleteGroupIfEmpty(input.workspaceId, orphanedGroupId);
        }
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
        // 顺手把树按 updatedAt 重排一次，让"同层时间倒序"自动收敛
        await reorderTreeByUpdatedAt(input.workspaceId);
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
        const parent = await conversationService.getById(input.workspaceId, input.parentConversationId);
        // fork 继承父对话的 groupId；父对话无 groupId 时（理论上迁移后不存在）新建一组
        const groupId = parent?.groupId
          ?? (await groupService.createGroup(input.workspaceId, { title: input.title })).id;
        const conversationId = await conversationService.createFork(
          input.workspaceId,
          groupId,
          input.title,
          input.parentConversationId,
          input.forkMessageSdkUuid,
          parent?.modelSelection ?? null,
          parent?.cachePolicy ?? '5m',
        );
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

  setConversationModelSelection: t.procedure
    .input<{ workspaceId: string; conversationId: string; selection: import('../services/settings-types.js').ModelSelection | null }>()
    .action(async ({ input }) => {
      try {
        await conversationService.updateModelSelection(
          input.workspaceId,
          input.conversationId,
          input.selection,
        );
        return { success: true, error: undefined };
      } catch (error) {
        console.error('更新对话模型选择失败:', error);
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    }),

  setConversationCachePolicy: t.procedure
    .input<{ workspaceId: string; conversationId: string; policy: '5m' | '1h' }>()
    .action(async ({ input }) => {
      try {
        await conversationService.updateCachePolicy(
          input.workspaceId,
          input.conversationId,
          input.policy,
        );
        return { success: true, error: undefined };
      } catch (error) {
        console.error('更新对话缓存策略失败:', error);
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
        // 拿活跃对话 id 集合（已默认排除 archived）
        const liveConvs = await conversationService.getByWorkspaceId(input.workspaceId);
        const liveIds = new Set(liveConvs.map((c) => c.id));
        // 过滤每个 children 数组：保留 folder + 在 liveIds 中的对话
        const filteredChildren: Record<string, string[]> = {};
        for (const [parentId, childIds] of Object.entries(tree.children)) {
          filteredChildren[parentId] = childIds.filter((id) => tree.folders[id] || liveIds.has(id));
        }
        const filtered = { ...tree, children: filteredChildren };
        return { tree: filtered, error: undefined };
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
        // 移动后按时间倒序重排目标 parent，让对话自动落到顶端
        await reorderTreeByUpdatedAt(input.workspaceId);
        return { success: true, error: undefined };
      } catch (error) {
        console.error('移动对话项目失败:', error);
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    }),

  addGroupToFolder: t.procedure
    .input<{ workspaceId: string; groupId: string; folderId: string }>()
    .action(async ({ input }) => {
      try {
        await treeService.addGroupToFolder(input.workspaceId, input.groupId, input.folderId);
        return { success: true, error: undefined };
      } catch (error) {
        console.error('添加组到文件夹失败:', error);
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    }),

  removeGroupFromFolder: t.procedure
    .input<{ workspaceId: string; groupId: string; folderId: string }>()
    .action(async ({ input }) => {
      try {
        await treeService.removeGroupFromFolder(input.workspaceId, input.groupId, input.folderId);
        return { success: true, error: undefined };
      } catch (error) {
        console.error('从文件夹移除组失败:', error);
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    }),

  moveGroupBetweenFolders: t.procedure
    .input<{ workspaceId: string; groupId: string; fromFolderId: string; toFolderId: string }>()
    .action(async ({ input }) => {
      try {
        await treeService.moveGroupBetweenFolders(
          input.workspaceId, input.groupId, input.fromFolderId, input.toFolderId,
        );
        return { success: true, error: undefined };
      } catch (error) {
        console.error('在文件夹间移动组失败:', error);
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    }),
};
