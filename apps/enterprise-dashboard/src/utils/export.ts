import { IS_MAINNET } from '../lib/explorer.js';

// jsPDF + autotable are ~400 KB, so they load only when someone actually exports a PDF.
async function loadPdf() {
  const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
  return { jsPDF, autoTable };
}

// ── Branding (every PDF) ──────────────────────────────────────────────────────

type Rgb = [number, number, number];
/** The app's colours (App.css :root): --primary, --accent, --dark, plus a light tint of the primary for table rows. */
const BRAND = {
  primary: [66, 10, 99] as Rgb,
  accent: [254, 119, 41] as Rgb,
  ink: [10, 17, 28] as Rgb,
  muted: [107, 114, 128] as Rgb,
  tint: [249, 246, 251] as Rgb,
  rule: [232, 226, 238] as Rgb,
};
const HEADER_H = 64;
const FOOTER_H = 40;
/** Where content starts below the header band, on the first page and on every continuation page. */
const CONTENT_TOP = HEADER_H + 26;
const LOGO_RATIO = 1310 / 212; // public/images/logo-wht.png

let logoPromise: Promise<string | null> | null = null;
/** The white logo as a data URL, fetched once. Null when it cannot load: the header then sets the name in type. */
function loadLogo(): Promise<string | null> {
  logoPromise ??= fetch('/images/logo-wht.png')
    .then((r) => (r.ok ? r.blob() : Promise.reject(new Error(`logo ${r.status}`))))
    .then((b) => new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(b);
    }))
    .catch(() => { logoPromise = null; return null; });
  return logoPromise;
}

/** Table colours for every autoTable: brand-purple header row, faintly tinted alternate rows. */
const brandTable = {
  headStyles: { fillColor: BRAND.primary, textColor: [255, 255, 255] as Rgb, fontStyle: 'bold' as const },
  alternateRowStyles: { fillColor: BRAND.tint },
  styles: { textColor: [30, 30, 30] as Rgb, lineColor: BRAND.rule },
};

/** A new A4 document with what the branded header and footer need. Lay content out from `top`. */
async function brandedDoc(orientation: 'portrait' | 'landscape') {
  const [{ jsPDF, autoTable }, logo] = await Promise.all([loadPdf(), loadLogo()]);
  const doc = new jsPDF({ orientation, unit: 'pt', format: 'a4' });
  return {
    doc,
    autoTable,
    logo,
    W: doc.internal.pageSize.getWidth(),
    top: CONTENT_TOP,
    /** autoTable margins that keep continuation pages clear of the header band and footer. */
    margin: (side: number) => ({ top: CONTENT_TOP, bottom: FOOTER_H + 12, left: side, right: side }),
  };
}

/**
 * Draws the header band (logo, title, subtitle, orange accent rule) and the footer (platform line, generated time,
 * page numbers) on every page, then downloads. Call it last, once all content is laid out.
 */
function finishBranded(doc: any, logo: string | null, title: string, subtitle: string, filename: string, side = 32) {
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const pages = doc.internal.getNumberOfPages();
  const generated = `Generated ${new Date().toLocaleString()}`;

  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);

    doc.setFillColor(...BRAND.primary);
    doc.rect(0, 0, W, HEADER_H, 'F');
    doc.setFillColor(...BRAND.accent);
    doc.rect(0, HEADER_H, W, 3, 'F');
    if (logo) {
      const h = 20;
      // One alias for every page, deflated: otherwise each page embeds the raw PNG (~1 MB).
      doc.addImage(logo, 'PNG', side, (HEADER_H - h) / 2, h * LOGO_RATIO, h, 'brand-logo', 'FAST');
    } else {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(16);
      doc.setTextColor(255, 255, 255);
      doc.text('Funti3rPay', side, HEADER_H / 2 + 6);
    }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(255, 255, 255);
    doc.text(title, W - side, HEADER_H / 2 - 1, { align: 'right' });
    if (subtitle) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8.5);
      doc.setTextColor(226, 206, 240);
      doc.text(subtitle, W - side, HEADER_H / 2 + 12, { align: 'right' });
    }

    doc.setDrawColor(...BRAND.rule);
    doc.setLineWidth(0.5);
    doc.line(side, H - FOOTER_H + 8, W - side, H - FOOTER_H + 8);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(...BRAND.primary);
    doc.text('Funti3rPay', side, H - 16);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...BRAND.muted);
    doc.text('  ·  Cross-border payroll on Stellar  ·  pay.funti3r.xyz', side + doc.getTextWidth('Funti3rPay'), H - 16);
    doc.text(`${generated}  ·  Page ${i} of ${pages}`, W - side, H - 16, { align: 'right' });
  }

  doc.save(filename);
}

