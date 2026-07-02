import { api } from './client.js';

export interface ScheduleItem {
  workerId: string;
  amountUsd: number;
  memo?: string;
}

export interface Schedule {
  id: string;
  name: string;
  frequency: 'weekly' | 'biweekly' | 'monthly';
  run_day: string;
  timezone: string;
  next_run_at: string;
  last_run_at: string | null;
  last_run_status: 'success' | 'partial' | 'failed' | null;
  status: 'active' | 'paused';
  created_at: string;
  items: ScheduleItem[];
}

export interface CreateSchedulePayload {
  name: string;
  frequency: 'weekly' | 'biweekly' | 'monthly';
  runDay: string;
  timezone?: string;
  items: ScheduleItem[];
}

export async function listSchedules(): Promise<Schedule[]> {
  const { data } = await api.get<{ schedules: Schedule[] }>('/schedules');
  return data.schedules;
}

export async function createSchedule(payload: CreateSchedulePayload): Promise<{ scheduleId: string; nextRunAt: string }> {
  const { data } = await api.post('/schedules', payload);
  return data;
}

export async function updateScheduleStatus(id: string, status: 'active' | 'paused'): Promise<void> {
  await api.patch(`/schedules/${id}`, { status });
}

export async function deleteSchedule(id: string): Promise<void> {
  await api.delete(`/schedules/${id}`);
}
