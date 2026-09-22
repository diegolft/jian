'use client';

import { LoaderCircle } from 'lucide-react';
import type { ButtonHTMLAttributes } from 'react';

/** Busy both disables the button and shows why, so a slow action cannot be fired twice. */
export function Button({
  children,
  variant = 'primary',
  busy,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'quiet' | 'danger';
  busy?: boolean;
}) {
  return (
    <button
      type="button"
      {...props}
      disabled={props.disabled || busy}
      className={`button ${variant} ${props.className ?? ''}`}
    >
      {busy && <LoaderCircle size={16} className="spin" aria-hidden="true" />}
      {children}
    </button>
  );
}
