import { FormEvent, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { PageHeader } from '@funti3r/ui';
import { apiErrorMessage, useAuthStore } from '@funti3r/web-core';
import { admin, updateProfile } from '../api';
import { useLoad } from '../useLoad';
import { Card, Facts, Id, LoadState, Pill } from '../components/bits';
import { when } from '../format';

/** The signed-in admin's own account: who they are, and the name, phone and country they can change. */
export default function Profile() {
  const me = useAuthStore((s) => s.user);
  const id = me?.userId ?? '';
  const account = useLoad(() => admin.account(id), [id]);
  const u = account.data?.user;

  const [form, setForm] = useState({ first_name: '', last_name: '', phone: '', country: '' });
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (u) setForm({ first_name: u.first_name ?? '', last_name: u.last_name ?? '', phone: u.phone ?? '', country: u.country ?? '' });
  }, [u]);

  async function save(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await updateProfile(form);
      toast.success('Profile saved');
      await account.reload();
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Could not save your profile'));
    } finally {
      setSaving(false);
    }
  }

  const field = (key: keyof typeof form, label: string, extra?: { maxLength?: number; placeholder?: string }) => (
    <label className="admin-label">
      {label}
      <input value={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value })} {...extra} />
    </label>
  );

  return (
    <div className="dashboard" style={{ maxWidth: 760 }}>
      <PageHeader title="Profile" subtitle="Your admin account" />
      <LoadState loading={account.loading && !u} error={account.error} />
      {u && (
        <>
          <Card title="Account">
            <Facts items={[
              ['Email', u.email],
              ['Role', <Pill key="r" value={u.role} tone="good" />],
              ['Status', <Pill key="s" value={u.status} />],
              ['Account id', <Id key="i" value={u.id} />],
              ['Joined', when(u.created_at)],
              ['Admin access', 'Granted by a developer; it cannot be requested from here'],
            ]} />
          </Card>
          <Card title="Your details">
            <form onSubmit={save}>
              <div className="admin-form-grid">
                {field('first_name', 'First name', { maxLength: 80 })}
                {field('last_name', 'Last name', { maxLength: 80 })}
                {field('phone', 'Phone', { maxLength: 40 })}
                {field('country', 'Country', { maxLength: 2, placeholder: 'Two-letter code, e.g. ZA' })}
              </div>
              <div className="form-actions">
                <button className="btn-primary" type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
              </div>
            </form>
          </Card>
        </>
      )}
    </div>
  );
}
