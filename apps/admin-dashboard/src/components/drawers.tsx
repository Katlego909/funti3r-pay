/**
 * The console's detail drawers: click a row in a list and its full record slides in from the right, as in the
 * dashboards (the shared SlideOver). Each drawer shows what the row could not fit, the record's audit trail, and the
 * actions that belong to it, with a link to the full page where there is one.
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Row as Field, SectionTitle, SlideOver } from '@funti3r/ui';
import { admin, type Row } from '../api';
import { useLoad } from '../useLoad';
import { AccountLink, Id, LoadState, Pill, Tx } from './bits';
import ReasonDialog, { type ReasonAction } from './ReasonDialog';
import { money, short, when } from '../format';

const WIDTH = 520;

/** What was recorded about one record, newest first, compact enough for a drawer. `version` reloads it after an action. */
function AuditTrail({ entityId, version = 0 }: { entityId: string; version?: number }) {
  const { data, error, loading } = useLoad(() => admin.audit({ entityId, limit: 20 }), [entityId, version]);
  return (
    <>
      <SectionTitle>Audit trail</SectionTitle>
      <LoadState loading={loading && !data} error={error} />
      {data && !data.events.length && <p className="admin-empty">Nothing recorded.</p>}
      {data?.events.map((e) => (
        <Field key={e.id} label={when(e.at)}>
          <code>{e.action}</code> · {e.actor_role}
          {e.detail?.reason && <div className="admin-detail">“{e.detail.reason}”</div>}
        </Field>
      ))}
    </>
  );
}

export function PaymentDrawer({ payment, onClose }: { payment: Row | null; onClose: () => void }) {
  const p = payment;
  return (
    <SlideOver openKey={p?.id} title="Payment" onClose={onClose} width={WIDTH}>
      {p && (
        <>
          <SectionTitle>Payment</SectionTitle>
          <Field label="Status"><Pill value={p.status} /></Field>
          <Field label="Amount">{money(p.amount, p.currency)}</Field>
          <Field label="From"><AccountLink id={p.enterprise_id} email={p.enterprise_email} /></Field>
          <Field label="To"><AccountLink id={p.worker_id} email={p.worker_email} /></Field>
          {p.failure_reason && <Field label="Why it failed"><span style={{ color: '#b91c1c' }}>{p.failure_reason}</span></Field>}
          {p.description && <Field label="Memo">{p.description}</Field>}
          <SectionTitle>On chain</SectionTitle>
          <Field label="Transaction"><Tx hash={p.stellar_tx_hash} /></Field>
          <Field label="Checked against the chain">{p.chain_verified_at ? when(p.chain_verified_at) : 'not yet'}</Field>
          <SectionTitle>Timeline</SectionTitle>
          <Field label="Created">{when(p.created_at)}</Field>
          {p.completed_at && <Field label="Completed">{when(p.completed_at)}</Field>}
          {p.failed_at && <Field label="Failed">{when(p.failed_at)}</Field>}
          <Field label="Payment id"><Id value={p.id} /></Field>
          {p.batch_id && <Field label="Batch"><Link to={`/money?batchId=${p.batch_id}`} onClick={onClose}>{short(p.batch_id)}</Link></Field>}
          <AuditTrail entityId={p.id} />
        </>
      )}
    </SlideOver>
  );
}

