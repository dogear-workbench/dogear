import { create } from 'zustand';
import { toast } from 'sonner';
import { client } from '@/lib/client';
import type { WechatAuthState, WechatQRCode, WechatMessage } from '@/types/wechat';

interface WechatState {
  // 认证
  authState: WechatAuthState;
  qrCode: WechatQRCode | null;
  botName: string | null;

  // 连接
  polling: boolean;
  connectionError: string | null;

  // 消息流（bot 对话，单一上下文）
  messages: WechatMessage[];
  loadingMessages: boolean;
  /** 最近一条来自用户的消息的 context_token，用于回复 */
  contextToken: string | null;
  /** 最近一条来自用户的消息的 sender（用于回复 to_user_id） */
  lastSenderId: string | null;

  // 发送
  sending: boolean;

  // Bot 自动初始化数据（startPolling 后推送）
  autoInitData: {
    status: {
      workspaceId: string | null;
      workspaceName: string | null;
      conversationId: string | null;
      conversationTitle: string | null;
      debugMode: boolean;
    };
    conversations: Array<{
      index: number;
      id: string;
      title: string;
      updatedAt: string;
    }>;
  } | null;

  // 动作
  loadAuthStatus: () => Promise<void>;
  startAuth: () => Promise<void>;
  disconnect: () => Promise<void>;
  startPolling: () => Promise<void>;
  stopPolling: () => Promise<void>;
  loadHistory: () => Promise<void>;
  sendMessage: (content: string) => Promise<void>;
  /** 查询 bot 当前状态（Dialog 打开且已连接时调用） */
  loadBotStatus: () => Promise<void>;
  /** 前端点击"使用"按钮，通知 bot 切换对话 */
  botUseConversation: (index: number) => Promise<{ success: boolean; error?: string }>;

  // 事件回调
  handleNewMessages: (messages: WechatMessage[]) => void;
  handleAuthStatusChange: (state: string, botName?: string, errorMessage?: string) => void;
  handleConnectionStatusChange: (polling: boolean, lastPollAt?: string, errorMessage?: string) => void;
}

