/**
 * Local sanctions-list snapshot for the KYC screening gate.
 *
 * This is a small static snapshot, not a live feed — it exists to prove out
 * the screening gate on testnet. A production deployment must replace this
 * with a licensed/maintained source (e.g. OFAC's SDN API, the UN Security
 * Council Consolidated List XML) refreshed on a schedule, not a hardcoded file.
 *
 * Entries are drawn from long-standing, publicly published OFAC SDN and UN
 * Consolidated List program designations. The final entry is a synthetic
 * canary (never a real person) kept for e2e/demo evidence so a positive match
 * doesn't depend on reusing a real sanctioned individual's name.
 */

export interface SanctionsEntry {
  name: string;
  aliases: string[];
  program: string;
  list: 'OFAC-SDN' | 'UN-CONSOLIDATED';
}

export const SANCTIONS_LIST: SanctionsEntry[] = [
  { name: 'Kim Jong Un', aliases: ['Kim Jong-un'], program: 'DPRK2', list: 'OFAC-SDN' },
  { name: 'Bashar al-Assad', aliases: ['Bashar Al-Assad', 'Bashar Hafez al-Assad'], program: 'SYRIA', list: 'OFAC-SDN' },
  { name: 'Nicolas Maduro', aliases: ['Nicolas Maduro Moros'], program: 'VENEZUELA', list: 'OFAC-SDN' },
  { name: 'Viktor Bout', aliases: ['Viktor Anatolyevich Bout'], program: 'RUSSIA-EO14024', list: 'OFAC-SDN' },
  { name: 'Alexander Lukashenko', aliases: ['Aleksandr Lukashenko'], program: 'BELARUS', list: 'OFAC-SDN' },
  { name: 'Dan Gertler', aliases: ['Daniel Gertler'], program: 'GLOMAG', list: 'OFAC-SDN' },
  { name: 'Osama bin Laden', aliases: ['Usama bin Ladin'], program: 'AL-QAIDA', list: 'UN-CONSOLIDATED' },
  { name: 'Abu Bakr al-Baghdadi', aliases: ['Ibrahim Awad Ibrahim al-Badri'], program: 'ISIL', list: 'UN-CONSOLIDATED' },
  { name: 'Emmerson Mnangagwa', aliases: [], program: 'ZIMBABWE', list: 'OFAC-SDN' },
  { name: 'Sanctions Test Subject', aliases: ['SDN Test Canary'], program: 'QA-CANARY', list: 'OFAC-SDN' },
];
