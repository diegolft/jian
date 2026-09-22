'use client';

import { LoaderCircle, Plus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { type ReactNode, useEffect, useState } from 'react';
import { NewProfileDialog } from '../../components/profile/editor';
import { NoticeBar } from '../../components/shell/notice';
import { Sidebar } from '../../components/shell/sidebar';
import { Topbar } from '../../components/shell/topbar';
import { Badge, Button, Empty } from '../../components/ui';
import { gatewayApi, type Profile } from '../../lib/api';
import { useWorkspace, WorkspaceProvider } from '../../lib/workspace';

/** The chrome every section shares, and the one place the session is checked. */
export default function WorkspaceLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [profiles, setProfiles] = useState<Profile[]>();
  const [checking, setChecking] = useState(true);

  // A signed cookie from an earlier visit is enough to walk straight back in.
  useEffect(() => {
    gatewayApi()
      .profiles()
      .then(setProfiles)
      .catch(() => undefined)
      .finally(() => setChecking(false));
  }, []);

  useEffect(() => {
    if (!checking && !profiles) {
      router.replace('/sign-in');
    }
  }, [checking, profiles, router]);

  if (!profiles) {
    return (
      <main className="boot" aria-busy="true">
        <LoaderCircle size={22} className="spin" aria-label="Verificando a sessão" />
      </main>
    );
  }

  return (
    <WorkspaceProvider initialProfiles={profiles} onSignOut={() => router.replace('/sign-in')}>
      <Shell>{children}</Shell>
    </WorkspaceProvider>
  );
}

function Shell({ children }: { children: ReactNode }) {
  const { profiles, profile, data, loading, refresh, adopt } = useWorkspace();
  const [mobile, setMobile] = useState(false);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!mobile) {
      return;
    }

    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMobile(false);
      }
    };

    window.addEventListener('keydown', close);

    return () => window.removeEventListener('keydown', close);
  }, [mobile]);

  return (
    <div className="app-shell">
      {mobile && (
        <button
          className="sidebar-backdrop"
          type="button"
          aria-label="Fechar navegação"
          onClick={() => setMobile(false)}
        />
      )}
      <Sidebar
        open={mobile}
        onNavigate={() => setMobile(false)}
        onCreateProfile={() => setCreating(true)}
      />
      <div className="workspace" inert={mobile}>
        <Topbar onOpenNavigation={() => setMobile(true)} />
        <main id="main-content" className="main-content">
          <div className="page-meta">
            <span className="profile-context">{profile?.name ?? 'Seu Gateway'}</span>
            <Badge>Administrador</Badge>
          </div>
          <NoticeBar />
          {!profiles.length ? (
            <Empty
              title="Dê vida ao seu primeiro agente"
              action={
                <Button onClick={() => setCreating(true)}>
                  <Plus size={16} />
                  Criar perfil
                </Button>
              }
            >
              Comece com um nome e instruções. Depois conecte seus providers.
            </Empty>
          ) : profile && data ? (
            <div key={profile.id} className="page-enter">
              {children}
            </div>
          ) : (
            <div className="loading-state" role="status">
              {loading ? (
                <>
                  <LoaderCircle className="spin" size={24} />
                  Carregando seu espaço…
                </>
              ) : (
                <Button variant="secondary" onClick={() => void refresh()}>
                  Tentar carregar novamente
                </Button>
              )}
            </div>
          )}
        </main>
      </div>
      {creating && (
        <NewProfileDialog
          api={gatewayApi()}
          close={() => setCreating(false)}
          done={(created) => {
            adopt(created);
            setCreating(false);
          }}
        />
      )}
    </div>
  );
}
