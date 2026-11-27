import { useState } from 'react';
import { toast } from 'sonner';
import { ConfirmDialog, PageHeader } from '@funti3r/ui';
import { apiErrorMessage } from '@funti3r/web-core';
import { admin, type Row } from '../api';
import { useLoad } from '../useLoad';
import { useListParams } from '../listParams';
import { useDrawers } from '../components/drawers';
import { AccountLink, Card, Facts, LoadState, Pager, Pill, Table, Tabs } from '../components/bits';
import { when } from '../format';

const PAGE = 50;
type Tab = 'pending' | 'rejected' | 'expired' | 'sanctions';

/**
 * Compliance work: the KYC review queue (who is waiting for a decision, oldest first, and who was rejected or has
 * lapsed), and sanctions screening (the loaded list, a manual refresh, and the people the screening flagged). Every
 * decision is made on the person's account page, where the KYC, its history and any sanctions match sit together.
 */
export default function Compliance() {
  const list = useListParams();
  const tab = (list.get('tab') || 'pending') as Tab;
  const pending = useLoad(() => admin.kycQueue({ status: 'pending', limit: 1 }), []);
  const flagged = useLoad(admin.flagged, []);

  return (
    <div className="dashboard">
      <PageHeader title="Compliance" subtitle="KYC reviews and sanctions screening" />
      <Tabs<Tab>
        active={tab}
        onChange={(key) => list.reset(key === 'pending' ? {} : { tab: key })}
        tabs={[
          { key: 'pending', label: 'Waiting for review', count: pending.data?.total },
          { key: 'rejected', label: 'Rejected' },
          { key: 'expired', label: 'Expired' },
          { key: 'sanctions', label: 'Sanctions', count: flagged.data?.flagged.length },
        ]}
      />
      {tab === 'sanctions' ? <Sanctions flagged={flagged} /> : <Queue status={tab} offset={list.offset} onPage={(o) => list.set({ offset: String(o) })} />}
    </div>
  );
}

function Queue({ status, offset, onPage }: { status: Exclude<Tab, 'sanctions'>; offset: number; onPage: (o: number) => void }) {
  const drawers = useDrawers();
  const page = useLoad(() => admin.kycQueue({ status, limit: PAGE, offset }), [status, offset]);
  const empty = { pending: 'Nobody is waiting for a KYC decision.', rejected: 'Nobody has been rejected.', expired: 'No approvals have lapsed.' }[status];
  return (
    <Card>
      {status === 'pending' && <p className="admin-muted">Oldest first. Open an account to review its KYC and approve or reject it.</p>}
      <LoadState loading={page.loading && !page.data} error={page.error} />
      {page.data && (
        <Table<Row> rows={page.data.queue} onRowClick={drawers.open('account', 'user_id')} empty={empty} rowKey={(r) => r.user_id} columns={[
          { label: 'Account', render: (r) => <AccountLink id={r.user_id} email={r.email} /> },
          { label: 'Role', render: (r) => r.role },
          { label: 'KYC', render: (r) => <Pill value={r.status} /> },
          { label: 'Sanctions', render: (r) => <Pill value={r.sanctions_status ?? 'not screened'} /> },
          { label: 'Submitted', render: (r) => when(r.submitted_at) },
          { label: 'Last change', render: (r) => when(r.updated_at) },
        ]} />
      )}
      <Pager offset={offset} shown={page.data?.queue.length ?? 0} pageSize={PAGE} total={page.data?.total} onPage={onPage} />
      {drawers.element}
    </Card>
  );
}

function Sanctions({ flagged }: { flagged: ReturnType<typeof useLoad<{ flagged: Row[] }>> }) {
  const drawers = useDrawers();
  const status = useLoad(admin.sanctionsStatus, []);
  const [confirming, setConfirming] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  async function refresh() {
    setConfirming(false);
    setRefreshing(true);
    try {
      await admin.refreshSanctions();
      toast.success('Sanctions list refreshed');
      await status.reload();
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Refresh failed'));
    } finally {
      setRefreshing(false);
    }
  }

  const list = status.data?.list;
  return (
    <>
      <Card
        title="Sanctions list"
        actions={<button className="btn-secondary" onClick={() => setConfirming(true)} disabled={refreshing}>{refreshing ? 'Refreshing…' : 'Refresh now'}</button>}
      >
        <LoadState loading={status.loading && !status.data} error={status.error} />
        {status.data && (list
          ? <Facts items={[
            ['Source', <a key="s" href={list.source} target="_blank" rel="noreferrer">{list.source}</a>],
            ['Entries', list.entryCount.toLocaleString()],
            ['Fetched', when(list.fetchedAt)],
          ]} />
          : <div className="error-banner">No list loaded: screening is using the built-in fallback only.</div>)}
      </Card>

      <Card title={`Flagged by screening (${flagged.data?.flagged.length ?? '…'})`}>
        <LoadState loading={flagged.loading && !flagged.data} error={flagged.error} />
        {flagged.data && (
          <Table<Row> rows={flagged.data.flagged} onRowClick={drawers.open('account', 'user_id')} empty="Nobody is flagged." rowKey={(r) => r.user_id} columns={[
            { label: 'Account', render: (r) => <AccountLink id={r.user_id} email="Open account to decide" /> },
            { label: 'KYC', render: (r) => <Pill value={r.status} /> },
            {
              label: 'Matched', render: (r) => (Array.isArray(r.sanctions_matches)
                ? r.sanctions_matches.map((m: Row) => `${m.matchedName} (${m.list})`).join(', ')
                : '—'),
            },
            { label: 'Screened', render: (r) => when(r.sanctions_checked_at) },
          ]} />
        )}
      </Card>

      {drawers.element}
      <ConfirmDialog
        open={confirming}
        title="Refresh the sanctions list?"
        message="Downloads the current OFAC SDN list and re-screens against it from now on."
        confirmLabel="Refresh"
        onConfirm={refresh}
        onCancel={() => setConfirming(false)}
      />
    </>
  );
}
