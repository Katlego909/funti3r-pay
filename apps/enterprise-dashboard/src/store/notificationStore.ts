import { create } from 'zustand';
import {
  type AppNotification,
  fetchNotifications,
  markNotificationRead,
  markAllNotificationsRead,
} from '../api/notifications.js';

interface NotificationState {
  notifications: AppNotification[];
  unreadCount: number;
  loading: boolean;
  fetch: () => Promise<void>;
  markRead: (id: string) => Promise<void>;
  markAllRead: () => Promise<void>;
}

export const useNotificationStore = create<NotificationState>((set, get) => ({
  notifications: [],
  unreadCount: 0,
  loading: false,

  fetch: async () => {
    set({ loading: true });
    try {
      const data = await fetchNotifications();
      set({ notifications: data.notifications, unreadCount: data.unreadCount });
    } catch {
      // Silent — polling failures shouldn't disrupt the UI
    } finally {
      set({ loading: false });
    }
  },

  markRead: async (id: string) => {
    // Optimistic update
    set((s) => ({
      notifications: s.notifications.map((n) =>
        n.id === id ? { ...n, read_at: new Date().toISOString() } : n,
      ),
      unreadCount: Math.max(0, s.unreadCount - 1),
    }));
    try {
      await markNotificationRead(id);
    } catch {
      get().fetch(); // revert on failure
    }
  },

  markAllRead: async () => {
    const now = new Date().toISOString();
    set((s) => ({
      notifications: s.notifications.map((n) => ({ ...n, read_at: n.read_at ?? now })),
      unreadCount: 0,
    }));
    try {
      await markAllNotificationsRead();
    } catch {
      get().fetch();
    }
  },
}));
