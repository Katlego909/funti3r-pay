import { api } from './client.js';

export interface AppNotification {
  id: string;
  type: string;
  title: string;
  body: string;
  entity_type: string | null;
  entity_id: string | null;
  read_at: string | null;
  created_at: string;
}

export interface NotificationsResponse {
  notifications: AppNotification[];
  unreadCount: number;
}

export async function fetchNotifications(limit = 30): Promise<NotificationsResponse> {
  const res = await api.get<NotificationsResponse>(`/notifications?limit=${limit}`);
  return res.data;
}

export async function markNotificationRead(id: string): Promise<void> {
  await api.patch(`/notifications/${id}/read`);
}

export async function markAllNotificationsRead(): Promise<void> {
  await api.patch('/notifications/read-all');
}
