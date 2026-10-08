import { FormEvent, useState } from 'react';
import { toast } from 'sonner';
import Modal from './Modal.js';
import { submitMilestoneWork } from '../api/escrows.js';

const FIELD_STYLE = {
  width: '100%', padding: '10px 12px', border: '1px solid #e5e7eb', borderRadius: 8,
  font: 'inherit', resize: 'vertical' as const, boxSizing: 'border-box' as const,
};

interface Props {
  target: { escrowId: string; idx: number; title: string; previousReason?: string } | null;
  onClose: () => void;
  onDone: () => void;
}

/** Worker hands a milestone in for review: a note and/or links to the work. */
export default function SubmitWorkModal({ target, onClose, onDone }: Props) {
  const [note, setNote] = useState('');
  const [links, setLinks] = useState('');
  const [busy, setBusy] = useState(false);

  function close() {
    setNote('');
    setLinks('');
    onClose();
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!target) return;
    setBusy(true);
    try {
      await submitMilestoneWork(target.escrowId, target.idx, {
        note,
        links: links.split('\n').map((l) => l.trim()).filter(Boolean),
      });
      toast.success('Submitted — your employer has been notified');
      close();
      onDone();
    } catch (err: any) {
      toast.error(err?.response?.data?.error ?? 'Failed to submit work');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={!!target} onClose={close} title="Submit work for review" closeButton maxWidth="540px">
      <form onSubmit={handleSubmit} className="payment-form">
        {target && (
          <p style={{ fontSize: '0.85rem', color: '#6b7280', marginTop: 0 }}>
            <strong>{target.title}</strong> — your employer reviews this, then approves the milestone so you can claim it.
          </p>
        )}
        {target?.previousReason && (
          <div className="error-banner" style={{ fontSize: '0.82rem' }}>
            Changes requested: {target.previousReason}
          </div>
        )}
        <label>What did you complete?
          <textarea
            style={{ ...FIELD_STYLE, minHeight: 100 }}
            maxLength={2000}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Describe the work, what changed since the last version, how to check it…"
          />
        </label>
        <label>Links to the work (one per line, optional)
          <textarea
            style={{ ...FIELD_STYLE, minHeight: 70, fontFamily: 'monospace', fontSize: '0.82rem' }}
            value={links}
            onChange={(e) => setLinks(e.target.value)}
            placeholder={'https://figma.com/file/…\nhttps://github.com/…/pull/12'}
          />
        </label>
        <div className="form-actions">
          <button type="button" className="btn-secondary" onClick={close}>Cancel</button>
          <button type="submit" className="btn-primary" disabled={busy || (!note.trim() && !links.trim())}>
            {busy ? 'Submitting…' : 'Submit for review'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
