/** A timestamp as the operator reads it: local date and time to the minute, or a dash. */
export function when(value: string | null | undefined): string {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

/** An id, hash or address shortened to its ends, for tables; the full value stays in the title and copy button. */
export function short(value: string | null | undefined, keep = 6): string {
  if (!value) return '—';
  return value.length > keep * 2 + 1 ? `${value.slice(0, keep)}…${value.slice(-4)}` : value;
}

/** An amount with its currency, without trailing zeros noise. */
export function money(amount: string | number | null | undefined, currency?: string | null): string {
  if (amount === null || amount === undefined || amount === '') return '—';
  const n = Number(amount);
  const text = Number.isFinite(n) ? n.toLocaleString(undefined, { maximumFractionDigits: 7 }) : String(amount);
  return currency ? `${text} ${currency}` : text;
}
