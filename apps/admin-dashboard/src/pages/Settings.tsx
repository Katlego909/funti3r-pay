import { Link } from 'react-router-dom';
import { PageHeader } from '@funti3r/ui';
import { useAuthStore, useLoad } from '@funti3r/web-core';
import { admin, type Row } from '../api';
import { Card, LoadState, Table } from '../components/bits';
import AuditTable from '../components/AuditTable';
import { when } from '../format';

/**
 * What an admin can see about their own access: the passkeys that sign them in (per site), how admin access is
 * granted and removed, and everything they have done as an admin.
 */
export default function Settings() {
  const id = useAuthStore((s) => s.user?.userId) ?? '';
  const account = useLoad(() => admin.account(id), [id]);

  return (
    <div className="dashboard" style={{ maxWidth: 720, margin: '0 auto' }}>
      <PageHeader title="Settings" subtitle="Your sign-in and your admin activity" />

      <Card title="Passkeys">
        <p className="admin-muted">
          You sign in with a passkey stored on your device; there is no password to steal. A passkey works only on the
          site it was created for, so the console and the dashboard each have their own.
        </p>
        <LoadState state={account} />
        {account.data && (
          <Table<Row> rows={account.data.passkeys} empty={{ title: 'No passkeys yet', message: 'You are signing in with the developer sign-in.', compact: true }} rowKey={(p) => p.origin} columns={[
            { label: 'Site', render: (p) => p.origin },
            { label: 'Passkeys', render: (p) => p.count },
            { label: 'Last added', render: (p) => when(p.last_added) },
          ]} />
        )}
      </Card>

      <Card title="Admin access">
        <ul className="admin-list">
          <li>Admin accounts cannot be created by registering. A developer grants the role with the <code>grant-admin</code> script on the server, and it is recorded in the audit trail.</li>
          <li>Taking the role away (the same script with <code>--revoke</code>) ends your admin sessions within 15 minutes, or at once if your account is suspended.</li>
          <li>Everything you change here asks for a reason and is recorded with your account. See it in the <Link to="/audit">audit log</Link>.</li>
        </ul>
      </Card>

      <Card title="What you have done">
        <AuditTable query={{ actorId: id, limit: 25 }} />
      </Card>
    </div>
  );
}
