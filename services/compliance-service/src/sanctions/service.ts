import { randomUUID } from 'node:crypto';
import axios from 'axios';
import { createLogger } from '@funti3r/shared-utils';
import type { Query } from '../deps.js';
import { openDetails } from '../pii.js';
import { recordKycEvent } from '../events.js';
import { candidateBirthYearFromSubmission, candidateNamesFromSubmission } from '../names.js';
import type { SanctionsEntry } from './list.js';
import { buildIndex, screenNames, type SanctionsIndex, type SanctionsMatch } from './screen.js';
import { parseSdn } from './sdn.js';
import { sanctionsEntries, sanctionsFetchedAt } from '../metrics.js';
import { SANCTIONS_LIST } from './list.js';

const logger = createLogger('Sanctions');

const SDN_URL = process.env.SANCTIONS_SDN_URL || 'https://www.treasury.gov/ofac/downloads/sdn.csv';
const ALT_URL = process.env.SANCTIONS_ALT_URL || 'https://www.treasury.gov/ofac/downloads/alt.csv';
/** A feed this small is a truncated or empty download, not the real list: keep what we have. */
const MIN_PLAUSIBLE_ENTRIES = 5000;
const INSERT_CHUNK = 2000;

export interface SanctionsMeta {
  source: string;
  entryCount: number;
  fetchedAt: string;
}

export interface RefreshResult {
  entries: number;
  rescreened: number;
  newlyFlagged: number;
}

export interface SanctionsService {
  /** `birthYear` (the applicant's, when known) lets the list rule out a namesake with a different birth year. */
  screen(names: string[], birthYear?: number): SanctionsMatch[];
  status(): Promise<SanctionsMeta | null>;
  /** Downloads the list, stores it and re-screens every cleared KYC record against it. */
  refresh(): Promise<RefreshResult>;
}

async function download(url: string): Promise<string> {
  const res = await axios.get<ArrayBuffer>(url, { responseType: 'arraybuffer', timeout: 120_000, maxRedirects: 5 });
  return Buffer.from(res.data).toString('latin1');
}

/** Stores a parsed list as one new batch, then retires the old ones. Readers never see a half-written list. */
export async function storeSanctionsList(query: Query, entries: SanctionsEntry[], source: string): Promise<void> {
  const batch = randomUUID();
  for (let i = 0; i < entries.length; i += INSERT_CHUNK) {
    const chunk = entries.slice(i, i + INSERT_CHUNK);
    await query(
      `INSERT INTO sanctions_entries (batch_id, list, name, aliases, program, birth_years)
       SELECT $1, 'OFAC-SDN', n, string_to_array(a, E'\\x1f'), p, string_to_array(NULLIF(y, ''), ',')::int[]
         FROM unnest($2::text[], $3::text[], $4::text[], $5::text[]) AS t(n, a, p, y)`,
      [
        batch,
        chunk.map((e) => e.name),
        chunk.map((e) => e.aliases.join('\x1f')),
        chunk.map((e) => e.program),
        chunk.map((e) => (e.birthYears ?? []).join(',')),
      ],
    );
  }
  await query(
    `INSERT INTO sanctions_list_meta (id, batch_id, source, entry_count, fetched_at) VALUES (1, $1, $2, $3, NOW())
     ON CONFLICT (id) DO UPDATE SET batch_id = EXCLUDED.batch_id, source = EXCLUDED.source,
       entry_count = EXCLUDED.entry_count, fetched_at = EXCLUDED.fetched_at`,
    [batch, source, entries.length],
  );
  await query(`DELETE FROM sanctions_entries WHERE batch_id <> $1`, [batch]);
}

async function loadStoredEntries(query: Query): Promise<SanctionsEntry[]> {
  const r = await query(
    `SELECT e.name, e.aliases, e.program, e.birth_years FROM sanctions_entries e
       JOIN sanctions_list_meta m ON m.batch_id = e.batch_id`,
  );
  return r.rows.map((row) => ({
    name: row.name as string,
    aliases: (row.aliases as string[]) ?? [],
    program: row.program as string,
    list: 'OFAC-SDN' as const,
    birthYears: (row.birth_years as number[] | null) ?? [],
  }));
}

/**
 * Re-screens every KYC record that is currently clear against the given list. A new match flips the
 * record to flagged + rejected and writes an audit event; the payment service re-checks the verdict
 * before any money moves and revokes the worker's on-chain clearance then.
 */
export async function rescreenClearRecords(query: Query, screen: (names: string[], birthYear?: number) => SanctionsMatch[]): Promise<{ rescreened: number; newlyFlagged: number }> {
  const rows = await query(`SELECT user_id, data FROM kyc_records WHERE sanctions_status = 'clear'`);
  let newlyFlagged = 0;
  for (const row of rows.rows) {
    const details = openDetails(row.data);
    const matches = screen(candidateNamesFromSubmission(details), candidateBirthYearFromSubmission(details));
    if (matches.length === 0) continue;
    await query(
      `UPDATE kyc_records SET sanctions_status = 'flagged', status = 'rejected', sanctions_matches = $2,
              sanctions_checked_at = NOW(), updated_at = NOW() WHERE user_id = $1`,
      [row.user_id, JSON.stringify(matches)],
    );
    await recordKycEvent(query, {
      userId: row.user_id, actorId: null, actorRole: 'system', action: 'rescreened',
      detail: { matches: matches.map((m) => `${m.matchedName} (${m.program})`) },
    });
    newlyFlagged++;
  }
  return { rescreened: rows.rows.length, newlyFlagged };
}

export async function createSanctionsService(query: Query): Promise<SanctionsService> {
  let index: SanctionsIndex = buildIndex(SANCTIONS_LIST);

  async function reload(): Promise<void> {
    const stored = await loadStoredEntries(query);
    const meta = await query(`SELECT entry_count, fetched_at FROM sanctions_list_meta WHERE id = 1`);
    if (meta.rows[0]) {
      sanctionsEntries.set(Number(meta.rows[0].entry_count));
      sanctionsFetchedAt.set(new Date(meta.rows[0].fetched_at).getTime() / 1000);
    }
    // The built-in list stays in as a floor (and carries the QA canary used for demos).
    index = buildIndex([...SANCTIONS_LIST, ...stored]);
  }
  await reload().catch((err) => logger.warn('Could not load the stored sanctions list; using the built-in one', { error: String(err) }));

  const service: SanctionsService = {
    screen: (names, birthYear) => screenNames(names, index, birthYear),

    async status() {
      const r = await query(`SELECT source, entry_count, fetched_at FROM sanctions_list_meta WHERE id = 1`);
      const row = r.rows[0];
      return row ? { source: row.source, entryCount: row.entry_count, fetchedAt: row.fetched_at } : null;
    },

    async refresh() {
      const [sdn, alt] = await Promise.all([download(SDN_URL), download(ALT_URL)]);
      const entries = parseSdn(sdn, alt);
      if (entries.length < MIN_PLAUSIBLE_ENTRIES) {
        throw new Error(`Sanctions feed looks truncated (${entries.length} entries); keeping the current list`);
      }
      await storeSanctionsList(query, entries, SDN_URL);
      await reload();
      const { rescreened, newlyFlagged } = await rescreenClearRecords(query, service.screen);
      logger.info('Sanctions list refreshed', { entries: entries.length, rescreened, newlyFlagged });
      return { entries: entries.length, rescreened, newlyFlagged };
    },
  };
  return service;
}
