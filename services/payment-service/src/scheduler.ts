import cron from 'node-cron';
import axios from 'axios';
import { query } from '@funti3r/database';
import { createLogger } from '@funti3r/shared-utils';

const logger = createLogger('Scheduler');

// ── Next-run calculation ──────────────────────────────────────────────────────

const DAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

function nextRunDate(frequency: string, runDay: string, timezone: string, from: Date): Date {
  // Work in the enterprise's timezone by shifting the reference date.
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });

  const parts = Object.fromEntries(
    formatter.formatToParts(from).map(({ type, value }) => [type, value]),
  );
  const localNow = new Date(
    `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:00`,
  );

  const result = new Date(localNow);

  if (frequency === 'weekly' || frequency === 'biweekly') {
    const targetDow = DAY_NAMES.indexOf(runDay.toLowerCase());
    if (targetDow === -1) throw new Error(`Invalid run_day for ${frequency}: ${runDay}`);
    const currentDow = result.getDay();
    let daysUntil = (targetDow - currentDow + 7) % 7 || 7;
    if (frequency === 'biweekly') daysUntil = daysUntil <= 7 ? daysUntil + 7 : daysUntil;
    result.setDate(result.getDate() + daysUntil);
  } else {
    // monthly — runDay is a day-of-month number ('1'–'28')
    const targetDom = parseInt(runDay, 10);
    if (isNaN(targetDom) || targetDom < 1 || targetDom > 28) {
      throw new Error(`Invalid run_day for monthly: ${runDay}`);
    }
    result.setDate(targetDom);
    // If that day has already passed this month, advance to next month
    if (result <= localNow) {
      result.setMonth(result.getMonth() + 1);
      result.setDate(targetDom);
    }
  }

  // Set to 09:00 local time so payments run in business hours
  result.setHours(9, 0, 0, 0);
  return result;
}

// ── Schedule executor ─────────────────────────────────────────────────────────

const PAYMENT_SERVICE_URL = `http://localhost:${process.env.PAYMENT_SERVICE_PORT ?? 3002}`;

async function runDueSchedules(): Promise<void> {
  // Claim due schedules atomically: update next_run_at first so a concurrent
  // run (e.g. after a restart) won't pick the same schedule again.
  const claimed = await query<{
    id: string;
    enterprise_id: string;
    name: string;
    frequency: string;
    run_day: string;
    timezone: string;
  }>(`
    UPDATE payment_schedules
    SET last_run_at = NOW(), updated_at = NOW()
    WHERE status = 'active' AND next_run_at <= NOW()
    RETURNING id, enterprise_id, name, frequency, run_day, timezone
  `);

  if (claimed.rows.length === 0) return;

  logger.info(`Running ${claimed.rows.length} due schedule(s)`);

  for (const schedule of claimed.rows) {
    await executeSchedule(schedule);
  }
}

async function executeSchedule(schedule: {
  id: string;
  enterprise_id: string;
  name: string;
  frequency: string;
  run_day: string;
  timezone: string;
}): Promise<void> {
  const { id, enterprise_id, name, frequency, run_day, timezone } = schedule;

  const itemsRes = await query<{ worker_id: string; amount_usd: string; memo: string | null }>(
    'SELECT worker_id, amount_usd, memo FROM payment_schedule_items WHERE schedule_id = $1',
    [id],
  );

  if (itemsRes.rows.length === 0) {
    logger.warn('Schedule has no items — skipping', { scheduleId: id });
    await updateScheduleAfterRun(id, frequency, run_day, timezone, 'failed');
    return;
  }

  const items = itemsRes.rows.map((r) => ({
    workerId: r.worker_id,
    amount: Number(r.amount_usd),
    memo: r.memo ?? undefined,
  }));

  let runStatus: 'success' | 'partial' | 'failed' = 'failed';

  try {
    const response = await axios.post(
      `${PAYMENT_SERVICE_URL}/payouts/batch`,
      { enterpriseId: enterprise_id, currency: 'USDC', items },
      {
        headers: {
          'x-user-id': enterprise_id,
          'x-user-role': 'enterprise',
          'content-type': 'application/json',
        },
        timeout: 120_000,
      },
    );

    runStatus = response.data.status === 'completed' ? 'success'
      : response.data.status === 'partial' ? 'partial'
      : 'failed';

    logger.info('Schedule run complete', {
      scheduleId: id,
      name,
      status: runStatus,
      completed: response.data.completedCount,
      failed: response.data.failedCount,
    });
  } catch (err: any) {
    const detail = err?.response?.data?.error ?? err?.message ?? String(err);
    logger.error('Schedule run failed', { scheduleId: id, name, error: detail });
    runStatus = 'failed';
  }

  await updateScheduleAfterRun(id, frequency, run_day, timezone, runStatus);
}

async function updateScheduleAfterRun(
  id: string,
  frequency: string,
  runDay: string,
  timezone: string,
  runStatus: 'success' | 'partial' | 'failed',
): Promise<void> {
  try {
    const nextRun = nextRunDate(frequency, runDay, timezone, new Date());
    await query(
      `UPDATE payment_schedules
          SET next_run_at = $1, last_run_status = $2, updated_at = NOW()
        WHERE id = $3`,
      [nextRun.toISOString(), runStatus, id],
    );
  } catch (err) {
    logger.error('Failed to update next_run_at', { scheduleId: id, error: String(err) });
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

export function startScheduler(): void {
  // Check for due schedules every hour, on the hour.
  cron.schedule('0 * * * *', () => {
    runDueSchedules().catch((err) =>
      logger.error('Unhandled error in runDueSchedules', { error: String(err) }),
    );
  });

  logger.info('Scheduler started — checking for due schedules every hour');
}
