import { SANCTIONS_LIST, type SanctionsEntry } from './list.js';

export interface SanctionsMatch {
  candidateName: string;
  matchedName: string;
  program: string;
  list: SanctionsEntry['list'];
  distance: number;
}

const DIACRITICS_RE = /[̀-ͯ]/g;

function normalize(name: string): string {
  return name
    .normalize('NFKD')
    .replace(DIACRITICS_RE, '')
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Word order does not matter: "Mahmoud Abbas" and "Abbas Mahmoud" are the same person. */
function key(name: string): { text: string; tokens: number } {
  const tokens = normalize(name).split(' ').filter(Boolean).sort();
  return { text: tokens.join(' '), tokens: tokens.length };
}

/** Edit distance, giving up (returning max + 1) as soon as it cannot come in at or under `max`. */
function boundedLevenshtein(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      cur.push(v);
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

interface IndexedName {
  listedName: string;
  text: string;
  /** How many typos still count as the same name; 0 = must match exactly. */
  threshold: number;
  entry: SanctionsEntry;
}

/** A list prepared for screening: every name and alias normalised once, not per applicant. */
export type SanctionsIndex = IndexedName[];

export function buildIndex(entries: SanctionsEntry[]): SanctionsIndex {
  const index: SanctionsIndex = [];
  for (const entry of entries) {
    for (const listedName of [entry.name, ...entry.aliases]) {
      const { text, tokens } = key(listedName);
      if (!text) continue;
      // A small typo tolerance (~15% of the length) catches transliteration differences, but only on
      // names with a given name and a surname that are long enough to be distinctive — a one-word
      // or very short entry must match exactly, or half the world would be flagged.
      const threshold = tokens >= 2 && text.length >= 8 ? Math.max(1, Math.floor(text.length * 0.15)) : 0;
      index.push({ listedName, text, threshold, entry });
    }
  }
  return index;
}

const builtIn = buildIndex(SANCTIONS_LIST);

/** Screens one candidate name against a sanctions index (the built-in list by default). */
export function screenName(candidateName: string, index: SanctionsIndex = builtIn): SanctionsMatch[] {
  const { text: candidate, tokens } = key(candidateName);
  if (!candidate) return [];

  const matches: SanctionsMatch[] = [];
  const seen = new Set<SanctionsEntry>();
  for (const item of index) {
    if (seen.has(item.entry)) continue;
    let distance: number;
    if (candidate === item.text) distance = 0;
    else if (item.threshold > 0 && tokens >= 2) distance = boundedLevenshtein(candidate, item.text, item.threshold);
    else continue;
    if (distance > item.threshold) continue;
    seen.add(item.entry);
    matches.push({ candidateName, matchedName: item.listedName, program: item.entry.program, list: item.entry.list, distance });
  }
  return matches;
}

/** Screens multiple candidate names (e.g. full name + legal name + bank
 * account holder name from one KYC submission) and returns the combined,
 * deduplicated match set. */
export function screenNames(candidateNames: string[], index: SanctionsIndex = builtIn): SanctionsMatch[] {
  const seen = new Set<string>();
  const matches: SanctionsMatch[] = [];
  for (const name of candidateNames) {
    for (const match of screenName(name, index)) {
      const k = `${match.candidateName}::${match.matchedName}`;
      if (seen.has(k)) continue;
      seen.add(k);
      matches.push(match);
    }
  }
  return matches;
}
