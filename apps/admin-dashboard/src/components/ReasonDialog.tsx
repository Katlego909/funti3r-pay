import { FormEvent, useEffect, useState } from 'react';
import { Modal } from '@funti3r/ui';
import { apiErrorMessage } from '@funti3r/web-core';
import { toast } from 'sonner';

export interface ReasonAction {
  title: string;
  /** What will happen, in plain words, shown above the reason box. */
  message: string;
  confirmLabel: string;
  danger?: boolean;
  /** Runs with the reason; its resolved text is shown as the success toast. */
  run: (reason: string) => Promise<string>;
}

/**
 * Every admin action that changes something asks for a reason first: it is required by the API and kept in the audit
 * trail with the admin's id. The dialog stays open with the error if the action fails.
 */
export default function ReasonDialog({ action, onClose, onDone }: {
  action: ReasonAction | null; onClose: () => void; onDone: () => void;
}) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { setReason(''); setError(null); setBusy(false); }, [action]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!action || !reason.trim()) return;
    setBusy(true);
    setError(null);
    try {
      toast.success(await action.run(reason.trim()));
      onDone();
      onClose();
    } catch (err) {
      setError(apiErrorMessage(err, 'That did not work'));
      setBusy(false);
    }
  }

  return (
    <Modal open={!!action} onClose={busy ? () => undefined : onClose} title={action?.title} maxWidth="480px">
      <form onSubmit={submit}>
        <p className="admin-dialog-message">{action?.message}</p>
        <label className="admin-label">
          Reason (kept in the audit trail)
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            maxLength={500}
            autoFocus
            placeholder="e.g. Support ticket #142: worker reports a payout they did not receive"
          />
        </label>
        {error && <div className="error-banner">{error}</div>}
        <div className="form-actions">
          <button type="button" className="btn-secondary" onClick={onClose} disabled={busy}>Cancel</button>
          <button
            type="submit"
            className="btn-primary"
            disabled={busy || !reason.trim()}
            style={action?.danger ? { background: '#dc2626' } : undefined}
          >
            {busy ? 'Working…' : action?.confirmLabel}
          </button>
        </div>
      </form>
    </Modal>
  );
}
