import { Link } from 'react-router-dom';
import { PageHeader } from '@funti3r/ui';
import { admin, readFailed, type Row } from '../api';
import { useLoad } from '../useLoad';
import { AccountLink, Card, Id, LoadState, Pill, Table, Tx } from '../components/bits';
import { money, when } from '../format';

function Tile({ label, value, to, alert, hint }: { label: string; value: string | number; to?: string; alert?: boolean; hint?: string }) {
  const body = (
    <div className={`metric-card admin-tile${alert ? ' alert' : ''}`}>
      <div className="admin-tile-label">{label}</div>
      <div className="metric-value">{value}</div>
      {hint && <div className="admin-tile-hint">{hint}</div>}
    </div>
  );
  return to ? <Link to={to} className="admin-tile-link">{body}</Link> : body;
}

/** What needs attention across the platform right now. */
export default function Overview() {
  const ops = useLoad(admin.ops, []);
  const health = useLoad(admin.health, []);
  const sanctions = useLoad(admin.sanctionsStatus, []);
  const flagged = useLoad(admin.flagged, []);

  const o = ops.data;
  const sponsor = o?.sponsor;
  const contract = o?.contract;
  const listAge = sanctions.data?.list ? Math.round((Date.now() - new Date(sanctions.data.list.fetchedAt).getTime()) / 3_600_000) : null;
  const down = health.data ? Object.entries(health.data).filter(([, r]) => r.status !== 'ready') : [];

  return (
    <div className="dashboard">
      <PageHeader
        title="Overview"
        subtitle="What needs attention across the platform"
        actions={<button className="btn-secondary" onClick={() => { void ops.reload(); void health.reload(); void flagged.reload(); }}>Refresh</button>}
      />
      <LoadState loading={ops.loading && !o} error={ops.error} />

      {o && (
        <div className="metrics-grid admin-tiles">
          <Tile label="Stuck payments" value={o.stuckPayments.length} alert={o.stuckPayments.length > 0} hint="initiated or submitted > 10 min" />
          <Tile label="Stuck cash-outs" value={o.stuckCashouts.length} alert={o.stuckCashouts.length > 0} hint="pending > 15 min" />
          <Tile label="Escrows waiting for the chain" value={o.pendingEscrowCreations.length} alert={o.pendingEscrowCreations.length > 0} />
          <Tile label="Failed payouts (24h)" value={o.failedPayouts24h.total} alert={o.failedPayouts24h.total > 0} to="/money?status=failed" />
          <Tile label="Sanctions flags" value={flagged.data?.flagged.length ?? '…'} alert={!!flagged.data?.flagged.length} to="/compliance" />
          <Tile
            label="Sponsor balance"
            value={sponsor === null ? 'not set' : readFailed(sponsor) ? 'unreadable' : `${Math.floor(sponsor?.spendableXlm ?? 0).toLocaleString()} XLM`}
            alert={!sponsor || readFailed(sponsor) || sponsor.spendableXlm < 100}
            hint="pays new workers' reserves and fees"
          />
          <Tile label="Sanctions list age" value={listAge === null ? 'not loaded' : `${listAge} h`} alert={listAge === null || listAge > 48} to="/compliance" />
          <Tile label="Services" value={health.data ? (down.length ? `${down.length} down` : 'all ready') : '…'} alert={down.length > 0} />
        </div>
      )}

      <div className="admin-grid-2">
        <Card title="Services">
          <LoadState loading={health.loading && !health.data} error={health.error} />
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
            ? <div className="error-banner">Could not read the contract: {contract.error}</div>
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
          <Table<Row> rows={o.stuckPayments} empty="None stuck." rowKey={(r) => r.id} columns={[
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
            <Table<Row> rows={o.stuckCashouts} empty="None stuck." rowKey={(r) => r.id} columns={[
              { label: 'Created', render: (r) => when(r.created_at) },
              { label: 'Worker', render: (r) => <AccountLink id={r.worker_id} email={r.worker_email} /> },
              { label: 'USDC', render: (r) => money(r.send_usdc) },
              { label: 'MoneyGram', render: (r) => <Pill value={r.mg_status} /> },
            ]} />
          </Card>
          <Card title="Escrows waiting for the chain">
            <Table<Row> rows={o.pendingEscrowCreations} empty="None waiting." rowKey={(r) => r.id} columns={[
              { label: 'Created', render: (r) => when(r.created_at) },
              { label: 'Employer', render: (r) => <AccountLink id={r.enterprise_id} email={r.enterprise_email} /> },
              { label: 'Token', render: (r) => r.token_code },
              { label: 'Tx', render: (r) => <Tx hash={r.tx_hash} /> },
            ]} />
          </Card>
        </div>
      )}
    </div>
  );
}
