import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

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
  a.click();
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

  // Header bar
  doc.setFillColor(66, 10, 99); // --primary
  doc.rect(0, 0, pageW, 48, 'F');

  doc.setTextColor(255, 255, 255);
  doc.setFontSize(18);
  doc.setFont('helvetica', 'bold');
  doc.text('Funti3rPay', 32, 30);

  doc.setFontSize(11);
  doc.setFont('helvetica', 'normal');
  doc.text(title, pageW / 2, 30, { align: 'center' });

  doc.setFontSize(9);
  doc.text(subtitle, pageW - 32, 30, { align: 'right' });

  autoTable(doc, {
    startY: 64,
    head: [headers],
    body: rows.map((r) => r.map((v) => (v == null ? '' : String(v)))),
    styles: { fontSize: 8.5, cellPadding: 5 },
    headStyles: { fillColor: [66, 10, 99], textColor: 255, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [248, 245, 252] },
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
  exportCSV(PAYMENT_HEADERS, payments.map(paymentRow), `funti3rpay-payments${suffix}.csv`);
}
export function exportPaymentsPDF(payments: ExportPayment[], suffix = '') {
  exportPDF(
    'Payment Report',
    new Date().toLocaleDateString(),
    PAYMENT_HEADERS,
    payments.map(paymentRow),
    `funti3rpay-payments${suffix}.pdf`,
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
  exportCSV(WORKER_HEADERS, workers.map(workerRow), 'funti3rpay-workers.csv');
}
export function exportWorkersPDF(workers: ExportWorker[]) {
  exportPDF('Worker Report', new Date().toLocaleDateString(), WORKER_HEADERS, workers.map(workerRow), 'funti3rpay-workers.pdf');
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
  exportCSV([], all, 'funti3rpay-analytics.csv');
}

export function exportAnalyticsPDF(summary: ExportSummary, recentPayments: ExportPayment[]) {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();

  doc.setFillColor(66, 10, 99);
  doc.rect(0, 0, pageW, 48, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(18);
  doc.setFont('helvetica', 'bold');
  doc.text('Funti3rPay', 32, 30);
  doc.setFontSize(11);
  doc.setFont('helvetica', 'normal');
  doc.text('Analytics Report', pageW / 2, 30, { align: 'center' });
  doc.setFontSize(9);
  doc.text(new Date().toLocaleDateString(), pageW - 32, 30, { align: 'right' });

  // Summary KPIs
  autoTable(doc, {
    startY: 64,
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
    headStyles: { fillColor: [66, 10, 99], textColor: 255, fontStyle: 'bold' },
    columnStyles: { 0: { fontStyle: 'bold' } },
    margin: { left: 32, right: 32 },
  });

  const afterSummary = (doc as any).lastAutoTable.finalY + 20;
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(40, 40, 40);
  doc.text('Recent Payments', 32, afterSummary);

  autoTable(doc, {
    startY: afterSummary + 8,
    head: [PAYMENT_HEADERS],
    body: recentPayments.map(paymentRow).map((r) => r.map((v) => String(v))),
    styles: { fontSize: 8 },
    headStyles: { fillColor: [66, 10, 99], textColor: 255, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [248, 245, 252] },
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

  doc.save('funti3rpay-analytics.pdf');
}
