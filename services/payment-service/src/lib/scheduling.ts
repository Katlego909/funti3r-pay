const DAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

/**
 * Computes the next run date/time for a payment schedule, in the enterprise's
 * timezone. Shared by the scheduler (advancing a schedule after it runs) and
 * the create-schedule route (computing the first run) so a change to the
 * rule — e.g. the fixed 09:00 run time, or a DST edge case — only has to be
 * made once.
 */
export function nextRunDate(frequency: string, runDay: string, timezone: string, from: Date = new Date()): Date {
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
