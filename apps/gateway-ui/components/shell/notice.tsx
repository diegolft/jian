'use client';

import { X } from 'lucide-react';
import { useWorkspace } from '../../lib/workspace';

/** The one place a result is announced, so no screen invents its own banner. */
export function NoticeBar() {
  const { notice, setNotice } = useWorkspace();

  if (!notice) {
    return null;
  }

  return (
    <div
      className={`notice toast ${notice.error ? 'error' : 'success'}`}
      role={notice.error ? 'alert' : 'status'}
    >
      <span>{notice.text}</span>
      <button
        type="button"
        className="icon-button"
        aria-label="Fechar aviso"
        onClick={() => setNotice(undefined)}
      >
        <X size={16} />
      </button>
    </div>
  );
}
