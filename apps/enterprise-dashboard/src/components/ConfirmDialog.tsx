import Modal from './Modal.js';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  danger = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <Modal open={open} onClose={onCancel} title={title} maxWidth="400px">
      <p style={{ color: '#6b7280', fontSize: '0.9rem', marginTop: '-1rem', marginBottom: '1.5rem' }}>{message}</p>
      <div className="form-actions">
        <button type="button" className="btn-secondary" onClick={onCancel}>{cancelLabel}</button>
        <button
          type="button"
          className="btn-primary"
          onClick={onConfirm}
          style={danger ? { background: '#dc2626' } : undefined}
        >
          {confirmLabel}
        </button>
      </div>
    </Modal>
  );
}
