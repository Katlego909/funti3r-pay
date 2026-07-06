import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

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

export function exportCSV(headers: string[], rows: unknown[][], filename: string) {
  const lines = [headers, ...rows].map((r) => r.map(escapeCell).join(',')).join('\r\n');
  downloadBlob(new Blob([lines], { type: 'text/csv;charset=utf-8;' }), filename);
}

// ── PDF ───────────────────────────────────────────────────────────────────────

export function exportPDF(
  title: string,
  subtitle: string,
  headers: string[],
  rows: unknown[][],
  filename: string,
) {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(20, 20, 20);
  doc.text('FUNTI3RPAY', 32, 32);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(80, 80, 80);
  doc.text(title, pageW / 2, 32, { align: 'center' });
  doc.setFontSize(8.5);
  doc.setTextColor(140, 140, 140);
  doc.text(subtitle, pageW - 32, 32, { align: 'right' });
  doc.setDrawColor(210, 210, 210);
  doc.setLineWidth(0.5);
  doc.line(32, 40, pageW - 32, 40);

  autoTable(doc, {
    startY: 56,
    head: [headers],
    body: rows.map((r) => r.map((v) => (v == null ? '' : String(v)))),
    styles: { fontSize: 8.5, cellPadding: 5 },
    headStyles: { fillColor: [245, 245, 245], textColor: [30, 30, 30], fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [250, 250, 250] },
    margin: { left: 32, right: 32 },
  });

  // Footer with page numbers
  const pageCount = (doc as any).internal.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(150);
    doc.text(
      `Page ${i} of ${pageCount} · Generated ${new Date().toLocaleString()}`,
      pageW / 2,
      doc.internal.pageSize.getHeight() - 12,
      { align: 'center' },
    );
  }

  doc.save(filename);
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
  exportPDF(
    'Payment Report',
    new Date().toLocaleDateString(),
    PAYMENT_HEADERS,
    payments.map(paymentRow),
    `funti3rpay-payments${suffix}-${timestamp()}.pdf`,
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
  stellar_public_key?: string;
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
  exportPDF('Worker Report', new Date().toLocaleDateString(), WORKER_HEADERS, workers.map(workerRow), `funti3rpay-workers-${timestamp()}.pdf`);
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

export function generatePayslip(p: PayslipData) {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();
  const M = 56;
  const inner = W - M * 2;

  let y = 48;

  // Header — plain text, thin rule
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(20, 20, 20);
  doc.text('FUNTI3RPAY', M, y);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(120, 120, 120);
  doc.text('PAYSLIP', W - M, y, { align: 'right' });
  y += 10;
  doc.setDrawColor(210, 210, 210);
  doc.setLineWidth(0.5);
  doc.line(M, y, W - M, y);
  y += 32;

  // Amount
  const amtFormatted = Number(p.amount).toLocaleString(undefined, { maximumFractionDigits: 7 });
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(30);
  doc.setTextColor(20, 20, 20);
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
  doc.setTextColor(140, 140, 140);
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
      0: { fontStyle: 'bold', textColor: [80, 80, 80], cellWidth: 160 },
      1: { textColor: [20, 20, 20] },
    },
    alternateRowStyles: { fillColor: [249, 249, 249] },
    margin: { left: M, right: M },
  });

  const afterTable = (doc as any).lastAutoTable.finalY + 20;

  // Footer
  doc.setLineWidth(0.5);
  doc.setDrawColor(215, 215, 215);
  doc.line(M, afterTable, W - M, afterTable);
  doc.setFontSize(7.5);
  doc.setTextColor(165, 165, 165);
  doc.text(
    'This is an official payment record generated by Funti3rPay. Retain for tax, visa, or loan applications.',
    W / 2, afterTable + 14, { align: 'center', maxWidth: inner },
  );
  doc.text(`Generated ${new Date().toLocaleString()}`, W / 2, afterTable + 26, { align: 'center' });

  const dateStr = new Date(p.createdAt).toISOString().slice(0, 10);
  doc.save(`payslip-${p.currency}-${dateStr}-${p.id.slice(0, 8)}.pdf`);
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

export function exportAnalyticsPDF(summary: ExportSummary, recentPayments: ExportPayment[]) {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(20, 20, 20);
  doc.text('FUNTI3RPAY', 32, 32);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(80, 80, 80);
  doc.text('Analytics Report', pageW / 2, 32, { align: 'center' });
  doc.setFontSize(8.5);
  doc.setTextColor(140, 140, 140);
  doc.text(new Date().toLocaleDateString(), pageW - 32, 32, { align: 'right' });
  doc.setDrawColor(210, 210, 210);
  doc.setLineWidth(0.5);
  doc.line(32, 40, pageW - 32, 40);

  // Summary KPIs
  autoTable(doc, {
    startY: 56,
    head: [['Metric', 'Value']],
    body: [
      ['Total Payments', summary.totalCount],
      ['Completed', summary.byStatus['completed'] ?? 0],
      ['Failed', summary.byStatus['failed'] ?? 0],
      ['Success Rate', summary.successRate != null ? `${summary.successRate.toFixed(1)}%` : '—'],
      ['Total Volume (USD)', summary.completedVolumeUsd ?? '—'],
      ...Object.entries(summary.byCurrency ?? {}).map(([k, v]) => [`Volume ${k}`, v]),
    ],
    styles: { fontSize: 9 },
    headStyles: { fillColor: [245, 245, 245], textColor: [30, 30, 30], fontStyle: 'bold' },
    columnStyles: { 0: { fontStyle: 'bold', textColor: [60, 60, 60] } },
    alternateRowStyles: { fillColor: [250, 250, 250] },
    margin: { left: 32, right: 32 },
  });

  const afterSummary = (doc as any).lastAutoTable.finalY + 20;
  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(30, 30, 30);
  doc.text('Recent Payments', 32, afterSummary);

  autoTable(doc, {
    startY: afterSummary + 8,
    head: [PAYMENT_HEADERS],
    body: recentPayments.map(paymentRow).map((r) => r.map((v) => String(v))),
    styles: { fontSize: 8 },
    headStyles: { fillColor: [245, 245, 245], textColor: [30, 30, 30], fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [250, 250, 250] },
    margin: { left: 32, right: 32 },
  });

  const pageCount = (doc as any).internal.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(150);
    doc.text(
      `Page ${i} of ${pageCount} · Generated ${new Date().toLocaleString()}`,
      pageW / 2,
      doc.internal.pageSize.getHeight() - 12,
      { align: 'center' },
    );
  }

  doc.save(`funti3rpay-analytics-${timestamp()}.pdf`);
}
