import { create } from 'zustand';
import { toast } from 'sonner';
import { client } from '@/lib/client';
import type { FeishuConnectionState, FeishuTestResult } from '@/types/feishu';

export interface FeishuBotStatus {
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
}

interface FeishuConfigInfo {
  configured: boolean;
  appId?: string;
  botName?: string;
  connectedAt?: string;
}

interface FeishuActionResult {
  success: boolean;
  error?: string;
}

interface FeishuState {
  configExists: boolean;
  botName: string | null;
  connectionState: FeishuConnectionState;
  connectionError: string | null;
  botStatus: FeishuBotStatus | null;

  initialize: () => Promise<void>;
  loadConfig: () => Promise<void>;
  loadConnectionStatus: () => Promise<void>;
  loadBotStatus: () => Promise<void>;
  testConnection: (appId: string, appSecret: string) => Promise<FeishuTestResult>;
  saveAndConnect: (appId: string, appSecret: string) => Promise<FeishuActionResult>;
  reconnect: () => Promise<FeishuActionResult>;
  disconnect: () => Promise<void>;
  botUseConversation: (index: number) => Promise<FeishuActionResult>;
  resetConfig: () => Promise<void>;
}

export const useFeishuStore = create<FeishuState>((set, get) => ({
  configExists: false,
  botName: null,
  connectionState: 'disconnected',
  connectionError: null,
  botStatus: null,

  initialize: async () => {
    await Promise.all([
      get().loadConfig(),
      get().loadConnectionStatus(),
      get().loadBotStatus(),
    ]);
  },

  loadConfig: async () => {
    try {
      const res = await client['feishu:getConfig'](undefined);
      if ('error' in res && res.error) return;
      if ('data' in res) {
        const cfg = res.data as FeishuConfigInfo;
        set({ configExists: !!cfg.configured, botName: cfg.botName || null });
      }
    } catch { /* 忽略 */ }
  },

  loadConnectionStatus: async () => {
    try {
      const res = await client['feishu:getConnectionStatus'](undefined);
      if ('error' in res && res.error) return;
      if ('data' in res) {
        const data = res.data as { state: FeishuConnectionState; errorMessage?: string; botName?: string };
        set({
          connectionState: data.state,
          connectionError: data.errorMessage || null,
          botName: data.botName || get().botName,
        });
      }
    } catch { /* 忽略 */ }
  },

  loadBotStatus: async () => {
    try {
      const data = await client['feishu:getBotStatus'](undefined);
      set({ botStatus: data });
    } catch { /* 忽略 */ }
  },

  testConnection: async (appId, appSecret) => {
    try {
      const res = await client['feishu:testConnection']({
        appId: appId.trim(),
        appSecret: appSecret.trim(),
      });
      if ('error' in res && res.error) {
        return { ok: false, error: res.error };
      }
      if ('data' in res) {
        return res.data as FeishuTestResult;
      }
      return { ok: false, error: '测试失败，请重试' };
    } catch (error) {
      return { ok: false, error: String(error) };
    }
  },

  saveAndConnect: async (appId, appSecret) => {
    try {
      const saveRes = await client['feishu:saveConfig']({
        appId: appId.trim(),
        appSecret: appSecret.trim(),
      });
      if ('error' in saveRes && saveRes.error) {
        return { success: false, error: saveRes.error };
      }
      const connectRes = await client['feishu:connect'](undefined);
      if ('error' in connectRes && connectRes.error) {
        await get().loadConfig();
        return { success: false, error: connectRes.error };
      }
      await Promise.all([
        get().loadConfig(),
        get().loadConnectionStatus(),
        get().loadBotStatus(),
      ]);
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  },

  reconnect: async () => {
    try {
      const res = await client['feishu:connect'](undefined);
      if ('error' in res && res.error) {
        return { success: false, error: res.error };
      }
      await get().loadConnectionStatus();
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  },

  disconnect: async () => {
    try {
      await client['feishu:disconnect'](undefined);
      set({
        connectionState: 'disconnected',
        connectionError: null,
        botStatus: null,
      });
    } catch (error) {
      toast.error('断开失败', { description: String(error) });
    }
  },

  botUseConversation: async (index) => {
    try {
      const result = await client['feishu:botUseConversation']({ index });
      if (result.success) {
        await get().loadBotStatus();
      }
      return result;
    } catch (error) {
      return { success: false, error: String(error) };
    }
  },

  resetConfig: async () => {
    try {
      await client['feishu:disconnect'](undefined);
      const res = await client['feishu:clearConfig'](undefined);
      if ('error' in res && res.error) {
        toast.error('清除凭证失败', { description: res.error });
        return;
      }
      set({
        configExists: false,
        botName: null,
        connectionState: 'disconnected',
        connectionError: null,
        botStatus: null,
      });
    } catch (error) {
      toast.error('清除凭证失败', { description: String(error) });
    }
  },
}));

if (typeof window !== 'undefined') {
  import('@/lib/events').then(({ rendererEvents }) => {
    rendererEvents.feishuConnectionStatus.listen((data) => {
      useFeishuStore.setState({
        connectionState: data.state,
        connectionError: data.errorMessage || null,
      });
    });
    rendererEvents.feishuBotAutoInit.listen((data) => {
      useFeishuStore.setState({ botStatus: data });
    });
    rendererEvents.feishuBotBindingChanged.listen(() => {
      void useFeishuStore.getState().loadBotStatus();
    });
  });
}
