import { CSSProperties, ReactNode, useState } from 'react';
import { HiCheck, HiOutlineClipboard } from 'react-icons/hi2';

interface CopyButtonProps {
  text: string;
  /** Custom idle/copied content; defaults to bare clipboard/check icons. */
  label?: ReactNode;
  copiedLabel?: ReactNode;
  size?: number;
  title?: string;
  /** e.g. 'btn-secondary' for a labeled button; omit for the bare icon look. */
  className?: string;
  style?: CSSProperties;
}

/** Copy-to-clipboard button that owns its "copied" feedback state (2s reset). */
export default function CopyButton({ text, label, copiedLabel, size = 14, title = 'Copy', className, style }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    navigator.clipboard?.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const bareIcon = !className;
  return (
    <button
      type="button"
      onClick={handleCopy}
      title={title}
      className={className}
      style={bareIcon
        ? { background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'inline-flex', alignItems: 'center', color: copied ? 'var(--success, #059669)' : '#6b7280', ...style }
        : style}
    >
      {copied ? (copiedLabel ?? <HiCheck size={size} />) : (label ?? <HiOutlineClipboard size={size} />)}
    </button>
  );
}
