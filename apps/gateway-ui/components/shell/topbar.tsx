'use client';

import { Menu, RefreshCw } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { currentSection } from '../../lib/navigation';
import { useWorkspace } from '../../lib/workspace';
import { Button } from '../ui';

export function Topbar({ onOpenNavigation }: { onOpenNavigation: () => void }) {
  const pathname = usePathname();
  const { loading, busy, refresh, setNotice } = useWorkspace();

  return (
    <header className="topbar">
      <div>
        <button
          type="button"
          className="icon-button mobile-menu"
          aria-label="Abrir navegação"
          onClick={onOpenNavigation}
        >
          <Menu size={20} />
        </button>
        <span className="muted">Workspace</span>
        <span className="breadcrumb-slash">/</span>
        <strong>{currentSection(pathname)?.label}</strong>
      </div>
      <div>
        <span className="server-address">
          {typeof window !== 'undefined' ? window.location.host : ''}
        </span>
        <Button
          variant="quiet"
          aria-label="Atualizar dados"
          busy={loading}
          disabled={busy}
          onClick={() => {
            setNotice(undefined);
            void refresh();
          }}
        >
          {!loading && <RefreshCw size={16} />}
        </Button>
        <span className="admin-avatar" title="Administrador">
          A
        </span>
      </div>
    </header>
  );
}
