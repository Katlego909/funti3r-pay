import { Router, Request, Response } from 'express';
import { query } from '@funti3r/database';
import { createLogger } from '@funti3r/shared-utils';

const router = Router();
const logger = createLogger('SchedulesRoute');

// ── Auth guard ────────────────────────────────────────────────────────────────

function requireEnterprise(req: Request, res: Response): string | null {
  const userId = req.headers['x-user-id'] as string | undefined;
  const role = req.headers['x-user-role'] as string | undefined;
  if (role !== 'enterprise' || !userId) {
    res.status(403).json({ error: 'Enterprise role required' });
    return null;
  }
  return userId;
}

// ── Next-run helper (duplicated from scheduler to keep routes self-contained) ─

const DAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

function computeFirstRun(frequency: string, runDay: string, timezone: string): Date {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(new Date()).map(({ type, value }) => [type, value]),
  );
  const localNow = new Date(
    `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:00`,
  );
  const result = new Date(localNow);

  if (frequency === 'weekly' || frequency === 'biweekly') {
    const targetDow = DAY_NAMES.indexOf(runDay.toLowerCase());
    if (targetDow === -1) throw new Error(`Invalid run_day: ${runDay}`);
    let daysUntil = (targetDow - result.getDay() + 7) % 7 || 7;
    if (frequency === 'biweekly') daysUntil = daysUntil <= 7 ? daysUntil + 7 : daysUntil;
    result.setDate(result.getDate() + daysUntil);
  } else {
    const targetDom = parseInt(runDay, 10);
    if (isNaN(targetDom) || targetDom < 1 || targetDom > 28) {
      throw new Error(`Invalid run_day for monthly: ${runDay}`);
    }
    result.setDate(targetDom);
    if (result <= localNow) {
      result.setMonth(result.getMonth() + 1);
      result.setDate(targetDom);
    }
  }

  result.setHours(9, 0, 0, 0);
  return result;
}

// ── GET /schedules ────────────────────────────────────────────────────────────

router.get('/', async (req: Request, res: Response) => {
  const enterpriseId = requireEnterprise(req, res);
  if (!enterpriseId) return;

  try {
    const schedulesRes = await query<{
      id: string; name: string; frequency: string; run_day: string;
      timezone: string; next_run_at: string; last_run_at: string | null;
      last_run_status: string | null; status: string; created_at: string;
    }>(
      `SELECT id, name, frequency, run_day, timezone, next_run_at, last_run_at,
              last_run_status, status, created_at
         FROM payment_schedules
        WHERE enterprise_id = $1
        ORDER BY created_at DESC`,
      [enterpriseId],
    );

    const scheduleIds = schedulesRes.rows.map((s) => s.id);
    let itemsBySchedule: Record<string, Array<{ worker_id: string; amount_usd: string; memo: string | null }>> = {};

    if (scheduleIds.length > 0) {
      const itemsRes = await query<{ schedule_id: string; worker_id: string; amount_usd: string; memo: string | null }>(
        `SELECT schedule_id, worker_id, amount_usd, memo
           FROM payment_schedule_items
          WHERE schedule_id = ANY($1::uuid[])`,
        [scheduleIds],
      );
      for (const item of itemsRes.rows) {
        if (!itemsBySchedule[item.schedule_id]) itemsBySchedule[item.schedule_id] = [];
        itemsBySchedule[item.schedule_id].push(item);
      }
    }

    const schedules = schedulesRes.rows.map((s) => ({
      ...s,
      items: (itemsBySchedule[s.id] ?? []).map((i) => ({
        workerId: i.worker_id,
        amountUsd: Number(i.amount_usd),
        memo: i.memo,
      })),
    }));

    res.json({ schedules });
  } catch (err) {
    logger.error('Failed to list schedules', { error: String(err) });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── POST /schedules ───────────────────────────────────────────────────────────

router.post('/', async (req: Request, res: Response) => {
  const enterpriseId = requireEnterprise(req, res);
  if (!enterpriseId) return;

  const { name, frequency, runDay, timezone = 'UTC', items } = req.body as {
    name: string;
    frequency: string;
    runDay: string;
    timezone?: string;
    items: Array<{ workerId: string; amountUsd: number; memo?: string }>;
  };

  if (!name?.trim()) return res.status(400).json({ error: 'name is required' });
  if (!['weekly', 'biweekly', 'monthly'].includes(frequency)) {
    return res.status(400).json({ error: 'frequency must be weekly, biweekly, or monthly' });
  }
  if (!runDay?.trim()) return res.status(400).json({ error: 'runDay is required' });
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'items must be a non-empty array' });
  }
  for (const item of items) {
    if (!item.workerId || !item.amountUsd || item.amountUsd <= 0) {
      return res.status(400).json({ error: 'Each item requires workerId and a positive amountUsd' });
    }
  }

  let nextRunAt: Date;
  try {
    nextRunAt = computeFirstRun(frequency, runDay, timezone);
  } catch (err) {
    return res.status(400).json({ error: err instanceof Error ? err.message : 'Invalid schedule parameters' });
  }

  try {
    const scheduleRes = await query<{ id: string }>(
      `INSERT INTO payment_schedules
         (enterprise_id, name, frequency, run_day, timezone, next_run_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [enterpriseId, name.trim(), frequency, runDay.trim(), timezone, nextRunAt.toISOString()],
    );
    const scheduleId = scheduleRes.rows[0].id;

    for (const item of items) {
      await query(
        `INSERT INTO payment_schedule_items (schedule_id, worker_id, amount_usd, memo)
         VALUES ($1, $2, $3, $4)`,
        [scheduleId, item.workerId, item.amountUsd, item.memo ?? null],
      );
    }

    logger.info('Schedule created', { scheduleId, enterpriseId, name, frequency, nextRunAt });
    res.status(201).json({ scheduleId, nextRunAt });
  } catch (err) {
    logger.error('Failed to create schedule', { error: String(err) });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── PATCH /schedules/:id ──────────────────────────────────────────────────────

router.patch('/:id', async (req: Request, res: Response) => {
  const enterpriseId = requireEnterprise(req, res);
  if (!enterpriseId) return;

  const { id } = req.params;
  const { status } = req.body as { status: 'active' | 'paused' };

  if (!['active', 'paused'].includes(status)) {
    return res.status(400).json({ error: 'status must be active or paused' });
  }

  try {
    const result = await query(
      `UPDATE payment_schedules
          SET status = $1, updated_at = NOW()
        WHERE id = $2 AND enterprise_id = $3
       RETURNING id`,
      [status, id, enterpriseId],
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Schedule not found' });
    res.json({ id, status });
  } catch (err) {
    logger.error('Failed to update schedule', { error: String(err) });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── DELETE /schedules/:id ─────────────────────────────────────────────────────

router.delete('/:id', async (req: Request, res: Response) => {
  const enterpriseId = requireEnterprise(req, res);
  if (!enterpriseId) return;

  const { id } = req.params;

  try {
    const result = await query(
      `DELETE FROM payment_schedules WHERE id = $1 AND enterprise_id = $2 RETURNING id`,
      [id, enterpriseId],
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Schedule not found' });
    res.json({ deleted: true });
  } catch (err) {
    logger.error('Failed to delete schedule', { error: String(err) });
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
