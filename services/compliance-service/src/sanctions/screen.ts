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

function levenshtein(a: string, b: string): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const dp: number[][] = Array.from({ length: rows }, () => new Array(cols).fill(0));
  for (let i = 0; i < rows; i++) dp[i][0] = i;
  for (let j = 0; j < cols; j++) dp[0][j] = j;
  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[rows - 1][cols - 1];
}

/** Screens one candidate name against the sanctions list. Allows a small
 * typo tolerance (~15% of the listed name's length) so minor transliteration
 * differences still surface as matches, while unrelated names don't. */
export function screenName(candidateName: string, entries: SanctionsEntry[] = SANCTIONS_LIST): SanctionsMatch[] {
  const normCandidate = normalize(candidateName);
  if (!normCandidate) return [];

  const matches: SanctionsMatch[] = [];
  for (const entry of entries) {
    for (const listedName of [entry.name, ...entry.aliases]) {
      const normListed = normalize(listedName);
      if (!normListed) continue;
      const distance = normCandidate === normListed ? 0 : levenshtein(normCandidate, normListed);
      const threshold = Math.max(1, Math.floor(normListed.length * 0.15));
      if (distance <= threshold) {
        matches.push({ candidateName, matchedName: listedName, program: entry.program, list: entry.list, distance });
        break;
      }
    }
  }
  return matches;
}

/** Screens multiple candidate names (e.g. full name + legal name + bank
 * account holder name from one KYC submission) and returns the combined,
 * deduplicated match set. */
export function screenNames(candidateNames: string[], entries: SanctionsEntry[] = SANCTIONS_LIST): SanctionsMatch[] {
  const seen = new Set<string>();
  const matches: SanctionsMatch[] = [];
  for (const name of candidateNames) {
    for (const match of screenName(name, entries)) {
      const key = `${match.candidateName}::${match.matchedName}`;
      if (seen.has(key)) continue;
      seen.add(key);
      matches.push(match);
    }
  }
  return matches;
}
