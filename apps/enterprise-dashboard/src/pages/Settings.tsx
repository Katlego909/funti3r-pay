import { useState, useEffect, FormEvent } from 'react';
import { Helmet } from 'react-helmet-async';
import { toast } from 'sonner';
import { useAuthStore } from '../store/authStore.js';
import { api } from '../api/client.js';
import { getCompanyMembers, getCompanyInvites, removeCompanyMember, type CompanyMember, type CompanyInvite } from '../api/company.js';
import {
  HiOutlineUser,
  HiOutlineBell,
  HiOutlineGlobeAlt,
  HiOutlineShieldCheck,
  HiOutlineCheckCircle,
  HiOutlineUserGroup,
  HiCheck,
  HiOutlineClipboard,
  HiOutlineXMark,
  HiOutlineTrash,
} from 'react-icons/hi2';
import ConfirmDialog from '../components/ConfirmDialog.js';

const card: React.CSSProperties = {
  background: '#fff',
  border: '1px solid var(--gray-200)',
  borderRadius: '16px',
  padding: '32px',
  marginBottom: '24px',
};

const sectionTitle: React.CSSProperties = {
  fontSize: '18px',
  fontWeight: 900,
  color: 'var(--gray-900)',
  fontFamily: "'Archivo Black', sans-serif",
  letterSpacing: '-0.3px',
  marginBottom: '6px',
};

const sectionDesc: React.CSSProperties = {
  fontSize: '14px',
  color: 'var(--gray-600)',
  marginBottom: '28px',
};

const divider: React.CSSProperties = {
  border: 'none',
  borderTop: '1px solid var(--gray-100)',
  margin: '20px 0',
};

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: '13px',
  fontWeight: 700,
  color: 'var(--gray-700)',
  marginBottom: '6px',
  textTransform: 'uppercase' as const,
  letterSpacing: '0.5px',
};

const field: React.CSSProperties = {
  width: '100%',
  padding: '10px 14px',
  borderRadius: '8px',
  border: '1px solid var(--gray-200)',
  fontSize: '14px',
  color: 'var(--gray-900)',
  background: 'var(--gray-50)',
  fontFamily: 'inherit',
  boxSizing: 'border-box' as const,
};

function ToggleRow({ label: rowLabel, description, checked, onChange, disabled }: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 0', opacity: disabled ? 0.6 : 1 }}>
      <div>
        <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--gray-900)', marginBottom: '2px' }}>{rowLabel}</div>
        <div style={{ fontSize: '13px', color: 'var(--gray-600)' }}>{description}</div>
      </div>
      <button
        onClick={() => onChange(!checked)}
        aria-pressed={checked}
        disabled={disabled}
        style={{
          width: '44px',
          height: '24px',
          borderRadius: '999px',
          border: 'none',
          cursor: disabled ? 'not-allowed' : 'pointer',
          background: checked ? 'var(--primary)' : 'var(--gray-300)',
          position: 'relative',
          transition: 'background 0.2s',
          flexShrink: 0,
        }}
      >
        <span style={{
          position: 'absolute',
          top: '3px',
          left: checked ? '23px' : '3px',
          width: '18px',
          height: '18px',
          borderRadius: '50%',
          background: '#fff',
          transition: 'left 0.2s',
        }} />
      </button>
    </div>
  );
}

