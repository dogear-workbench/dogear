import { tipc } from '@egoist/tipc/main';
import { getNotificationCenterService } from '../services/notification-center-service.js';

const t = tipc.create();

export const notificationsRouter = {
  listNotifications: t.procedure
    .input<Record<string, never>>()
    .action(async () => {
      return { notifications: await getNotificationCenterService().list() };
    }),

  markNotificationRead: t.procedure
    .input<{ id: string }>()
    .action(async ({ input }) => {
      await getNotificationCenterService().markRead(input.id);
      return { ok: true };
    }),

  markAllNotificationsRead: t.procedure
    .input<Record<string, never>>()
    .action(async () => {
      await getNotificationCenterService().markAllRead();
      return { ok: true };
    }),
};