export const useWechatStore = create<WechatState>((set, get) => ({
  authState: 'disconnected',
  qrCode: null,
  botName: null,
  polling: false,
  connectionError: null,
  messages: [],
  loadingMessages: false,
  contextToken: null,
  lastSenderId: null,
  sending: false,
  autoInitData: null,

  // === 认证 ===

  loadAuthStatus: async () => {
    try {
      const res = await client['wechat:getAuthStatus'](undefined);
      if ('error' in res && res.error) return;
      if ('data' in res) {
        const data = res.data as { state?: string; botName?: string };
        set({
          authState: (data.state || 'disconnected') as WechatAuthState,
          botName: data.botName || null,
        });
      }
    } catch { /* 忽略 */ }
  },

  startAuth: async () => {
    try {
      set({ authState: 'qr_pending', qrCode: null });
      const res = await client['wechat:startAuth'](undefined);
      if ('error' in res && res.error) {
        toast.error('获取 QR 码失败', { description: res.error });
        set({ authState: 'disconnected' });
        return;
      }
      if ('data' in res) {
        set({ qrCode: res.data as WechatQRCode });
      }
    } catch (error) {
      toast.error('认证失败', { description: String(error) });
      set({ authState: 'disconnected' });
    }
  },

  disconnect: async () => {
    try {
      await client['wechat:disconnect'](undefined);
      set({
        authState: 'disconnected',
        qrCode: null,
        botName: null,
        polling: false,
        messages: [],
        contextToken: null,
        lastSenderId: null,
      });
    } catch (error) {
      toast.error('断开失败', { description: String(error) });
    }
  },

  // === 轮询 ===

  startPolling: async () => {
    // 防止重复启动（WechatDialog effect 可能多次触发）
    if (get().polling) return;
    try {
      const res = await client['wechat:startPolling'](undefined);
      if ('error' in res && res.error) {
        toast.error('启动轮询失败', { description: res.error });
        return;
      }
      set({ polling: true, connectionError: null });
    } catch (error) {
      toast.error('启动轮询失败', { description: String(error) });
    }
  },

  stopPolling: async () => {
    try {
      await client['wechat:stopPolling'](undefined);
      set({ polling: false });
    } catch { /* 忽略 */ }
  },

  // === 消息 ===

  loadHistory: async () => {
    set({ loadingMessages: true });
    try {
      const res = await client['wechat:getMessages']({ contactId: '_bot_', limit: 100 });
      if ('error' in res && res.error) return;
      if ('data' in res) {
        const msgs = res.data as WechatMessage[];
        // 找最后一条来自用户的消息，提取 contextToken
        const lastIncoming = [...msgs].reverse().find(m => !m.isOutgoing);
        set({
          messages: msgs,
          contextToken: lastIncoming?.contextToken || null,
          lastSenderId: lastIncoming?.senderId || null,
        });
      }
    } catch { /* 忽略 */ } finally {
      set({ loadingMessages: false });
    }
  },

  sendMessage: async (content: string) => {
    const { contextToken, lastSenderId, messages } = get();
    if (!contextToken || !lastSenderId) {
      toast.error('无法发送', { description: '需要先收到对方的消息才能回复' });
      return;
    }

    set({ sending: true });
    try {
      const res = await client['wechat:sendMessage']({
        contextToken,
        toUserId: lastSenderId,
        content,
      });
      if ('error' in res && res.error) {
        toast.error('发送失败', { description: res.error });
        return;
      }

      // 乐观更新
      const outgoing: WechatMessage = {
        id: `out_${Date.now()}`,
        contextToken,
        senderId: 'self',
        senderName: '我',
        content,
        messageType: 'text',
        timestamp: Date.now(),
        isGroup: false,
        isOutgoing: true,
      };
      set({ messages: [...messages, outgoing] });
    } catch (error) {
      toast.error('发送失败', { description: String(error) });
    } finally {
      set({ sending: false });
    }
  },

  // === 事件回调 ===

  handleNewMessages: (newMessages: WechatMessage[]) => {
    const { messages, contextToken } = get();

    // 更新 contextToken（用最新收到的消息）
    const lastIncoming = [...newMessages].reverse().find(m => !m.isOutgoing);
    const updates: Partial<WechatState> = {
      messages: [...messages, ...newMessages],
    };
    if (lastIncoming) {
      updates.contextToken = lastIncoming.contextToken || contextToken;
      updates.lastSenderId = lastIncoming.senderId;
    }
    set(updates);
  },

  handleAuthStatusChange: (state: string, botName?: string, errorMessage?: string) => {
    set({
      authState: state as WechatAuthState,
      botName: botName || get().botName,
    });
    if (errorMessage) {
      toast.error('微信认证', { description: errorMessage });
    }
    if (state === 'connected') {
      set({ qrCode: null });
    }
  },

  handleConnectionStatusChange: (polling: boolean, _lastPollAt?: string, errorMessage?: string) => {
    set({
      polling,
      connectionError: errorMessage || null,
    });
  },

  loadBotStatus: async () => {
    try {
      const data = await client['wechat:getBotStatus'](undefined);
      set({ autoInitData: data });
    } catch { /* ignore */ }
  },

  botUseConversation: async (index: number): Promise<{ success: boolean; error?: string }> => {
    try {
      const result = await client['wechat:botUseConversation']({ index });
      if (result.success) {
        get().loadBotStatus();
      }
      return result;
    } catch (error) {
      return { success: false, error: String(error) };
    }
  },
}));

if (typeof window !== 'undefined') {
  import('@/lib/events').then(({ rendererEvents }) => {
    rendererEvents.wechatBotAutoInit.listen((data) => {
      useWechatStore.setState({ autoInitData: data });
    });
  });
}
