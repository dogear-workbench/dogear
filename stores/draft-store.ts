import { create } from 'zustand';
import { toast } from 'sonner';
import { client } from '@/lib/client';
import { useConversationStore } from '@/stores/conversation-store';
import { useReferenceStore } from '@/stores/reference-store';
import { useSettingsStore } from '@/stores/settings-store';
import { useWorkspaceStore } from '@/stores/workspace-store';
import type { PermissionMode } from '@/types/electron-api';
import type { ModelSelection } from '@/types/settings';

export interface DraftImage {
  media_type: string;
  data: string;
}

export const DRAFT_ANCHOR_PREFIX = 'draft';

// 带工作区后缀：reference-store 无工作区维度，裸 'draft' 会让各工作区草稿互相串引用
export const draftAnchorId = (workspaceId: string) => `${DRAFT_ANCHOR_PREFIX}:${workspaceId}`;

export const isDraftAnchorId = (id: string) => id.startsWith(`${DRAFT_ANCHOR_PREFIX}:`);

export interface DraftSlot {
  groupId: string | null;
  groupTitle: string | null;
  modelSelection: ModelSelection | null;
  /** null = 跟随全局默认，落盘时随首条消息应用到新会话 */
  permissionMode: PermissionMode | null;
  input: string;
  pendingImages: DraftImage[];
  draftActive: boolean;
}

/**
 * 首条消息载荷：createAndSend 落盘成功后暂存，待 AgentChat 挂载后由 useSendMessage
 * 按 conversationId 匹配消费并自动发送，消费成功后清空。
 */
export interface PendingFirstMessage {
  conversationId: string;
  text: string;
  images: DraftImage[];
  modelSelection: ModelSelection | null;
  permissionMode: PermissionMode | null;
}

interface DraftState {
  /** 按工作区分槽，键为 workspaceId；「当前槽」由 workspace-store 的当前工作区派生，切工作区不动槽 */
  slots: Record<string, DraftSlot>;
  /** 落盘链路进行中，锁输入防重复触发；全局单值（落盘链路同一时间至多一条） */
  creating: boolean;
  pendingFirstMessage: PendingFirstMessage | null;

  /** 进入草稿态并点亮草稿行（draftActive）；槽内同语境幂等，跨语境换语境保留内容 */
  enterDraft: (workspaceId: string, groupId?: string, groupTitle?: string) => void;
  setInput: (text: string) => void;
  setModelSelection: (selection: ModelSelection | null) => void;
  setPermissionMode: (mode: PermissionMode | null) => void;
  setPendingImages: (images: DraftImage[]) => void;
  /** 发送即落盘：建组（无语境时）→ 建会话 → 预 attach → 暂存首条消息 → 开 tab；任一步失败保留草稿可重试 */
  createAndSend: () => Promise<void>;
  /** 原子取出 pendingFirstMessage（取出即清空）；调用方须先校验 conversationId 匹配，不匹配不得取出 */
  consumePendingFirstMessage: () => PendingFirstMessage | null;
  /** 删除当前工作区槽（内容与语境整体放弃） */
  clear: () => void;
  getSlot: (workspaceId: string) => DraftSlot | undefined;
}

const emptySlot = (): DraftSlot => ({
  groupId: null,
  groupTitle: null,
  modelSelection: null,
  permissionMode: null,
  input: '',
  pendingImages: [],
  draftActive: false,
});

const currentWsId = () => useWorkspaceStore.getState().workspace?.id;

