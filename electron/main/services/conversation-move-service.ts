/**
 * 会话跨工作区移动（Step 4 移入工作区）
 *
 * 执行链：校验（目标工作区存在 / 目标组有效 / session 非运行中）→ 关闭存活 session 释放
 * JSONL 文件句柄 → 目标侧索引 importConversation（保留原 ID）→ session JSONL 搬运 +
 * pi-session-repository 两侧缓存失效 → personal 侧索引与隐式单会话组清理 → touch 目标组。
 * 各步骤失败时回滚已落盘动作，personal 侧数据保持完整。
 */
import * as conversationService from './conversation-service.js';
import * as groupService from './group-service.js';
import * as workspaceJsonService from './workspace-json-service.js';
import { conversationRuntimeService } from './conversation-runtime-service.js';
import { getPiSessionManager } from '../agents/pi-session/pi-session-manager.js';
import { getPiSessionRepository } from '../agents/pi-session/pi-session-repository.js';
import { PERSONAL_WORKSPACE_ID } from '../types.js';

export type MoveConversationResult =
  | { ok: true; conversationId: string; groupId: string; workspaceId: string }
  | { ok: false; error: string };

export interface MoveConversationInput {
  conversationId: string;
  targetWorkspaceId: string;
  /** 现有目标组 id；与 newGroupTitle 二选一，同时提供时以 targetGroupId 为准 */
  targetGroupId?: string;
  /** 新建组标题；缺省回退会话标题 */
  newGroupTitle?: string;
}

function fail(error: unknown): MoveConversationResult {
  return { ok: false, error: error instanceof Error ? error.message : String(error) };
}

export async function moveConversationToWorkspace(input: MoveConversationInput): Promise<MoveConversationResult> {
  const { conversationId, targetWorkspaceId } = input;
  try {
    if (!targetWorkspaceId || targetWorkspaceId === PERSONAL_WORKSPACE_ID) {
      return { ok: false, error: '目标工作区无效' };
    }
    const targetWorkspace = await workspaceJsonService.getById(targetWorkspaceId);
    if (!targetWorkspace) return { ok: false, error: '目标工作区不存在' };

    const conv = await conversationService.getById(PERSONAL_WORKSPACE_ID, conversationId);
    if (!conv) return { ok: false, error: '临时会话不存在' };

    const manager = getPiSessionManager();
    const liveSessionId = manager.getSessionIdByConversation(conversationId);
    const liveSession = liveSessionId ? manager.getSession(liveSessionId) : undefined;
    if (liveSession?.isRunning()) {
      return { ok: false, error: '会话正在运行，请等当前回复结束后再移入' };
    }

    await conversationRuntimeService.closeConversation(conversationId);

    let groupId: string;
    if (input.targetGroupId) {
      await groupService.requireActiveGroup(targetWorkspaceId, input.targetGroupId);
      groupId = input.targetGroupId;
    } else {
      groupId = (await groupService.createGroup(targetWorkspaceId, {
        title: input.newGroupTitle?.trim() || conv.title,
      })).id;
    }

    try {
      await conversationService.importConversation(targetWorkspaceId, { ...conv, groupId });
    } catch (error) {
      return fail(error);
    }

    if (conv.sessionId) {
      try {
        await getPiSessionRepository().relocateSession(PERSONAL_WORKSPACE_ID, targetWorkspaceId, conv.sessionId);
      } catch (error) {
        await conversationService.deleteConversation(targetWorkspaceId, conversationId).catch(() => {});
        return fail(error);
      }
    }

    try {
      await conversationService.deleteConversation(PERSONAL_WORKSPACE_ID, conversationId);
    } catch (error) {
      await conversationService.deleteConversation(targetWorkspaceId, conversationId).catch(() => {});
      if (conv.sessionId) {
        await getPiSessionRepository()
          .relocateSession(targetWorkspaceId, PERSONAL_WORKSPACE_ID, conv.sessionId).catch(() => {});
      }
      return fail(error);
    }

    if (conv.groupId) {
      await groupService.deleteGroup(PERSONAL_WORKSPACE_ID, conv.groupId).catch((error) => {
        console.warn('[moveConversation] personal 隐式组清理失败（不影响移入）:', error);
      });
    }
    await groupService.touchGroup(targetWorkspaceId, groupId).catch(() => {});

    return { ok: true, conversationId, groupId, workspaceId: targetWorkspaceId };
  } catch (error) {
    return fail(error);
  }
}
