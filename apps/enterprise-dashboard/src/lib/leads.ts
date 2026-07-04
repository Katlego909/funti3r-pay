/**
 * Lead capture for the marketing site — inserts into the Supabase `leads` table
 * via its REST API. The anon key is public by design; RLS restricts it to
 * INSERT-only on this table.
 */

const SUPABASE_URL = 'https://qsjntwmoubxfezoxgqbs.supabase.co';
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY ?? '';

export type LeadType = 'demo' | 'sales' | 'waitlist';

export interface Lead {
  type: LeadType;
  email: string;
  name?: string;
  company?: string;
  message?: string;
  website?: string;
  country?: string;
  team_size?: string;
}

export type SubmitResult = 'ok' | 'duplicate' | 'error';

export async function submitLead(lead: Lead): Promise<SubmitResult> {
  if (!SUPABASE_ANON_KEY) {
    console.warn('VITE_SUPABASE_ANON_KEY is not set — lead not submitted');
    return 'error';
  }
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/leads`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify(lead),
    });
    if (res.status === 409) return 'duplicate'; // waitlist email already registered
    return res.ok ? 'ok' : 'error';
  } catch {
    return 'error';
  }
}
