import { api } from './client.js';

export interface CompanyMember {
  userId: string;
  email: string;
  companyRole: 'owner' | 'admin' | 'member';
  joinedAt: string;
}

export interface CompanyInvite {
  id: string;
  email: string;
  company_role: 'admin' | 'member';
  status: 'pending' | 'accepted' | 'expired';
  created_at: string;
  expires_at: string;
}

export async function getCompanyMembers(): Promise<{ members: CompanyMember[]; myRole: string | null }> {
  const { data } = await api.get<{ members: CompanyMember[]; myRole: string | null }>('/company/members');
  return data;
}

export async function getCompanyInvites(): Promise<CompanyInvite[]> {
  const { data } = await api.get<{ invites: CompanyInvite[] }>('/company/invites');
  return data.invites;
}

export async function removeCompanyMember(userId: string): Promise<void> {
  await api.delete(`/company/members/${userId}`);
}
