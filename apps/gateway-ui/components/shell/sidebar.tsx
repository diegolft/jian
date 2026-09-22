'use client';

import { LogOut } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { currentSection, groupLabels, navigation } from '../../lib/navigation';
import { useWorkspace } from '../../lib/workspace';
import { Mark } from '../ui';
import { ProfileSwitcher } from './profile-switcher';

export function Sidebar({
  open,
  onNavigate,
  onCreateProfile,
}: {
  open: boolean;
  onNavigate: () => void;
  onCreateProfile: () => void;
}) {
  const pathname = usePathname();
  const active = currentSection(pathname);
  const { data, signOut } = useWorkspace();

  return (
    <aside className={`sidebar ${open ? 'open' : ''}`}>
      <Link className="brand" href="/">
        <Mark />
        <span>
          jian<span className="brand-label">GATEWAY</span>
        </span>
      </Link>
      <ProfileSwitcher onCreate={onCreateProfile} />
      <nav aria-label="Navegação principal">
        {(['workspace', 'capabilities'] as const).map((group) => (
          <div className="nav-group" key={group}>
            <span className="nav-label">{groupLabels[group]}</span>
            {navigation
              .filter((item) => item.group === group)
              .map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={active?.href === item.href ? 'active' : ''}
                  aria-current={active?.href === item.href ? 'page' : undefined}
                  onClick={onNavigate}
                >
                  <item.icon size={18} strokeWidth={1.7} />
                  <span>{item.label}</span>
                  {item.href === '/channels' && data && (
                    <small>{data.channels.filter((channel) => !channel.revokedAt).length}</small>
                  )}
                </Link>
              ))}
          </div>
        ))}
      </nav>
      <div className="sidebar-footer">
        <div>
          <span className="live-dot" />
          <span>Gateway conectado</span>
          <code>v0.1</code>
        </div>
        <button type="button" onClick={() => void signOut()}>
          <LogOut size={16} />
          Sair do painel
        </button>
      </div>
    </aside>
  );
}
