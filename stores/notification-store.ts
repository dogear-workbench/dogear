import { create } from 'zustand';
import { client } from '@/lib/client';
import { rendererEvents } from '@/lib/events';
import type { NotificationCenterEntry } from '@/types/notification';

interface NotificationState {
  notifications: NotificationCenterEntry[];
  unreadCount: number;
  loaded: boolean;

  loadNotifications: () => Promise<void>;
  markRead: (id: string) => Promise<void>;
  markAllRead: () => Promise<void>;
  /** 监听主进程 notificationsChanged 广播：未开面板只更未读数，面板开着重拉全量 */
  subscribeNotificationsChanged: (isPanelOpen: () => boolean) => () => void;
}

export const useNotificationStore = create<NotificationState>((set, get) => ({
  notifications: [],
  unreadCount: 0,
  loaded: false,

  loadNotifications: async () => {
    try {
      const result = await client.listNotifications({});
      const notifications = result.notifications ?? [];
      set({
        notifications,
        unreadCount: notifications.reduce((n, e) => (e.read ? n : n + 1), 0),
        loaded: true,
      });
    } catch (error) {
      console.error('[notifications] listNotifications 失败:', error);
    }
  },

  markRead: async (id) => {
    set((s) => {
      const notifications = s.notifications.map((e) => (e.id === id ? { ...e, read: true } : e));
      return { notifications, unreadCount: notifications.reduce((n, e) => (e.read ? n : n + 1), 0) };
    });
    try {
      await client.markNotificationRead({ id });
    } catch (error) {
      console.error('[notifications] markRead 失败:', error);
      void get().loadNotifications();
    }
  },

  markAllRead: async () => {
    set((s) => ({
      notifications: s.notifications.map((e) => ({ ...e, read: true })),
      unreadCount: 0,
    }));
    try {
      await client.markAllNotificationsRead({});
    } catch (error) {
      console.error('[notifications] markAllRead 失败:', error);
      void get().loadNotifications();
    }
  },

  subscribeNotificationsChanged: (isPanelOpen) => {
    return rendererEvents.notificationsChanged.listen(({ unreadCount }) => {
      if (isPanelOpen()) {
        void get().loadNotifications();
      } else {
        set({ unreadCount });
      }
    });
  },
}));