export function EscrowDrawer({ escrowId, onClose, onChanged }: { escrowId: string | null; onClose: () => void; onChanged: () => void }) {
  const detail = useLoad(async () => (escrowId ? admin.escrow(escrowId) : null), [escrowId]);
  const [action, setAction] = useState<ReasonAction | null>(null);
  const [version, setVersion] = useState(0);
  const x = detail.data?.escrow;

  const actions: ReasonAction[] = !x || x.status !== 'active' ? [] : [
    x.frozen
      ? {
        title: 'Lift the hold on this escrow?', message: 'The worker can claim approved milestones again. This sends a transaction to the contract.',
        confirmLabel: 'Unfreeze',
        run: async (reason) => { const r = await admin.freeze(x.id, false, reason); return `Unfrozen (tx ${r.txHash.slice(0, 8)}…)`; },
      }
      : {
        title: 'Freeze this escrow?', message: 'Nothing can be claimed, approved or refunded while it is frozen. This sends a transaction to the contract.',
        confirmLabel: 'Freeze', danger: true,
        run: async (reason) => { const r = await admin.freeze(x.id, true, reason); return `Frozen (tx ${r.txHash.slice(0, 8)}…)`; },
      },
    ...(x.frozen ? [{
      title: 'Return this frozen escrow to the employer?',
      message: 'Every milestone the worker has not claimed goes back to the employer, and the escrow ends. This cannot be undone.',
      confirmLabel: 'Return to employer', danger: true,
      run: async (reason: string) => { const r = await admin.returnFrozen(x.id, reason); return `Returned ${r.returned} ${r.tokenCode} to the employer`; },
    }] : []),
  ];

  return (
    <SlideOver openKey={escrowId} title="Escrow" onClose={onClose} width={WIDTH}>
      <LoadState loading={detail.loading && !detail.data} error={detail.error} />
      {x && detail.data && (
        <>
          <SectionTitle>Escrow</SectionTitle>
          <Field label="Status"><Pill value={x.status} /> {x.frozen && <Pill value="frozen" />}</Field>
          <Field label="Amount">{money(x.total_amount, x.token_code)}</Field>
          <Field label="Employer"><AccountLink id={x.enterprise_id} email={x.enterprise_email} /></Field>
          <Field label="Worker"><AccountLink id={x.worker_id} email={x.worker_email} /></Field>
          <Field label="Expires">{when(x.expires_at)}</Field>
          <Field label="Created">{when(x.created_at)} · <Tx hash={x.create_tx_hash} /></Field>
          <Field label="On the contract">#{x.onchain_escrow_id} · <Id value={x.contract_address} /></Field>
          <Field label="Escrow id"><Id value={x.id} /></Field>
          {actions.length > 0 && (
            <div className="admin-drawer-actions">
              {actions.map((a) => (
                <button key={a.confirmLabel} className={`btn-secondary${a.danger ? ' admin-danger' : ''}`} onClick={() => setAction(a)}>{a.confirmLabel}</button>
              ))}
            </div>
          )}
          <SectionTitle>Milestones ({detail.data.milestones.length})</SectionTitle>
          {detail.data.milestones.map((m) => (
            <Field key={m.idx} label={`${m.idx + 1}. ${m.description || 'Milestone'}`}>
              {money(m.amount, x.token_code)} <Pill value={m.status} />
              {m.review_status && m.review_status !== 'none' && <div className="admin-detail">review: {m.review_status}</div>}
              <div className="admin-detail">
                {m.approve_tx_hash && <>approved <Tx hash={m.approve_tx_hash} /> </>}
                {m.claim_tx_hash && <>claimed <Tx hash={m.claim_tx_hash} /> </>}
                {m.refund_tx_hash && <>refunded <Tx hash={m.refund_tx_hash} /></>}
              </div>
            </Field>
          ))}
          <AuditTrail entityId={x.id} version={version} />
        </>
      )}
      <ReasonDialog action={action} onClose={() => setAction(null)} onDone={() => { void detail.reload(); setVersion((v) => v + 1); onChanged(); }} />
    </SlideOver>
  );
}

export function CashoutDrawer({ cashout, onClose }: { cashout: Row | null; onClose: () => void }) {
  const c = cashout;
  return (
    <SlideOver openKey={c?.id} title="Cash-out" onClose={onClose} width={WIDTH}>
      {c && (
        <>
          <SectionTitle>Cash-out</SectionTitle>
          <Field label="Status"><Pill value={c.status} /></Field>
          <Field label="Worker"><AccountLink id={c.worker_id} email={c.worker_email} /></Field>
          <Field label="Sent">{money(c.send_usdc, 'USDC')}{c.xlm_spent ? ` (${money(c.xlm_spent, 'XLM')} spent)` : ''}</Field>
          <Field label="Receives">{money(c.receive_amount, c.receive_currency)}</Field>
          <Field label="Country">{c.destination_country ?? '—'}</Field>
          {c.error && <Field label="Error"><span style={{ color: '#b91c1c' }}>{c.error}</span></Field>}
          <SectionTitle>MoneyGram</SectionTitle>
          <Field label="MoneyGram status"><Pill value={c.mg_status} /></Field>
          <Field label="Reference number">{c.reference_number ?? '—'}</Field>
          <Field label="Settlement"><Tx hash={c.settlement_hash} /></Field>
          <SectionTitle>Timeline</SectionTitle>
          <Field label="Started">{when(c.created_at)}</Field>
          {c.completed_at && <Field label="Completed">{when(c.completed_at)}</Field>}
          <Field label="Cash-out id"><Id value={c.id} /></Field>
          <AuditTrail entityId={c.id} />
        </>
      )}
    </SlideOver>
  );
}