/** Red band for anything produced on the test network, so it cannot pass as a record of real money. Returns the next y. */
function testnetBanner(doc: any, x: number, y: number, width: number, text: string): number {
  doc.setFillColor(254, 226, 226);
  doc.roundedRect(x, y, width, 24, 4, 4, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(153, 27, 27);
  doc.text(text, x + width / 2, y + 15.5, { align: 'center' });
  return y + 36;
}

function timestamp() {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
}

// ── CSV ───────────────────────────────────────────────────────────────────────

function escapeCell(v: unknown): string {
  const s = v == null ? '' : String(v);
  return s.includes(',') || s.includes('"') || s.includes('\n')
    ? `"${s.replace(/"/g, '""')}"`
    : s;
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function exportJSON(value: unknown, filename: string) {
  downloadBlob(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }), filename);
}

export function exportCSV(headers: string[], rows: unknown[][], filename: string) {
  const lines = [headers, ...rows].map((r) => r.map(escapeCell).join(',')).join('\r\n');
  downloadBlob(new Blob([lines], { type: 'text/csv;charset=utf-8;' }), filename);
}

// ── PDF ───────────────────────────────────────────────────────────────────────

export async function exportPDF(
  title: string,
  subtitle: string,
  headers: string[],
  rows: unknown[][],
  filename: string,
  columnStyles?: Record<number, { cellWidth?: 'auto' | 'wrap' | number }>,
) {
  const { doc, autoTable, logo, top, margin } = await brandedDoc('landscape');

  autoTable(doc, {
    startY: top,
    head: [headers],
    body: rows.map((r) => r.map((v) => (v == null ? '' : String(v)))),
    ...brandTable,
    styles: { ...brandTable.styles, fontSize: 8.5, cellPadding: 5 },
    columnStyles,
    margin: margin(32),
  });

  finishBranded(doc, logo, title, subtitle, filename);
}

// ── Payments helpers ──────────────────────────────────────────────────────────

export interface ExportPayment {
  id: string;
  worker_email?: string;
  worker_id: string;
  amount: string | number;
  currency: string;
  status: string;
  stellar_tx_hash?: string;
  created_at: string;
}

const PAYMENT_HEADERS = ['ID', 'Worker', 'Amount', 'Currency', 'Status', 'Tx Hash', 'Date'];
const paymentRow = (p: ExportPayment) => [
  p.id,
  p.worker_email ?? p.worker_id,
  p.amount,
  p.currency,
  p.status,
  p.stellar_tx_hash ?? '',
  new Date(p.created_at).toLocaleString(),
];

export function exportPaymentsCSV(payments: ExportPayment[], suffix = '') {
  exportCSV(PAYMENT_HEADERS, payments.map(paymentRow), `funti3rpay-payments${suffix}-${timestamp()}.csv`);
}
export function exportPaymentsPDF(payments: ExportPayment[], suffix = '') {
  return exportPDF(
    'Payment Report',
    new Date().toLocaleDateString(),
    PAYMENT_HEADERS,
    payments.map(paymentRow),
    `funti3rpay-payments${suffix}-${timestamp()}.pdf`,
  );
}

// ── Escrow milestones + cash-outs (worker wallet) ─────────────────────────────

export interface ExportMilestone {
  escrowId: string;
  title: string;
  position: string; // "1 of 3"
  amountXlm: number;
  status: string;
  expires: string;
  approvedAt: string | null;
  claimedAt: string | null;
  approveTxHash: string | null;
  claimTxHash: string | null;
  refundTxHash: string | null;
}

const MILESTONE_HEADERS = ['Escrow', 'Milestone', 'Amount (XLM)', 'Status', 'Expires', 'Approved', 'Claimed', 'Approve Tx', 'Claim Tx', 'Refund Tx'];
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : '');
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString() : '');
/** A 64-character hash does not fit a page column; the PDF shows its ends, the CSV carries the whole thing. */
const shortHash = (h: string | null) => (h ? `${h.slice(0, 8)}…${h.slice(-8)}` : '');
const milestoneRow = (m: ExportMilestone) => [
  m.escrowId,
  m.position ? `${m.title} (${m.position})` : m.title,
  m.amountXlm,
  m.status,
  new Date(m.expires).toLocaleDateString(),
  when(m.approvedAt),
  when(m.claimedAt),
  m.approveTxHash ?? '',
  m.claimTxHash ?? '',
  m.refundTxHash ?? '',
];

