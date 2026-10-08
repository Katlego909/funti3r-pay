import type { SanctionsEntry } from './list.js';

/** Splits one CSV line, honouring "quoted, fields" and "" escapes. */
export function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') quoted = false;
      else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

/** OFAC's "no value" placeholder is -0-. */
const clean = (v: string | undefined): string => {
  const t = (v ?? '').trim();
  return t === '-0-' ? '' : t;
};

/** "ABBAS, Mahmoud" -> "Mahmoud ABBAS": the SDN lists people surname-first, applicants write it the other way. */
function givenNameFirst(name: string): string | null {
  const i = name.indexOf(',');
  if (i < 1) return null;
  const rest = name.slice(i + 1).trim();
  return rest ? `${rest} ${name.slice(0, i).trim()}` : null;
}

/**
 * Parses OFAC's public SDN.CSV (+ ALT.CSV for aliases) into screening entries.
 * Columns: SDN = ent_num, name, type, program, ...; ALT = ent_num, alt_num, alt_type, alt_name, remarks.
 */
export function parseSdn(sdnCsv: string, altCsv: string): SanctionsEntry[] {
  const byNum = new Map<string, SanctionsEntry>();

  for (const line of sdnCsv.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const f = parseCsvLine(line);
    const entNum = clean(f[0]);
    const name = clean(f[1]);
    if (!entNum || !name) continue;
    // Ships and aircraft are on the list but nobody applies for a job under one.
    if (['vessel', 'aircraft'].includes(clean(f[2]).toLowerCase())) continue;
    const aliases: string[] = [];
    if (clean(f[2]).toLowerCase() === 'individual') {
      const flipped = givenNameFirst(name);
      if (flipped) aliases.push(flipped);
    }
    byNum.set(entNum, { name, aliases, program: clean(f[3]).split(/[;\]\[]+/).filter(Boolean)[0]?.trim() || 'SDN', list: 'OFAC-SDN' });
  }

  for (const line of altCsv.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const f = parseCsvLine(line);
    const entry = byNum.get(clean(f[0]));
    const alias = clean(f[3]);
    if (!entry || !alias) continue;
    entry.aliases.push(alias);
    const flipped = givenNameFirst(alias);
    if (flipped) entry.aliases.push(flipped);
  }

  return [...byNum.values()];
}
