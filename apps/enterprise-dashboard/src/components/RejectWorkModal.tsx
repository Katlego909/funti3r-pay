import { FormEvent, useState } from 'react';
import { toast } from 'sonner';
import Modal from './Modal.js';
import { rejectMilestone } from '../api/escrows.js';

interface Props {
  target: { escrowId: string; idx: number; title: string } | null;
  onClose: () => void;
  onDone: () => void;
}

/** Employer sends submitted work back with a reason; nothing happens on-chain. */
export default function RejectWorkModal({ target, onClose, onDone }: Props) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  function close() {
    setReason('');
    onClose();
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!target) return;
    setBusy(true);
    try {
      await rejectMilestone(target.escrowId, target.idx, reason);
      toast.success('Sent back to the worker');
      close();
      onDone();
    } catch (err: any) {
      toast.error(err?.response?.data?.error ?? 'Failed to send the work back');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={!!target} onClose={close} title="Request changes" closeButton maxWidth="500px">
      <form onSubmit={handleSubmit} className="payment-form">
        {target && (
          <p style={{ fontSize: '0.85rem', color: '#6b7280', marginTop: 0 }}>
            <strong>{target.title}</strong> goes back to the worker, who can fix it and submit again.
            No funds move and nothing is recorded on-chain.
          </p>
        )}
        <label>What needs to change?
          <textarea
            style={{
              width: '100%', minHeight: 110, padding: '10px 12px', border: '1px solid #e5e7eb',
              borderRadius: 8, font: 'inherit', resize: 'vertical', boxSizing: 'border-box',
            }}
            maxLength={1000}
            required
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Be specific so the worker can act on it."
          />
        </label>
        <div className="form-actions">
          <button type="button" className="btn-secondary" onClick={close}>Cancel</button>
          <button type="submit" className="btn-primary" disabled={busy || !reason.trim()}>
            {busy ? 'Sending…' : 'Send back'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