export function exportMilestonesCSV(milestones: ExportMilestone[], suffix = '') {
  exportCSV(MILESTONE_HEADERS, milestones.map(milestoneRow), `funti3rpay-escrow-milestones${suffix}-${timestamp()}.csv`);
}
export function exportMilestonesPDF(milestones: ExportMilestone[], suffix = '') {
  const rows = milestones.map((m) => [
    shortHash(m.escrowId),
    m.position ? `${m.title} (${m.position})` : m.title,
    m.amountXlm.toLocaleString(undefined, { maximumFractionDigits: 2 }),
    m.status,
    day(m.expires),
    day(m.approvedAt),
    day(m.claimedAt),
    shortHash(m.approveTxHash),
    shortHash(m.claimTxHash),
    shortHash(m.refundTxHash),
  ]);
  // Short columns (amounts, status, dates) take their content's width so a date never breaks across lines.
  return exportPDF(
    'Escrow Milestones Report',
    new Date().toLocaleDateString(),
    MILESTONE_HEADERS,
    rows,
    `funti3rpay-escrow-milestones${suffix}-${timestamp()}.pdf`,
    { 2: { cellWidth: 'wrap' }, 3: { cellWidth: 'wrap' }, 4: { cellWidth: 'wrap' }, 5: { cellWidth: 'wrap' }, 6: { cellWidth: 'wrap' } },
  );
}

export interface ExportCashout {
  createdAt: string;
  completedAt: string | null;
  status: string;
  receiveAmount: string | null;
  receiveCurrency: string | null;
  destinationCountry: string | null;
  referenceNumber: string | null;
  sendUsdc: string | null;
  fee: string | null;
  feeCurrency: string | null;
  xlmSpent: number | null;
  settlementHash: string | null;
  sandbox: boolean;
}

const CASHOUT_HEADERS = ['Date', 'Status', 'Recipient Collects', 'Country', 'Pickup Reference', 'Sent (USDC)', 'Fee', 'XLM Spent', 'Settlement Tx', 'Mode'];
const cashoutRow = (c: ExportCashout) => [
  new Date(c.createdAt).toLocaleString(),
  c.status,
  c.receiveAmount ? `${c.receiveAmount}${c.receiveCurrency ? ` ${c.receiveCurrency}` : ''}` : '',
  c.destinationCountry ?? '',
  c.referenceNumber ?? '',
  c.sendUsdc ?? '',
  c.fee ? `${c.fee}${c.feeCurrency ? ` ${c.feeCurrency}` : ''}` : '',
  c.xlmSpent ?? '',
  c.settlementHash ?? '',
  c.sandbox ? 'Sandbox (no cash dispensed)' : 'Live',
];

export function exportCashoutsCSV(cashouts: ExportCashout[]) {
  exportCSV(CASHOUT_HEADERS, cashouts.map(cashoutRow), `funti3rpay-cashouts-${timestamp()}.csv`);
}
export function exportCashoutsPDF(cashouts: ExportCashout[]) {
  const rows = cashouts.map((c) => {
    const row = cashoutRow(c);
    row[8] = shortHash(c.settlementHash);
    return row;
  });
  return exportPDF(
    'Cash-out Report',
    new Date().toLocaleDateString(),
    CASHOUT_HEADERS,
    rows,
    `funti3rpay-cashouts-${timestamp()}.pdf`,
    { 1: { cellWidth: 'wrap' }, 3: { cellWidth: 'wrap' }, 5: { cellWidth: 'wrap' }, 7: { cellWidth: 'wrap' } },
  );
}

// ── Workers helpers ───────────────────────────────────────────────────────────

export interface ExportWorker {
  id: string;
  email: string;
  first_name?: string;
  last_name?: string;
  country?: string;
  preferred_currency?: string;
  kyc_status?: string;
  stellar_public_key?: string | null;
  created_at?: string;
}

const WORKER_HEADERS = ['ID', 'Email', 'Name', 'Country', 'Currency', 'KYC', 'Stellar Key', 'Joined'];
const workerRow = (w: ExportWorker) => [
  w.id,
  w.email,
  [w.first_name, w.last_name].filter(Boolean).join(' ') || '—',
  w.country ?? '—',
  w.preferred_currency ?? 'USDC',
  w.kyc_status ?? '—',
  w.stellar_public_key ?? '—',
  w.created_at ? new Date(w.created_at).toLocaleDateString() : '—',
];

