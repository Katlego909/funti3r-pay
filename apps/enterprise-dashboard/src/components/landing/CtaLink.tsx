import { Link } from 'react-router-dom';
import type { ReactNode } from 'react';

/** Marketing-only deploys (VITE_MARKETING_ONLY=true): auth CTAs point at the waitlist instead. */
export const MARKETING_ONLY = import.meta.env.VITE_MARKETING_ONLY === 'true';

/** Renders a router Link normally, or an anchor to the waitlist section on marketing-only builds. */
export function CtaLink({
  to,
  className,
  onClick,
  children,
}: {
  to: string;
  className?: string;
  onClick?: () => void;
  children: ReactNode;
}) {
  if (MARKETING_ONLY) {
    return (
      <a href="#waitlist" className={className} onClick={onClick}>
        {children}
      </a>
    );
  }
  return (
    <Link to={to} className={className} onClick={onClick}>
      {children}
    </Link>
  );
}