export default function Settings() {
  const user = useAuthStore((s) => s.user);
  const isEnterprise = user?.role !== 'worker';

  const [companyName, setCompanyName] = useState('');
  const [companyRegistration, setCompanyRegistration] = useState('');
  const [companyCountry, setCompanyCountry] = useState('');
  const [notifyCompleted, setNotifyCompleted] = useState(true);
  const [notifyFailed, setNotifyFailed] = useState(true);
  const [notifyWeekly, setNotifyWeekly] = useState(false);

  const [saving, setSaving] = useState(false);

  const [members, setMembers] = useState<CompanyMember[]>([]);
  const [myCompanyRole, setMyCompanyRole] = useState<string | null>(null);
  const [teamInvites, setTeamInvites] = useState<CompanyInvite[]>([]);
  const [teamInviteOpen, setTeamInviteOpen] = useState(false);
  const [teamInviteEmail, setTeamInviteEmail] = useState('');
  const [teamInviteRole, setTeamInviteRole] = useState<'member' | 'admin'>('member');
  const [teamInviteLink, setTeamInviteLink] = useState('');
  const [teamInviteSending, setTeamInviteSending] = useState(false);
  const [teamInviteCopied, setTeamInviteCopied] = useState(false);
  const [pendingRemove, setPendingRemove] = useState<CompanyMember | null>(null);

  // Load existing company profile for enterprise users
  useEffect(() => {
    if (!isEnterprise || !user?.userId) return;
    api.get<{ company_name?: string; company_registration?: string; company_country?: string }>(`/users/${user.userId}`)
      .then((r) => {
        if (r.data.company_name) setCompanyName(r.data.company_name);
        if (r.data.company_registration) setCompanyRegistration(r.data.company_registration);
        if (r.data.company_country) setCompanyCountry(r.data.company_country);
      })
      .catch(() => {});
  }, [isEnterprise, user?.userId]);

  async function loadTeam() {
    try {
      const { members: m, myRole } = await getCompanyMembers();
      setMembers(m);
      setMyCompanyRole(myRole);
    } catch {
      // no active company yet, or request failed — Team card shows the fallback prompt
    }
  }

  async function loadTeamInvites() {
    try {
      setTeamInvites(await getCompanyInvites());
    } catch {
      // non-fatal — pending invites just won't show
    }
  }

  useEffect(() => {
    if (isEnterprise) loadTeam();
  }, [isEnterprise]);

  const canInviteTeam = myCompanyRole === 'owner' || myCompanyRole === 'admin';

  useEffect(() => {
    if (canInviteTeam) loadTeamInvites();
  }, [canInviteTeam]);

  async function handleTeamInvite(e: FormEvent) {
    e.preventDefault();
    setTeamInviteSending(true);
    try {
      const { data } = await api.post<{ inviteUrl: string }>('/company/invites', {
        email: teamInviteEmail,
        companyRole: teamInviteRole,
      });
      setTeamInviteLink(data.inviteUrl);
      loadTeamInvites();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to create invite';
      toast.error(msg.includes('409') ? 'This person is already on your team.' : msg);
    } finally {
      setTeamInviteSending(false);
    }
  }

  function copyTeamInviteLink() {
    navigator.clipboard.writeText(teamInviteLink);
    setTeamInviteCopied(true);
    setTimeout(() => setTeamInviteCopied(false), 2000);
  }

  function closeTeamInvite() {
    setTeamInviteOpen(false);
    setTeamInviteEmail('');
    setTeamInviteLink('');
    setTeamInviteCopied(false);
  }

  async function confirmRemoveMember() {
    if (!pendingRemove) return;
    const member = pendingRemove;
    setPendingRemove(null);
    try {
      await removeCompanyMember(member.userId);
      setMembers((prev) => prev.filter((m) => m.userId !== member.userId));
      toast.success(`${member.email} removed from your team`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to remove teammate';
      toast.error(msg);
    }
  }

  async function handleSave() {
    setSaving(true);
    try {
      const body: Record<string, unknown> = {};
      if (isEnterprise) {
        body.company_name = companyName;
        body.company_registration = companyRegistration;
        body.company_country = companyCountry;
      }
      await api.patch('/users/me', body);
      toast.success('Settings saved');
    } catch {
      toast.error('Failed to save. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ maxWidth: '720px', margin: '0 auto', padding: '40px 24px' }}>
      <Helmet>
        <title>Settings | Funti3rPay</title>
        <meta name="robots" content="noindex, nofollow" />
      </Helmet>
      <div style={{ marginBottom: '40px' }}>
        <h2 style={{ fontSize: '32px', fontWeight: 900, color: 'var(--gray-900)', fontFamily: "'Archivo Black', sans-serif", letterSpacing: '-1px', marginBottom: '6px' }}>
          Settings
        </h2>
        <p style={{ fontSize: '15px', color: 'var(--gray-600)' }}>Manage your account and preferences</p>
      </div>

      {/* Account */}
      <div style={card}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '6px' }}>
          <HiOutlineUser size={18} style={{ color: 'var(--primary)' }} />
          <div style={sectionTitle}>Account</div>
        </div>
        <p style={sectionDesc}>Your account details and organisation info</p>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
          <div>
            <label style={labelStyle}>Email</label>
            <input style={field} value={user?.email ?? ''} readOnly />
          </div>
          <div>
            <label style={labelStyle}>Role</label>
            <input style={field} value={user?.role ?? 'enterprise'} readOnly />
          </div>
        </div>

        {isEnterprise && (
          <>
            <hr style={divider} />
            <div>
              <label style={labelStyle}>Company name</label>
              <input
                style={{ ...field, background: '#fff' }}
                placeholder="Your company name"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
              />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginTop: '16px' }}>
              <div>
                <label style={labelStyle}>Registration number</label>
                <input
                  style={{ ...field, background: '#fff' }}
                  placeholder="Company registration number"
                  value={companyRegistration}
                  onChange={(e) => setCompanyRegistration(e.target.value)}
                />
              </div>
              <div>
                <label style={labelStyle}>Country of incorporation</label>
                <input
                  style={{ ...field, background: '#fff' }}
                  placeholder="e.g. ZA, NG, US"
                  maxLength={2}
                  value={companyCountry}
                  onChange={(e) => setCompanyCountry(e.target.value.toUpperCase())}
                />
              </div>
            </div>
          </>
        )}
      </div>

      {/* Team */}
      {isEnterprise && (
        <div style={card}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <HiOutlineUserGroup size={18} style={{ color: 'var(--primary)' }} />
              <div style={sectionTitle}>Team</div>
            </div>
            {canInviteTeam && (
              <button
                type="button"
                className="btn-primary"
                onClick={() => setTeamInviteOpen(true)}
                style={{ padding: '8px 16px', fontSize: '13px' }}
              >
                Invite Teammate
              </button>
            )}
          </div>
          <p style={sectionDesc}>People with access to this company's dashboard</p>

          {myCompanyRole === null && members.length === 0 ? (
            <p style={{ fontSize: '14px', color: 'var(--gray-600)' }}>
              Save your company details above first — you'll be able to invite teammates once your company profile is set up.
            </p>
          ) : (
            <>
              <div className="table-responsive">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Email</th>
                      <th>Role</th>
                      <th>Joined</th>
                      {canInviteTeam && <th></th>}
                    </tr>
                  </thead>
                  <tbody>
                    {members.map((m) => {
                      const isSelf = m.userId === user?.userId;
                      const canRemove = canInviteTeam && !isSelf && m.companyRole !== 'owner'
                        && !(myCompanyRole === 'admin' && m.companyRole === 'admin');
                      return (
                        <tr key={m.userId}>
                          <td>{m.email}</td>
                          <td style={{ textTransform: 'capitalize' }}>{m.companyRole}</td>
                          <td>{new Date(m.joinedAt).toLocaleDateString()}</td>
                          {canInviteTeam && (
                            <td>
                              {canRemove && (
                                <button
                                  type="button"
                                  onClick={() => setPendingRemove(m)}
                                  title="Remove from team"
                                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--gray-500)', padding: '4px' }}
                                >
                                  <HiOutlineTrash size={16} />
                                </button>
                              )}
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {canInviteTeam && teamInvites.length > 0 && (
                <>
                  <hr style={divider} />
                  <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--gray-700)', marginBottom: '10px' }}>
                    Pending invites
                  </div>
                  <div className="table-responsive">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>Email</th>
                          <th>Role</th>
                          <th>Expires</th>
                        </tr>
                      </thead>
                      <tbody>
                        {teamInvites.map((inv) => {
                          const expired = new Date(inv.expires_at).getTime() < Date.now();
                          return (
                            <tr key={inv.id}>
                              <td>{inv.email}</td>
                              <td style={{ textTransform: 'capitalize' }}>{inv.company_role}</td>
                              <td>{expired ? 'Expired' : new Date(inv.expires_at).toLocaleDateString()}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </>
          )}
        </div>
      )}

      <ConfirmDialog
        open={!!pendingRemove}
        title="Remove teammate"
        message={`Remove ${pendingRemove?.email} from your team? They will lose access to the Team page immediately.`}
        confirmLabel="Remove"
        danger
        onConfirm={confirmRemoveMember}
        onCancel={() => setPendingRemove(null)}
      />

      {teamInviteOpen && (
        <div className="modal-overlay" onClick={closeTeamInvite}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '420px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h3 style={{ margin: 0 }}>Invite Teammate</h3>
              <button onClick={closeTeamInvite} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6b7280' }}>
                <HiOutlineXMark size={20} />
              </button>
            </div>
            {!teamInviteLink ? (
              <form onSubmit={handleTeamInvite} className="payment-form">
                <p style={{ fontSize: '0.85rem', color: '#6b7280', marginTop: 0 }}>
                  Enter your teammate's email. They'll receive a registration link pre-linked to your company.
                </p>
                <label>Email
                  <input
                    type="email"
                    value={teamInviteEmail}
                    onChange={(e) => setTeamInviteEmail(e.target.value)}
                    placeholder="teammate@company.com"
                    required
                  />
                </label>
                <label>Role
                  <select value={teamInviteRole} onChange={(e) => setTeamInviteRole(e.target.value as 'member' | 'admin')}>
                    <option value="member">Member</option>
                    <option value="admin">Admin</option>
                  </select>
                </label>
                <div className="form-actions">
                  <button type="button" className="btn-secondary" onClick={closeTeamInvite}>Cancel</button>
                  <button type="submit" className="btn-primary" disabled={teamInviteSending}>
                    {teamInviteSending ? 'Generating…' : 'Generate invite link'}
                  </button>
                </div>
              </form>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <p style={{ fontSize: '0.85rem', color: '#065f46', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '8px', padding: '10px 12px', margin: 0 }}>
                  Invite link generated for <strong>{teamInviteEmail}</strong>. Send it to them — it expires in 7 days.
                </p>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <input
                    readOnly
                    value={teamInviteLink}
                    style={{ flex: 1, fontSize: '0.78rem', padding: '8px', border: '1px solid #e5e7eb', borderRadius: '8px', background: '#f9fafb', fontFamily: 'monospace' }}
                    onClick={(e) => (e.target as HTMLInputElement).select()}
                  />
                  <button className="btn-secondary" onClick={copyTeamInviteLink} style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: '4px' }}>
                    {teamInviteCopied ? <><HiCheck size={14} /> Copied</> : <><HiOutlineClipboard size={14} /> Copy</>}
                  </button>
                </div>
                <div className="form-actions">
                  <button className="btn-secondary" onClick={() => { setTeamInviteLink(''); setTeamInviteEmail(''); }}>Invite another</button>
                  <button className="btn-primary" onClick={closeTeamInvite}>Done</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Payment preferences — read-only until backend supports them */}
      <div style={card}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '6px' }}>
          <HiOutlineGlobeAlt size={18} style={{ color: 'var(--primary)' }} />
          <div style={sectionTitle}>Payment Preferences</div>
        </div>
        <p style={sectionDesc}>Default settings applied to new payouts</p>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
          <div>
            <label style={labelStyle}>Default rail</label>
            <select style={{ ...field, background: '#f9fafb', color: 'var(--gray-500)' }} disabled>
              <option value="stellar">Stellar</option>
            </select>
          </div>
          <div>
            <label style={labelStyle}>Send currency</label>
            <select style={{ ...field, background: '#f9fafb', color: 'var(--gray-500)' }} disabled>
              <option value="USD">USD</option>
            </select>
          </div>
        </div>
      </div>

      {/* Notifications — read-only until backend supports persisting these */}
      <div style={card}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '6px' }}>
          <HiOutlineBell size={18} style={{ color: 'var(--primary)' }} />
          <div style={sectionTitle}>Notifications</div>
        </div>
        <p style={sectionDesc}>Coming soon — email alert preferences aren't saved yet</p>

        <ToggleRow label="Payment completed" description="Notify when a payout settles on-chain" checked={notifyCompleted} onChange={setNotifyCompleted} disabled />
        <hr style={divider} />
        <ToggleRow label="Payment failed" description="Notify when a payout fails" checked={notifyFailed} onChange={setNotifyFailed} disabled />
        <hr style={divider} />
        <ToggleRow label="Weekly summary" description="A digest of your payout volume every Monday" checked={notifyWeekly} onChange={setNotifyWeekly} disabled />
      </div>

      {/* Security */}
      <div style={card}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '6px' }}>
          <HiOutlineShieldCheck size={18} style={{ color: 'var(--primary)' }} />
          <div style={sectionTitle}>Security</div>
        </div>
        <p style={sectionDesc}>Passkey authentication is active on this account</p>
        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: '8px',
          padding: '8px 14px', borderRadius: '8px',
          background: 'rgba(5,150,105,0.08)', color: 'var(--success)',
          fontSize: '13px', fontWeight: 700,
        }}>
          <HiOutlineCheckCircle size={15} /> Passkey active
        </div>
      </div>

      {/* Save */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '12px' }}>
        <button
          onClick={handleSave}
          disabled={saving}
          style={{
            padding: '12px 28px', background: saving ? 'var(--gray-300)' : 'var(--accent)', color: '#fff',
            border: 'none', borderRadius: '10px', fontSize: '15px', fontWeight: 700,
            cursor: saving ? 'not-allowed' : 'pointer', fontFamily: 'inherit',
          }}
        >
          {saving ? 'Saving…' : 'Save changes'}
        </button>
      </div>
    </div>
  );
}
