import { useState } from 'react';
import { toast } from 'sonner';
import { ConfirmDialog, PageHeader } from '@funti3r/ui';
import { apiErrorMessage, useLoad } from '@funti3r/web-core';
import { admin, type Row } from '../api';
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
  const empty = {
    pending: { title: 'No KYC reviews waiting', message: 'When someone sends their identity documents, they appear here for you to review, oldest first.', tone: 'clear' as const },
    rejected: { title: 'Nobody has been rejected', message: 'People whose KYC you reject show up here until they submit again.' },
    expired: { title: 'No approvals have lapsed', message: 'A KYC approval lasts a year. People whose approval has run out appear here until they verify again.', tone: 'clear' as const },
  }[status];
  return (
    <Card>
      {status === 'pending' && !!page.data?.queue.length && <p className="admin-muted">Oldest first. Open an account to review its KYC and approve or reject it.</p>}
      <LoadState state={page} />
      {page.data && (
        <Table<Row> rows={page.data.queue} refreshing={page.refreshing} onRowClick={drawers.open('account', 'user_id')} empty={empty} rowKey={(r) => r.user_id} columns={[
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
        <LoadState state={status} />
        {status.data && (list
          ? <Facts items={[
            ['Source', <a key="s" href={list.source} target="_blank" rel="noreferrer">{list.source}</a>],
            ['Entries', list.entryCount.toLocaleString()],
            ['Fetched', when(list.fetchedAt)],
          ]} />
          : <div className="error-banner">No list loaded: screening is using the built-in fallback only.</div>)}
      </Card>

      <Card title={`Flagged by screening (${flagged.data?.flagged.length ?? '…'})`}>
        <LoadState state={flagged} />
        {flagged.data && (
          <Table<Row> rows={flagged.data.flagged} onRowClick={drawers.open('account', 'user_id')} empty={{ title: 'Nobody is flagged', message: 'Anyone whose name matches the sanctions list shows up here, to compare with the list entry before deciding.', tone: 'clear' }} rowKey={(r) => r.user_id} columns={[
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