export const useDraftStore = create<DraftState>((set, get) => {
  const patchSlot = (workspaceId: string, patch: (slot: DraftSlot) => DraftSlot) => {
    set((state) => {
      const slot = state.slots[workspaceId];
      if (!slot) return state;
      return { slots: { ...state.slots, [workspaceId]: patch(slot) } };
    });
  };

  const upsertSlot = (workspaceId: string, patch: (slot: DraftSlot) => DraftSlot) => {
    set((state) => {
      const slot = state.slots[workspaceId] ?? emptySlot();
      return { slots: { ...state.slots, [workspaceId]: patch(slot) } };
    });
  };

  return {
    slots: {},
    creating: false,
    pendingFirstMessage: null,

    enterDraft: (workspaceId, groupId, groupTitle) => {
      upsertSlot(workspaceId, (slot) => {
        if ((slot.groupId ?? null) === (groupId ?? null)) {
          return slot.draftActive ? slot : { ...slot, draftActive: true };
        }
        return { ...slot, groupId: groupId ?? null, groupTitle: groupTitle ?? null, draftActive: true };
      });
    },

    setInput: (text) => {
      const wsId = currentWsId();
      if (wsId) upsertSlot(wsId, (slot) => ({ ...slot, input: text }));
    },

    setModelSelection: (selection) => {
      const wsId = currentWsId();
      if (wsId) upsertSlot(wsId, (slot) => ({ ...slot, modelSelection: selection }));
    },

    setPermissionMode: (mode) => {
      const wsId = currentWsId();
      if (wsId) upsertSlot(wsId, (slot) => ({ ...slot, permissionMode: mode }));
    },

    setPendingImages: (images) => {
      const wsId = currentWsId();
      if (wsId) upsertSlot(wsId, (slot) => ({ ...slot, pendingImages: images }));
    },

    createAndSend: async () => {
      const s = get();
      const wsId = currentWsId();
      const slot = wsId ? s.slots[wsId] : undefined;
      if (s.creating || !wsId || !slot) return;
      if (!slot.input.trim() && slot.pendingImages.length === 0) return;
      set({ creating: true });

      const fail = (description: string) => {
        toast.error('发送失败', { description });
        set({ creating: false });
      };

      try {
        let groupId = slot.groupId;
        if (!groupId) {
          const { useGroupStore } = await import('./group-store');
          const group = await useGroupStore.getState().createGroup();
          if (!group) {
            // createGroup 内部已 toast，这里只解锁
            set({ creating: false });
            return;
          }
          groupId = group.id;
          // 建组成功即写回语境：后续步骤失败重试时复用，不重复建空组
          patchSlot(wsId, (slot) => ({ ...slot, groupId }));
        }

        const result = await client.create({ workspaceId: wsId, groupId });
        if (result.error || !result.conversationId) {
          return fail(result.error || '未知错误');
        }
        const conversationId = result.conversationId;

        // 引用从草稿伪锚一次性迁移到落盘会话 id，新会话挂载后 useSendMessage 按新 id 过滤注入
        useReferenceStore.getState().reanchorAllFor(draftAnchorId(wsId), conversationId);

        // 预 attach 消除 isSessionReady 窗口期，失败不阻断（useAgentSession effect 会重试正常 attach）
        try {
          const attachResult = await client.attachConversationRuntime({ conversationId, workspaceId: wsId });
          if (!attachResult.error && attachResult.sessionId) {
            useConversationStore.getState().setPreAttachedSession({
              conversationId,
              attachmentId: attachResult.attachmentId!,
              sessionId: attachResult.sessionId,
              permissionMode: (attachResult.permissionMode || 'default') as import('@/types/electron-api').PermissionMode,
              snapshot: (attachResult.snapshot ?? []) as import('@/types/electron-api').ExtendedSessionMessage[],
              turnEntryIds: attachResult.turnEntryIds ?? [],
              pendingPermissionRequests: attachResult.pendingPermissionRequests ?? [],
              sessionState: attachResult.sessionState ?? { running: false, pendingAction: false, paused: false },
            });
          }
        } catch {
          // 预 attach 失败不阻断流程
        }

        // client.create 落 modelSelection=null；草稿选过用草稿选择，否则回退全局默认，
        // 保证会话 modelSelection 明确（首条消息自动发送与输入区都依赖非空）
        const selection = slot.modelSelection ?? useSettingsStore.getState().settings.ai.defaultModelSelection;
        if (selection) {
          await client.setConversationModelSelection({ workspaceId: wsId, conversationId, selection });
        }

        set({
          pendingFirstMessage: {
            conversationId,
            text: slot.input,
            images: slot.pendingImages,
            modelSelection: slot.modelSelection,
            permissionMode: slot.permissionMode,
          },
        });

        const convResult = await client.getById({ conversationId, workspaceId: wsId });
        if (!convResult.conversation) {
          return fail('新会话详情获取失败');
        }
        const conv = convResult.conversation;

        await useConversationStore.getState().selectConversation(conv);

        // pendingFirstMessage 保留给新会话挂载后的 useSendMessage 消费，其余草稿内容清空
        patchSlot(wsId, (slot) => ({
          ...slot,
          groupId: null,
          groupTitle: null,
          input: '',
          pendingImages: [],
          draftActive: false,
        }));
        set({ creating: false });
      } catch (error) {
        fail(error instanceof Error ? error.message : String(error));
      }
    },

    consumePendingFirstMessage: () => {
      const pending = get().pendingFirstMessage;
      if (pending) set({ pendingFirstMessage: null });
      return pending;
    },

    clear: () => {
      const wsId = currentWsId();
      if (!wsId) return;
      set((state) => {
        if (!state.slots[wsId]) return state;
        const slots = { ...state.slots };
        delete slots[wsId];
        return { slots };
      });
    },

    getSlot: (workspaceId) => get().slots[workspaceId],
  };
});
