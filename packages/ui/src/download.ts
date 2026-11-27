/** Hands the browser a file to save. */
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

function escapeCell(v: unknown): string {
  const s = v == null ? '' : String(v);
  return s.includes(',') || s.includes('"') || s.includes('\n')
    ? `"${s.replace(/"/g, '""')}"`
    : s;
}

export function exportJSON(value: unknown, filename: string) {
  downloadBlob(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }), filename);
}

export function exportCSV(headers: string[], rows: unknown[][], filename: string) {
  const lines = [headers, ...rows].map((r) => r.map(escapeCell).join(',')).join('\r\n');
  downloadBlob(new Blob([lines], { type: 'text/csv;charset=utf-8;' }), filename);
}