export function exportWorkersCSV(workers: ExportWorker[]) {
  exportCSV(WORKER_HEADERS, workers.map(workerRow), `funti3rpay-workers-${timestamp()}.csv`);
}
export function exportWorkersPDF(workers: ExportWorker[]) {
  return exportPDF('Worker Report', new Date().toLocaleDateString(), WORKER_HEADERS, workers.map(workerRow), `funti3rpay-workers-${timestamp()}.pdf`);
}

// ── Payslip ───────────────────────────────────────────────────────────────────

/** "Company Name — email", falling back to just the email when no company name is set. */
export function formatCompanyLabel(companyName: string | null | undefined, email: string): string {
  return companyName ? `${companyName} — ${email}` : email;
}

export interface PayslipData {
  id: string;
  workerEmail: string;
  enterpriseEmail: string;
  companyName?: string | null;
  amount: string | number;
  currency: string;
  usdValue?: number | null;
  fxRate?: number | null;
  stellarTxHash?: string | null;
  stellarDestination?: string | null;
  feePaidXlm?: string | null;
  memo?: string | null;
  createdAt: string;
  completedAt?: string | null;
}

const MONO_ROWS = new Set(['Stellar Tx Hash', 'Worker Stellar Address', 'Payment ID']);

export async function generatePayslip(p: PayslipData) {
  const { doc, autoTable, logo, W, top, margin } = await brandedDoc('portrait');
  const M = 56;
  const inner = W - M * 2;

  let y = top;
  if (!IS_MAINNET) y = testnetBanner(doc, M, y - 8, inner, 'STELLAR TEST NETWORK: NOT REAL MONEY. NOT A VALID PAYMENT RECORD.');
  y += 22;

  // Amount
  const amtFormatted = Number(p.amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 7 });
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(30);
  doc.setTextColor(...BRAND.primary);
  doc.text(`${amtFormatted} ${p.currency}`, W / 2, y, { align: 'center' });
  y += 18;
  if (p.usdValue != null) {
    const usdStr = p.usdValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(130, 130, 130);
    doc.text(`$${usdStr} USD sent by employer`, W / 2, y, { align: 'center' });
    y += 14;
  }
  y += 20;
  doc.setDrawColor(225, 225, 225);
  doc.line(M, y, W - M, y);
  y += 22;

  // Employer / Worker — two columns, no boxes
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.setTextColor(...BRAND.accent);
  doc.text('EMPLOYER', M, y);
  doc.text('WORKER', W / 2 + 8, y);
  y += 13;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.setTextColor(30, 30, 30);
  doc.text(formatCompanyLabel(p.companyName, p.enterpriseEmail), M, y, { maxWidth: inner / 2 - 12 });
  doc.text(p.workerEmail, W / 2 + 8, y, { maxWidth: inner / 2 - 8 });
  y += 30;
  doc.setDrawColor(225, 225, 225);
  doc.line(M, y, W - M, y);
  y += 14;

  // Details table
  const fmtDate = (d: string) =>
    new Date(d).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
  const fmtTime = (d: string) => new Date(d).toLocaleString();

  const rows: [string, string][] = [['Payment Date', fmtDate(p.createdAt)]];
  if (p.completedAt) rows.push(['Completed', fmtTime(p.completedAt)]);
  rows.push(['Amount Received', `${amtFormatted} ${p.currency}`]);
  if (p.usdValue != null) {
    rows.push(['Employer Sent (USD)', `$${p.usdValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`]);
  }
  if (p.fxRate) {
    rows.push(['Exchange Rate', `${p.fxRate.toLocaleString(undefined, { maximumFractionDigits: 4 })} ${p.currency}/USD`]);
    rows.push(['Exchange Method', 'Stellar DEX · auto-converted']);
  }
  if (p.feePaidXlm) rows.push(['Conversion Cost', `${p.feePaidXlm} XLM`]);
  if (p.memo) rows.push(['Memo / Reference', p.memo]);
  rows.push(['Payment ID', p.id]);
  if (p.stellarTxHash) rows.push(['Stellar Tx Hash', p.stellarTxHash]);
  if (p.stellarDestination) rows.push(['Worker Stellar Address', p.stellarDestination]);

  autoTable(doc, {
    startY: y,
    body: rows,
    styles: { fontSize: 9, cellPadding: { top: 7, bottom: 7, left: 0, right: 8 } },
    columnStyles: {
      0: { fontStyle: 'bold', textColor: BRAND.primary, cellWidth: 160 },
      1: { textColor: [20, 20, 20] },
    },
    alternateRowStyles: brandTable.alternateRowStyles,
    margin: margin(M),
    // Hashes, addresses and ids in monospace, small enough to sit on one line and be copied whole.
    didParseCell: (cell: any) => {
      if (cell.section === 'body' && cell.column.index === 1 && MONO_ROWS.has(String(cell.row.raw[0]))) {
        cell.cell.styles.font = 'courier';
        cell.cell.styles.fontSize = 7;
      }
    },
  });

  const afterTable = (doc as any).lastAutoTable.finalY + 20;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(...BRAND.muted);
  doc.text(
    IS_MAINNET
      ? 'This is an official payment record generated by Funti3rPay. Retain for tax, visa, or loan applications.'
      : 'Generated on the Stellar test network for demonstration. It records no real payment.',
    W / 2, afterTable, { align: 'center', maxWidth: inner },
  );

  const dateStr = new Date(p.createdAt).toISOString().slice(0, 10);
  finishBranded(doc, logo, 'Payslip', fmtDate(p.createdAt), `payslip-${p.currency}-${dateStr}-${p.id.slice(0, 8)}.pdf`, M);
}

