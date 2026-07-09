import { FormEvent, ReactNode, useState } from 'react';
import { HiCheck, HiOutlineClipboard } from 'react-icons/hi2';
import { toast } from 'sonner';
import Modal from './Modal.js';
import CopyButton from './CopyButton.js';

interface InviteLinkModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  /** Sentence above the email field. */
  description: string;
  emailLabel: string;
  emailPlaceholder: string;
  /** Extra form fields between email and the actions (e.g. a role select). */
  extraFields?: ReactNode;
  /** Create the invite for this email and resolve with the shareable link. */
  onSubmit: (email: string) => Promise<string>;
  /** Toast shown when onSubmit rejects without a server error message. */
  errorFallback?: string;
}

/** Shared invite flow: email form → generated link with copy → invite another / done. */
export default function InviteLinkModal({
  open, onClose, title, description, emailLabel, emailPlaceholder, extraFields, onSubmit,
  errorFallback = 'Failed to create invite',
}: InviteLinkModalProps) {
  const [email, setEmail] = useState('');
  const [link, setLink] = useState('');
  const [sending, setSending] = useState(false);

  function reset() {
    setEmail('');
    setLink('');
  }

  function close() {
    reset();
    onClose();
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSending(true);
    setLink('');
    try {
      setLink(await onSubmit(email));
    } catch (err: any) {
      toast.error(err?.response?.data?.error ?? errorFallback);
    } finally {
      setSending(false);
    }
  }

  return (
    <Modal open={open} onClose={close} title={title} closeButton maxWidth="420px">
      {!link ? (
        <form onSubmit={handleSubmit} className="payment-form">
          <p style={{ fontSize: '0.85rem', color: '#6b7280', marginTop: 0 }}>{description}</p>
          <label>{emailLabel}
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={emailPlaceholder}
              required
            />
          </label>
          {extraFields}
          <div className="form-actions">
            <button type="button" className="btn-secondary" onClick={close}>Cancel</button>
            <button type="submit" className="btn-primary" disabled={sending}>
              {sending ? 'Generating…' : 'Generate invite link'}
            </button>
          </div>
        </form>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <p style={{ fontSize: '0.85rem', color: '#065f46', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '8px', padding: '10px 12px', margin: 0 }}>
            Invite link generated for <strong>{email}</strong>. Send it to them — it expires in 7 days.
          </p>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <input
              readOnly
              value={link}
              style={{ flex: 1, fontSize: '0.78rem', padding: '8px', border: '1px solid #e5e7eb', borderRadius: '8px', background: '#f9fafb', fontFamily: 'monospace' }}
              onClick={(e) => (e.target as HTMLInputElement).select()}
            />
            <CopyButton
              text={link}
              className="btn-secondary"
              style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: '4px' }}
              label={<><HiOutlineClipboard size={14} /> Copy</>}
              copiedLabel={<><HiCheck size={14} /> Copied</>}
            />
          </div>
          <div className="form-actions">
            <button className="btn-secondary" onClick={reset}>Invite another</button>
            <button className="btn-primary" onClick={close}>Done</button>
          </div>
        </div>
      )}
    </Modal>
  );
}