export function BatchDrawer({ batch, onClose }: { batch: Row | null; onClose: () => void }) {
  const b = batch;
  const payments = useLoad(async () => (b ? (await admin.payments({ batchId: b.id, limit: 200 })).payments : []), [b?.id]);
  const unsent: Row[] = Array.isArray(b?.unsent) ? b!.unsent : [];
  return (
    <SlideOver openKey={b?.id} title="Payout batch" onClose={onClose} width={WIDTH}>
      {b && (
        <>
          <SectionTitle>Batch</SectionTitle>
          <Field label="Status"><Pill value={b.status} tone={b.status === 'partial' ? 'bad' : undefined} /></Field>
          <Field label="Employer"><AccountLink id={b.enterprise_id} email={b.enterprise_email} /></Field>
          <Field label="Payments asked for">{b.payment_count}</Field>
          <Field label="Amount (USD)">{money(b.total_amount)}</Field>
          <Field label="Created">{when(b.created_at)}</Field>
          <Field label="Batch id"><Id value={b.id} /></Field>
          <SectionTitle>Payments ({payments.data?.length ?? '…'})</SectionTitle>
          <LoadState loading={payments.loading && !payments.data} error={payments.error} />
          {payments.data?.map((p) => (
            <Field key={p.id} label={p.worker_email ?? short(p.worker_id)}>
              {money(p.amount, p.currency)} <Pill value={p.status} />
              {p.failure_reason && <div className="admin-detail" style={{ color: '#b91c1c' }}>{p.failure_reason}</div>}
            </Field>
          ))}
          {unsent.length > 0 && (
            <>
              <SectionTitle>Not sent ({unsent.length})</SectionTitle>
              {unsent.map((u, i) => (
                <Field key={`${u.workerId}-${i}`} label={short(u.workerId)}>
                  {money(u.amountUsd, 'USD')}<div className="admin-detail" style={{ color: '#b91c1c' }}>{u.reason}</div>
                </Field>
              ))}
            </>
          )}
          {b.payment_count > (payments.data?.length ?? 0) + unsent.length && payments.data && (
            <p className="admin-muted">{b.payment_count - payments.data.length - unsent.length} more were not sent; this batch is older than the record of why.</p>
          )}
          <div className="admin-drawer-actions">
            <Link className="btn-secondary" to={`/money?batchId=${b.id}`} onClick={onClose}>Open in the payments list</Link>
          </div>
        </>
      )}
    </SlideOver>
  );
}