// ── Analytics helpers ─────────────────────────────────────────────────────────

export interface ExportSummary {
  totalCount: number;
  byStatus: Record<string, number>;
  byCurrency: Record<string, number>;
  completedVolumeUsd?: number;
  successRate?: number;
}

export function exportAnalyticsCSV(summary: ExportSummary, recentPayments: ExportPayment[]) {
  const summaryRows = [
    ['Metric', 'Value'],
    ['Total Payments', summary.totalCount],
    ['Completed', summary.byStatus['completed'] ?? 0],
    ['Failed', summary.byStatus['failed'] ?? 0],
    ['Success Rate', summary.successRate != null ? `${summary.successRate.toFixed(1)}%` : '—'],
    ['Total Volume (USD)', summary.completedVolumeUsd ?? '—'],
    ...Object.entries(summary.byCurrency ?? {}).map(([k, v]) => [`Volume ${k}`, v]),
  ];
  const separator = [[''], ['Recent Payments'], PAYMENT_HEADERS];
  const paymentRows = recentPayments.map(paymentRow);
  const all = [...summaryRows, ...separator, ...paymentRows];
  exportCSV([], all, `funti3rpay-analytics-${timestamp()}.csv`);
}

export async function exportAnalyticsPDF(summary: ExportSummary, recentPayments: ExportPayment[]) {
  const { doc, autoTable, logo, top, margin } = await brandedDoc('landscape');

  // Summary KPIs
  autoTable(doc, {
    startY: top,
    head: [['Metric', 'Value']],
    body: [
      ['Total Payments', summary.totalCount],
      ['Completed', summary.byStatus['completed'] ?? 0],
      ['Failed', summary.byStatus['failed'] ?? 0],
      ['Success Rate', summary.successRate != null ? `${summary.successRate.toFixed(1)}%` : '—'],
      ['Total Volume (USD)', summary.completedVolumeUsd != null
        ? `$${summary.completedVolumeUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
        : '—'],
      ...Object.entries(summary.byCurrency ?? {}).map(([k, v]) => [`Volume ${k}`, `${Number(v).toLocaleString(undefined, { maximumFractionDigits: 7 })} ${k}`]),
    ],
    ...brandTable,
    styles: { ...brandTable.styles, fontSize: 9 },
    columnStyles: { 0: { fontStyle: 'bold', textColor: BRAND.primary } },
    margin: margin(32),
  });

  const afterSummary = (doc as any).lastAutoTable.finalY + 22;
  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...BRAND.primary);
  doc.text('Recent Payments', 32, afterSummary);

  autoTable(doc, {
    startY: afterSummary + 8,
    head: [PAYMENT_HEADERS],
    body: recentPayments.map(paymentRow).map((r) => r.map((v) => String(v))),
    ...brandTable,
    styles: { ...brandTable.styles, fontSize: 8 },
    margin: margin(32),
  });

  finishBranded(doc, logo, 'Analytics Report', new Date().toLocaleDateString(), `funti3rpay-analytics-${timestamp()}.pdf`);
}

// ── Income statement ──────────────────────────────────────────────────────────

export interface IncomeStatementData {
  workerEmail: string;
  from: Date;
  to: Date;
  /** Completed payments received in the period. */
  payments: Array<{ createdAt: string; payer: string; amount: number; currency: string; txHash?: string | null }>;
  /** Today's USD value of `amount` of `currency`, null when no rate is known. */
  toUsdToday: (amount: number, currency: string) => number | null;
  isMainnet: boolean;
  explorerUrl: string;
}

/**
 * A statement of income received over a period, for a loan, lease or visa application. Every line carries its Stellar
 * transaction hash, so anyone can check it on the public ledger. Amounts are what arrived; payments do not record their
 * USD value at the time, so the USD total is labelled as today's value.
 */
export async function generateIncomeStatement(s: IncomeStatementData) {
  const { doc, autoTable, logo, W, top, margin } = await brandedDoc('portrait');
  const H = doc.internal.pageSize.getHeight();
  const M = 48;
  const day = (d: Date | string) => new Date(d).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  const num = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 7 });
  let y = top - 8;

  if (!s.isMainnet) y = testnetBanner(doc, M, y, W - M * 2, 'STELLAR TEST NETWORK: NOT REAL MONEY. NOT VALID AS PROOF OF INCOME.');

  // Who and when, as label/value pairs.
  const facts: Array<[string, string]> = [
    ['ACCOUNT', s.workerEmail],
    ['PERIOD', `${day(s.from)} to ${day(s.to)}`],
    ['ISSUED', new Date().toLocaleString()],
  ];
  const colW = (W - M * 2) / facts.length;
  facts.forEach(([label, value], i) => {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(...BRAND.accent);
    doc.text(label, M + i * colW, y + 6);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9.5);
    doc.setTextColor(...BRAND.ink);
    doc.text(value, M + i * colW, y + 20, { maxWidth: colW - 10 });
  });
  y += 40;

  // Totals per currency, then an indicative USD total.
  const totals = new Map<string, number>();
  for (const p of s.payments) totals.set(p.currency, (totals.get(p.currency) ?? 0) + p.amount);
  let usd = 0;
  let unpriced = false;
  for (const [cur, amt] of totals) {
    const v = s.toUsdToday(amt, cur);
    if (v === null) unpriced = true;
    else usd += v;
  }
  const totalRows: string[][] = [...totals].map(([cur, amt]) => [`Total received in ${cur}`, `${num(amt)} ${cur}`]);
  totalRows.push(['Payments received', String(s.payments.length)]);
  if (totals.size > 0) {
    totalRows.push([
      `Approximate value in USD at today's rates${unpriced ? ' (excludes currencies with no rate)' : ''}`,
      `$${usd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
    ]);
  }
  autoTable(doc, {
    startY: y,
    body: totalRows,
    ...brandTable,
    styles: { ...brandTable.styles, fontSize: 9.5, cellPadding: 6 },
    columnStyles: { 0: { fontStyle: 'bold', textColor: BRAND.primary }, 1: { halign: 'right', fontStyle: 'bold' } },
    margin: margin(M),
  });
  y = (doc as any).lastAutoTable.finalY + 18;

  autoTable(doc, {
    startY: y,
    head: [['Date', 'Paid by', 'Amount', 'Stellar transaction']],
    body: s.payments.map((p) => [day(p.createdAt), p.payer, `${num(p.amount)} ${p.currency}`, p.txHash ?? '—']),
    ...brandTable,
    styles: { ...brandTable.styles, fontSize: 8, cellPadding: 4, overflow: 'linebreak' },
    // The hash column must hold 64 Courier characters on one line (~250pt at 6.5pt) so it can be copied whole.
    columnStyles: { 0: { cellWidth: 62 }, 1: { cellWidth: 100 }, 2: { cellWidth: 75 }, 3: { font: 'courier', fontSize: 6.5 } },
    margin: margin(M),
  });
  y = (doc as any).lastAutoTable.finalY + 20;
  if (y > H - FOOTER_H - 40) {
    doc.addPage();
    y = top;
  }

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(...BRAND.muted);
  const note =
    `Each payment settled on the Stellar ${s.isMainnet ? 'public network' : 'test network'}. ` +
    `Verify any line at ${s.explorerUrl}/tx/ followed by its transaction. Amounts are what the account received.`;
  doc.text(doc.splitTextToSize(note, W - M * 2), M, y);

  // Local dates: toISOString would name a period starting 1 Jan after 31 Dec east of GMT.
  const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const file = `funti3rpay-income-statement-${ymd(s.from)}-to-${ymd(s.to)}.pdf`;
  finishBranded(doc, logo, 'Income Statement', `${day(s.from)} to ${day(s.to)}`, file, M);
}
