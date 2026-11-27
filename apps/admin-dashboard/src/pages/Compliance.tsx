import { useState } from 'react';
import { toast } from 'sonner';
import { ConfirmDialog, PageHeader } from '@funti3r/ui';
import { apiErrorMessage } from '@funti3r/web-core';
import { admin, type Row } from '../api';
import { useLoad } from '../useLoad';
import { AccountLink, Card, Facts, LoadState, Pill, Table } from '../components/bits';
import { when } from '../format';

/**
 * Sanctions screening: which list is loaded and how old it is, a manual refresh, and the queue of people the
 * screening flagged. Each flag is decided on the person's account page, where the KYC and the match sit side by side.
 */
export default function Compliance() {
  const status = useLoad(admin.sanctionsStatus, []);
  const flagged = useLoad(admin.flagged, []);
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
    <div className="dashboard">
      <PageHeader title="Compliance" subtitle="Sanctions screening and the people it flagged" />

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
          <Table<Row> rows={flagged.data.flagged} empty="Nobody is flagged." rowKey={(r) => r.user_id} columns={[
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

      <ConfirmDialog
        open={confirming}
        title="Refresh the sanctions list?"
        message="Downloads the current OFAC SDN list and re-screens against it from now on."
        confirmLabel="Refresh"
        onConfirm={refresh}
        onCancel={() => setConfirming(false)}
      />
    </div>
  );
}