export function ScheduleDrawer({ scheduleId, onClose }: { scheduleId: string | null; onClose: () => void }) {
  const detail = useLoad(async () => (scheduleId ? admin.schedule(scheduleId) : null), [scheduleId]);
  const s = detail.data?.schedule;
  const total = detail.data?.items.reduce((n, i) => n + Number(i.amount_usd), 0) ?? 0;
  return (
    <SlideOver openKey={scheduleId} title="Payroll schedule" onClose={onClose} width={WIDTH}>
      <LoadState loading={detail.loading && !detail.data} error={detail.error} />
      {s && detail.data && (
        <>
          <SectionTitle>{s.name}</SectionTitle>
          <Field label="Status"><Pill value={s.status} /></Field>
          <Field label="Employer"><AccountLink id={s.enterprise_id} email={s.enterprise_email} /></Field>
          <Field label="Runs">{s.frequency} on {s.run_day} ({s.timezone})</Field>
          <Field label="Next run">{when(s.next_run_at)}</Field>
          <Field label="Last run">
            {when(s.last_run_at)} {s.last_run_status && <Pill value={s.last_run_status === 'success' ? 'completed' : s.last_run_status} />}
            {s.last_run_error && <div className="admin-detail" style={{ color: '#b91c1c' }}>{s.last_run_error}</div>}
          </Field>
          {s.last_run_batch_id && (
            <Field label="Last run's batch"><Link to={`/money?batchId=${s.last_run_batch_id}`} onClick={onClose}>{short(s.last_run_batch_id)}</Link></Field>
          )}
          <SectionTitle>Pays ({detail.data.items.length}) · {money(total, 'USD')} a run</SectionTitle>
          {detail.data.items.map((i) => (
            <Field key={i.worker_id} label={i.worker_email ?? short(i.worker_id)}>
              {money(i.amount_usd, 'USD')}{i.memo && <div className="admin-detail">{i.memo}</div>}
            </Field>
          ))}
          <AuditTrail entityId={s.id} />
        </>
      )}
    </SlideOver>
  );
}

/** The whole audit record: the detail as recorded, and links to what it was about and who did it. */
export function AuditEventDrawer({ event, onClose }: { event: Row | null; onClose: () => void }) {
  const e = event;
  const target = e?.entity_type === 'user' ? `/accounts/${e.entity_id}`
    : e?.entity_type === 'payment' && e.detail?.batchId ? `/money?batchId=${e.detail.batchId}` : null;
  return (
    <SlideOver openKey={e?.id} title="Audit event" onClose={onClose} width={WIDTH}>
      {e && (
        <>
          <SectionTitle>What happened</SectionTitle>
          <Field label="Action"><code>{e.action}</code></Field>
          <Field label="When">{when(e.at)}</Field>
          <Field label="By">{e.actor_id ? <AccountLink id={e.actor_id} email={e.actor_role} /> : e.actor_role}</Field>
          <Field label="On">{e.entity_type} {target ? <Link to={target} onClick={onClose}><Id value={e.entity_id} /></Link> : <Id value={e.entity_id} />}</Field>
          {e.detail?.reason && <Field label="Reason">“{e.detail.reason}”</Field>}
          {e.detail?.txHash && <Field label="Transaction"><Tx hash={e.detail.txHash} /></Field>}
          <Field label="Request id"><Id value={e.request_id} /></Field>
          <SectionTitle>Recorded detail</SectionTitle>
          <pre className="admin-drawer-json">{JSON.stringify(e.detail ?? {}, null, 2)}</pre>
        </>
      )}
    </SlideOver>
  );
}

/** A quick look at an account from a list, with the full page one click away. */
export function AccountDrawer({ accountId, onClose }: { accountId: string | null; onClose: () => void }) {
  const account = useLoad(async () => (accountId ? admin.account(accountId) : null), [accountId]);
  const wallet = useLoad(async () => (accountId ? admin.money(accountId) : null), [accountId]);
  const kyc = useLoad(async () => (accountId ? (await admin.kycStatuses([accountId])).statuses[accountId] : null), [accountId]);
  const u = account.data?.user;
  const m = wallet.data;
  return (
    <SlideOver openKey={accountId} title={u?.email ?? 'Account'} onClose={onClose} width={WIDTH}>
      <LoadState loading={account.loading && !u} error={account.error} />
      {u && account.data && (
        <>
          <SectionTitle>Account</SectionTitle>
          <Field label="Status"><Pill value={u.status} /></Field>
          <Field label="Role">{u.role}</Field>
          <Field label="KYC"><Pill value={kyc.data?.status ?? (kyc.loading ? '…' : 'not submitted')} /></Field>
          <Field label="Name">{[u.first_name, u.last_name].filter(Boolean).join(' ') || '—'}</Field>
          <Field label="Country">{u.country ?? '—'}</Field>
          <Field label="Paid in">{u.preferred_currency ?? '—'}</Field>
          <Field label="Joined">{when(u.created_at)}</Field>
          {[...account.data.memberships, ...account.data.employers].map((c) => (
            <Field key={`${c.company_id}-${c.company_role ?? 'worker'}`} label={c.company_role ? `Member (${c.company_role})` : 'Works for'}>
              <Link to={`/companies/${c.company_id}`} onClick={onClose}>{c.company_name}</Link>
            </Field>
          ))}
          <SectionTitle>Wallet</SectionTitle>
          <Field label="Address"><Id value={m?.wallet.address ?? u.stellar_public_key} keep={8} /></Field>
          {m?.wallet.balances.map((b, i) => (
            <Field key={i} label={b.asset_type === 'native' ? 'XLM' : b.asset_code}>{money(b.balance)}</Field>
          ))}
          {m && <Field label="Payments / escrows / cash-outs">{m.payments.length} / {m.escrows.length} / {m.cashouts.length}</Field>}
          <div className="admin-drawer-actions">
            <Link className="btn-primary" to={`/accounts/${u.id}`} onClick={onClose}>Open full account</Link>
          </div>
        </>
      )}
    </SlideOver>
  );
}

