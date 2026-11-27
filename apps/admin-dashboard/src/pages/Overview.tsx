import {
  HiOutlineBanknotes, HiOutlineExclamationTriangle, HiOutlineServerStack, HiOutlineShieldExclamation, HiOutlineXCircle,
} from 'react-icons/hi2';
import { ErrorState, MetricCard, PageHeader, RefreshButton } from '@funti3r/ui';
import { admin, readFailed, type Row } from '../api';
import { useDrawers } from '../components/drawers';
import { AccountLink, Card, Id, LoadState, Pill, Table, Tx } from '../components/bits';
import { money, when } from '../format';
import { useLoad } from '@funti3r/web-core';

const LOW_SPONSOR_XLM = 100;
const STALE_LIST_HOURS = 48;
const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;

/** What needs attention across the platform right now. */
export default function Overview() {
  const drawers = useDrawers();
  const ops = useLoad(admin.ops, []);
  const health = useLoad(admin.health, []);
  const sanctions = useLoad(admin.sanctionsStatus, []);
  const flagged = useLoad(admin.flagged, []);

  const o = ops.data;
  const sponsor = o?.sponsor;
  const contract = o?.contract;
  const listAge = sanctions.data?.list ? Math.round((Date.now() - new Date(sanctions.data.list.fetchedAt).getTime()) / 3_600_000) : null;
  const down = health.data ? Object.entries(health.data).filter(([, r]) => r.status !== 'ready') : [];
  const stuck = o ? o.stuckPayments.length + o.stuckCashouts.length + o.pendingEscrowCreations.length : 0;
  const sponsorLow = !sponsor || readFailed(sponsor) || sponsor.spendableXlm < LOW_SPONSOR_XLM;

  return (
    <div className="dashboard">
      <PageHeader
        title="Overview"
        subtitle="What needs attention across the platform"
        actions={(
          <RefreshButton
            refreshing={ops.refreshing || health.refreshing || flagged.refreshing}
            onClick={() => { void ops.reload(); void health.reload(); void flagged.reload(); }}
          />
        )}
      />
      <LoadState state={ops} skeleton="cards" />

      {o && (
        <div className="metrics-grid">
          <MetricCard
            icon={HiOutlineExclamationTriangle} accent="orange" label="Stuck"
            value={stuck}
            note={stuck ? `${plural(o.stuckPayments.length, 'payment')} · ${plural(o.stuckCashouts.length, 'cash-out')} · ${plural(o.pendingEscrowCreations.length, 'escrow')}` : 'Nothing stuck'}
            noteTone={stuck ? 'negative' : 'positive'}
          />
          <MetricCard
            icon={HiOutlineXCircle} accent="warning" label="Failed payouts (24h)" to="/money?status=failed"
            value={o.failedPayouts24h.total}
            note={o.failedPayouts24h.byReason[0] ? `Most often: ${o.failedPayouts24h.byReason[0].reason}` : 'None failed'}
            noteTone={o.failedPayouts24h.total ? 'negative' : 'positive'}
          />
          <MetricCard
            icon={HiOutlineShieldExclamation} accent="purple" label="Sanctions flags" to="/compliance"
            value={flagged.data?.flagged.length}
            note={listAge === null ? 'No sanctions list loaded' : `List fetched ${listAge} h ago`}
            noteTone={listAge === null || listAge > STALE_LIST_HOURS || !!flagged.data?.flagged.length ? 'negative' : 'neutral'}
          />
          <MetricCard
            icon={HiOutlineBanknotes} accent="green" label="Sponsor balance"
            value={sponsor === null ? 'Not set' : readFailed(sponsor) ? 'Unreadable' : `${Math.floor(sponsor?.spendableXlm ?? 0).toLocaleString()} XLM`}
            note={sponsorLow ? 'Top up: new workers cannot be onboarded' : "Pays new workers' reserves and fees"}
            noteTone={sponsorLow ? 'negative' : 'neutral'}
          />
          <MetricCard
            icon={HiOutlineServerStack} accent="blue" label="Services"
            value={health.data ? (down.length ? `${down.length} down` : 'All ready') : undefined}
            note={health.data ? (down.length ? down.map(([name]) => name).join(', ') : Object.keys(health.data).join(' · ')) : undefined}
            noteTone={down.length ? 'negative' : 'positive'}
          />
        </div>
      )}

      <div className="admin-grid-2">
        <Card title="Services">
          <LoadState state={health} />
          {health.data && (
            <Table
              rows={Object.entries(health.data)}
              rowKey={([name]) => name}
              columns={[
                { label: 'Service', render: ([name]) => name },
                { label: 'Status', render: ([, r]) => <Pill value={r.status} /> },
                {
                  label: 'Checks',
                  render: ([, r]) => r.error ?? Object.entries(r.checks ?? {}).map(([k, c]) => (
                    <span key={k} className={`admin-check ${c.ok ? 'ok' : 'bad'}`} title={c.error}>{k} {c.ms}ms</span>
                  )),
                },
              ]}
            />
          )}
        </Card>
        <Card title="Escrow contract">
          {contract && (readFailed(contract)
            ? <ErrorState kind="server" message={`The escrow contract could not be read: ${contract.error}`} onRetry={() => void ops.reload()} compact />
            : (
              <dl className="admin-facts">
                <div><dt>Contract</dt><dd><Id value={contract.address} /></dd></div>
                <div><dt>Admin</dt><dd><Id value={contract.admin} /></dd></div>
                <div><dt>USDC allowed</dt><dd><Pill value={contract.tokenAllowed ? 'yes' : 'no'} tone={contract.tokenAllowed ? 'good' : 'bad'} /></dd></div>
                <div><dt>Sponsor</dt><dd>{sponsor && !readFailed(sponsor) ? <Id value={sponsor.publicKey} /> : '—'}</dd></div>
              </dl>
            ))}
        </Card>
      </div>

      {o && o.failedPayouts24h.byReason.length > 0 && (
        <Card title="Why payouts failed in the last 24 hours">
          <Table rows={o.failedPayouts24h.byReason} rowKey={(r) => r.reason} columns={[
            { label: 'Reason', render: (r) => <code>{r.reason}</code> },
            { label: 'Payouts', render: (r) => r.count },
          ]} />
        </Card>
      )}

      {o && (
        <Card title="Stuck payments">
          <Table<Row> rows={o.stuckPayments} onRowClick={drawers.open('payment')} empty={{ title: 'Nothing stuck', message: 'Payments still waiting for the network 10 minutes after they were sent show up here.', tone: 'clear' }} rowKey={(r) => r.id} columns={[
            { label: 'Created', render: (r) => when(r.created_at) },
            { label: 'From', render: (r) => <AccountLink id={r.enterprise_id} email={r.enterprise_email} /> },
            { label: 'To', render: (r) => <AccountLink id={r.worker_id} email={r.worker_email} /> },
            { label: 'Amount', render: (r) => money(r.amount, r.currency) },
            { label: 'Status', render: (r) => <Pill value={r.status} /> },
            { label: 'Tx', render: (r) => <Tx hash={r.stellar_tx_hash} /> },
          ]} />
        </Card>
      )}

      {o && (o.stuckCashouts.length > 0 || o.pendingEscrowCreations.length > 0) && (
        <div className="admin-grid-2">
          <Card title="Stuck cash-outs">
            <Table<Row> rows={o.stuckCashouts} onRowClick={drawers.open('cashout')} empty={{ title: 'Nothing stuck', message: 'Cash-outs still pending 15 minutes after they started show up here.', tone: 'clear' }} rowKey={(r) => r.id} columns={[
              { label: 'Created', render: (r) => when(r.created_at) },
              { label: 'Worker', render: (r) => <AccountLink id={r.worker_id} email={r.worker_email} /> },
              { label: 'USDC', render: (r) => money(r.send_usdc) },
              { label: 'MoneyGram', render: (r) => <Pill value={r.mg_status} /> },
            ]} />
          </Card>
          <Card title="Escrows waiting for the chain">
            <Table<Row> rows={o.pendingEscrowCreations} empty={{ title: 'Nothing waiting', message: 'Escrows sent to the contract but not yet confirmed show up here.', tone: 'clear' }} rowKey={(r) => r.id} columns={[
              { label: 'Created', render: (r) => when(r.created_at) },
              { label: 'Employer', render: (r) => <AccountLink id={r.enterprise_id} email={r.enterprise_email} /> },
              { label: 'Token', render: (r) => r.token_code },
              { label: 'Tx', render: (r) => <Tx hash={r.tx_hash} /> },
            ]} />
          </Card>
        </div>
      )}
      {drawers.element}
    </div>
  );
}