/** A quick look at a company from a list, with the full page one click away. */
export function CompanyDrawer({ companyId, onClose }: { companyId: string | null; onClose: () => void }) {
  const company = useLoad(async () => (companyId ? admin.company(companyId) : null), [companyId]);
  const c = company.data?.company;
  return (
    <SlideOver openKey={companyId} title={c?.company_name ?? 'Company'} onClose={onClose} width={WIDTH}>
      <LoadState loading={company.loading && !c} error={company.error} />
      {c && company.data && (
        <>
          <SectionTitle>Company</SectionTitle>
          <Field label="Owner"><AccountLink id={c.owner_id} email={c.owner_email} /></Field>
          <Field label="Country">{c.country ?? '—'}</Field>
          <Field label="Registration">{c.company_registration ?? '—'}</Field>
          <Field label="Paying wallet"><Id value={c.wallet} keep={8} /></Field>
          <Field label="Created">{when(c.created_at)}</Field>
          <SectionTitle>Members ({company.data.members.length})</SectionTitle>
          {company.data.members.map((mb) => (
            <Field key={mb.id} label={mb.email}>{mb.company_role} <Pill value={mb.status} /></Field>
          ))}
          <SectionTitle>Workers ({company.data.workers.length})</SectionTitle>
          {company.data.workers.map((w) => (
            <Field key={w.id} label={w.email}><Pill value={w.status} /></Field>
          ))}
          <div className="admin-drawer-actions">
            <Link className="btn-primary" to={`/companies/${c.id}`} onClick={onClose}>Open full company</Link>
          </div>
        </>
      )}
    </SlideOver>
  );
}

export type DrawerKind = 'payment' | 'escrow' | 'cashout' | 'batch' | 'schedule' | 'audit' | 'account' | 'company';

/**
 * Which record's drawer is open on a page, and the drawers themselves. A table opens one with
 * `onRowClick={drawers.open('payment')}` (or `open('account', 'user_id')` when the id is in another column).
 */
export function useDrawers(onChanged: () => void = () => undefined) {
  const [state, setState] = useState<{ kind: DrawerKind; row: Row } | null>(null);
  const close = () => setState(null);
  const open = (kind: DrawerKind, idKey = 'id') => (row: Row) => setState({ kind, row: { ...row, id: row[idKey] } });
  const row = (kind: DrawerKind) => (state?.kind === kind ? state.row : null);
  const id = (kind: DrawerKind) => (row(kind)?.id as string | undefined) ?? null;
  const element = (
    <>
      <PaymentDrawer payment={row('payment')} onClose={close} />
      <EscrowDrawer escrowId={id('escrow')} onClose={close} onChanged={onChanged} />
      <CashoutDrawer cashout={row('cashout')} onClose={close} />
      <BatchDrawer batch={row('batch')} onClose={close} />
      <ScheduleDrawer scheduleId={id('schedule')} onClose={close} />
      <AuditEventDrawer event={row('audit')} onClose={close} />
      <AccountDrawer accountId={id('account')} onClose={close} />
      <CompanyDrawer companyId={id('company')} onClose={close} />
    </>
  );
  return { open, element };
}
