'use client';

import {
  Activity,
  ArrowRight,
  BookOpen,
  Check,
  ChevronDown,
  CircleHelp,
  Cpu,
  Fingerprint,
  LayoutDashboard,
  LoaderCircle,
  LockKeyhole,
  LogOut,
  Menu,
  MessageSquare,
  Plug,
  Plus,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  Sparkles,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  date,
  type GatewayApi,
  gatewayApi,
  type Profile,
  type ProfileData,
  type ProviderModelList,
} from '../lib/api';
import { Avatar } from './avatar-field';
import { Channels } from './channels';
import { NewProfileDialog, ProfileEditor } from './profile-editor';
import { ModelDefaults, Providers } from './provider-settings';
import { Capabilities, Memories } from './resources';
import { Sessions } from './sessions';
import { Badge, Button, Empty, Field, Mark, SectionHeading } from './ui';

const navigation = [
  { id: 'overview', label: 'Visão geral', icon: LayoutDashboard, group: 'workspace' },
  { id: 'profile', label: 'Identidade', icon: Fingerprint, group: 'workspace' },
  { id: 'providers', label: 'Providers', icon: Plug, group: 'workspace' },
  { id: 'defaults', label: 'Modelos padrão', icon: Cpu, group: 'workspace' },
  { id: 'channels', label: 'Canais', icon: Smartphone, group: 'workspace' },
  { id: 'sessions', label: 'Conversas', icon: MessageSquare, group: 'workspace' },
  { id: 'memories', label: 'Memórias', icon: BookOpen, group: 'capabilities' },
  { id: 'skills', label: 'Skills', icon: Sparkles, group: 'capabilities' },
  { id: 'mcps', label: 'Servidores MCP', icon: Plug, group: 'capabilities' },
] as const;

type Section = (typeof navigation)[number]['id'];

function Login({ connected }: { connected: (profiles: Profile[]) => void }) {
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');

  // The static login must not submit a secret before React has attached its handler.
  useEffect(() => setReady(true), []);

  return (
    <main className="login-layout">
      <section className="login-story">
        <a className="brand" href="/ui/">
          <Mark />
          <span>
            jian<span className="brand-label">GATEWAY</span>
          </span>
        </a>
        <div className="login-copy">
          <span className="eyebrow">SEU AGENTE. EM TODA CONVERSA.</span>
          <h1>
            Muitas conversas.
            <br />
            Uma identidade.
          </h1>
          <p>
            Um lugar para conectar seus agentes, dar contexto às conversas e manter você no
            controle.
          </p>
          <div className="identity-orbit" aria-hidden="true">
            <span className="orbit-node node-one">
              <MessageSquare />
            </span>
            <span className="orbit-node node-two">
              <Smartphone />
            </span>
            <span className="orbit-center">
              <Mark />
            </span>
            <span className="orbit-node node-three">
              <BookOpen />
            </span>
          </div>
        </div>
        <small>Aberto por natureza. Seu por completo.</small>
      </section>
      <section className="login-form-wrap">
        <form
          method="post"
          action="/ui/"
          className="login-form"
          onSubmit={async (event) => {
            event.preventDefault();
            setBusy(true);
            setError('');

            const token = String(new FormData(event.currentTarget).get('token')).trim();
            const api = gatewayApi();

            try {
              await api.signIn(token);
              connected(await api.profiles());
            } catch (error) {
              setError(
                error instanceof Error ? error.message : 'Não foi possível conectar ao Gateway.',
              );
            } finally {
              setBusy(false);
            }
          }}
        >
          <div className="login-lock">
            <LockKeyhole size={24} />
          </div>
          <h2>Seu Gateway começa aqui.</h2>
          <p>Entre com o token de administrador desta instância.</p>
          <Field label="Token de administrador">
            <input
              name="token"
              type="password"
              placeholder="Cole seu token de acesso"
              autoComplete="off"
              required
              minLength={32}
              spellCheck={false}
            />
          </Field>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <Button type="submit" busy={busy} disabled={!ready}>
            Entrar no Gateway
            <ArrowRight size={17} />
          </Button>
          <p className="secure-note">
            <ShieldCheck size={16} />O token não fica no navegador: a sessão vira um cookie
            assinado, ilegível por scripts, que expira em 30 dias.
          </p>
          <details className="login-help">
            <summary>
              <CircleHelp size={15} />
              Onde encontro meu token?
            </summary>
            <p>
              Use o valor de <code>JIAN_API_TOKEN</code> definido na configuração do servidor. É o
              único token que o Gateway aceita.
            </p>
          </details>
        </form>
      </section>
    </main>
  );
}

function Overview({
  profile,
  data,
  go,
}: {
  profile: Profile;
  data: ProfileData;
  go: (section: Section) => void;
}) {
  const connected = data.channels.filter((item) => !item.revokedAt);

  const providerReady = data.providers.some((item) => !item.revokedAt) || !!profile.model.apiKeyEnv;

  const steps = [
    {
      label: 'Definir identidade',
      description: 'Propósito e instruções do seu agente.',
      done: true,
      section: 'profile' as const,
    },
    {
      label: 'Conectar inteligência',
      description: 'Adicione os providers que processam as conversas.',
      done: providerReady,
      section: 'providers' as const,
    },
    {
      label: 'Criar uma conversa',
      description: 'Uma sessão para testar ou vincular a um canal.',
      done: data.sessions.length > 0,
      section: 'sessions' as const,
    },
    {
      label: 'Abrir um canal',
      description: 'WhatsApp, Telegram ou seu próprio webhook.',
      done: connected.length > 0,
      section: 'channels' as const,
    },
  ];

  const complete = steps.filter((step) => step.done).length;

  return (
    <>
      <SectionHeading
        title={`Seu espaço, ${profile.name}.`}
        description="Uma visão do seu agente e dos lugares onde ele atua."
        action={
          <Button variant="secondary" onClick={() => go('sessions')}>
            <MessageSquare size={16} />
            Abrir conversas
          </Button>
        }
      />
      <section className="profile-summary">
        <Avatar name={profile.name} avatar={profile.avatar} className="profile-avatar" />
        <div className="grow">
          <div className="eyebrow">PERFIL ATIVO</div>
          <h2>{profile.name}</h2>
          <p>{profile.instructions.slice(0, 130)}</p>
          <div className="tag-list">
            <span>{data.providers.filter((item) => !item.revokedAt).length} providers</span>
            <span>{data.sessions.length} conversas</span>
          </div>
        </div>
        <button className="text-button" type="button" onClick={() => go('profile')}>
          Configurar perfil
          <ArrowRight size={16} />
        </button>
      </section>
      <div className="metric-strip">
        {[
          { label: 'Conversas', value: data.sessions.length, icon: MessageSquare },
          { label: 'Canais configurados', value: connected.length, icon: Smartphone },
          { label: 'Memórias', value: data.memories.length, icon: BookOpen },
          {
            label: 'Execuções ativas',
            value: data.activities.filter((run) => ['running', 'queued'].includes(run.status))
              .length,
            icon: Activity,
          },
        ].map((item) => (
          <div key={item.label}>
            <item.icon size={18} />
            <strong>{item.value}</strong>
            <span>{item.label}</span>
          </div>
        ))}
      </div>
      <div className="overview-columns">
        <section className="setup-panel">
          <header>
            <div>
              <span className="eyebrow">PRÓXIMOS PASSOS</span>
              <h2>{complete === steps.length ? 'Pronto para conversar' : 'Prepare seu espaço'}</h2>
            </div>
            <span className="step-count">
              {complete}/{steps.length}
            </span>
          </header>
          <div className="progress-track">
            <span style={{ width: `${(complete / steps.length) * 100}%` }} />
          </div>
          {steps.map((step, index) => (
            <button
              type="button"
              className="setup-step"
              key={step.label}
              onClick={() => go(step.section)}
            >
              <span className={`step-number ${step.done ? 'done' : ''}`}>
                {step.done ? <Check size={15} /> : index + 1}
              </span>
              <span className="grow">
                <strong>{step.label}</strong>
                <small>{step.description}</small>
              </span>
              <ArrowRight size={16} />
            </button>
          ))}
        </section>
        <section className="context-panel">
          <div className="eyebrow">CONTEXTO COM PROPÓSITO</div>
          <BookOpen size={29} strokeWidth={1.4} />
          <h2>
            O que importa
            <br />
            continua com ele.
          </h2>
          <p>
            Memórias relevantes entram na conversa quando fazem sentido. O contexto se adapta ao
            modelo usado em cada execução.
          </p>
          <button type="button" className="text-button" onClick={() => go('defaults')}>
            Definir modelos padrão
            <ArrowRight size={16} />
          </button>
        </section>
      </div>
      <section className="subsection">
        <header className="section-row">
          <h2>Execuções em andamento</h2>
          <button type="button" className="text-button" onClick={() => go('sessions')}>
            Ver conversas
            <ArrowRight size={15} />
          </button>
        </header>
        {data.activities.length ? (
          <div className="resource-list">
            {data.activities
              .slice(-5)
              .reverse()
              .map((run) => (
                <div className="resource-row" key={run.id}>
                  <div className="resource-icon">
                    <MessageSquare size={18} />
                  </div>
                  <div className="grow">
                    <h3>
                      {data.sessions.find((session) => session.id === run.sessionId)?.title ??
                        'Conversa'}
                    </h3>
                    <p className="truncate">{run.input}</p>
                  </div>
                  <span className="muted small">{date(run.updatedAt)}</span>
                  <Badge
                    tone={
                      run.status === 'completed'
                        ? 'good'
                        : run.status === 'failed'
                          ? 'bad'
                          : 'neutral'
                    }
                  >
                    {
                      {
                        queued: 'Na fila',
                        running: 'Em execução',
                        completed: 'Concluída',
                        failed: 'Falhou',
                        interrupted: 'Interrompida',
                        cancelled: 'Cancelada',
                      }[run.status]
                    }
                  </Badge>
                </div>
              ))}
          </div>
        ) : (
          <div className="activity-empty">
            <Activity size={20} />
            <p>Nenhuma execução em andamento.</p>
            <span>Pronto quando você estiver.</span>
          </div>
        )}
      </section>
    </>
  );
}

async function profileData(api: GatewayApi, id: string): Promise<ProfileData> {
  const [sessions, channels, memories, activities, deliveries, providers, modelDefaults] =
    await Promise.all([
      api.sessions(id),
      api.channels(id),
      api.memories(id),
      api.activities(id),
      api.deliveries(id),
      api.providers(id),
      api.modelDefaults(id),
    ]);

  // One request per live provider, and only on a refresh: the gateway caches the answer, so
  // rendering the panel never costs a call to the provider.
  const lists = await Promise.all(
    providers
      .filter((provider) => !provider.revokedAt)
      .map(async (provider) =>
        api.providerModels(id, provider.id).catch(
          (error): ProviderModelList => ({
            providerId: provider.id,
            models: [],
            fetchedAt: new Date().toISOString(),
            stale: true,
            reason: error instanceof Error ? error.message : 'Lista indisponível.',
          }),
        ),
      ),
  );

  return {
    sessions,
    channels,
    memories,
    activities,
    deliveries,
    providers,
    providerModels: Object.fromEntries(lists.map((list) => [list.providerId, list])),
    modelDefaults,
  };
}

function Workspace({
  initialProfiles,
  logout,
}: {
  initialProfiles: Profile[];
  logout: () => void;
}) {
  const api = useMemo(() => gatewayApi(), []);
  const [profiles, setProfiles] = useState(initialProfiles);
  const [selected, setSelected] = useState(initialProfiles[0]?.id ?? '');
  const [data, setData] = useState<{ profileId: string; value: ProfileData }>();
  const [section, setSection] = useState<Section>('overview');
  const [newProfile, setNewProfile] = useState(false);
  const [mobile, setMobile] = useState(false);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ text: string; error: boolean }>();
  const generation = useRef(0);
  const profile = profiles.find((item) => item.id === selected);

  const refresh = useCallback(async () => {
    const current = ++generation.current;

    setLoading(true);

    try {
      const [updated, details] = await Promise.all([
        api.profiles(),
        selected ? profileData(api, selected) : undefined,
      ]);

      if (current !== generation.current) {
        return;
      }

      setProfiles(updated);

      if (details) {
        setData({ profileId: selected, value: details });
      }
    } catch (error) {
      if (current === generation.current) {
        setNotice({
          text: error instanceof Error ? error.message : 'Não foi possível atualizar os dados.',
          error: true,
        });
      }
    } finally {
      if (current === generation.current) {
        setLoading(false);
      }
    }
  }, [api, selected]);

  useEffect(() => {
    void refresh();

    return () => {
      generation.current++;
    };
  }, [refresh]);

  useEffect(() => {
    const update = () => {
      const id = location.hash.slice(1);

      if (navigation.some((item) => item.id === id)) {
        setSection(id as Section);
      }
    };

    update();
    window.addEventListener('hashchange', update);

    return () => window.removeEventListener('hashchange', update);
  }, []);

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

  const go = (next: Section) => {
    setSection(next);
    location.hash = next;
    setMobile(false);
    setNotice(undefined);
  };

  const mutate = async (action: () => Promise<unknown>, message = 'Alterações salvas.') => {
    setBusy(true);
    setNotice(undefined);

    try {
      await action();
      setNotice({ text: message, error: false });
      await refresh();

      return true;
    } catch (error) {
      setNotice({
        text: error instanceof Error ? error.message : 'Não foi possível concluir a ação.',
        error: true,
      });

      return false;
    } finally {
      setBusy(false);
    }
  };

  const ready = profile && data?.profileId === profile.id;
  const props = ready ? { profile, data: data.value, api, mutate, busy } : undefined;

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
      <aside className={`sidebar ${mobile ? 'open' : ''}`}>
        <a className="brand" href="#overview">
          <Mark />
          <span>
            jian<span className="brand-label">GATEWAY</span>
          </span>
        </a>
        <div className="profile-selector">
          <label htmlFor="profile-picker">SEU ESPAÇO</label>
          <div>
            <Avatar name={profile?.name} avatar={profile?.avatar} className="mini-avatar" />
            <select
              id="profile-picker"
              value={selected}
              disabled={busy}
              onChange={(event) => {
                setSelected(event.target.value);
                setNotice(undefined);
              }}
              aria-label="Perfil ativo"
            >
              {profiles.length ? (
                profiles.map((item) => (
                  <option value={item.id} key={item.id}>
                    {item.name}
                  </option>
                ))
              ) : (
                <option value="">Nenhum perfil</option>
              )}
            </select>
            <ChevronDown size={14} />
          </div>
          <button type="button" className="new-profile" onClick={() => setNewProfile(true)}>
            <Plus size={14} />
            Novo perfil
          </button>
        </div>
        <nav aria-label="Navegação principal">
          {(['workspace', 'capabilities'] as const).map((group) => (
            <div className="nav-group" key={group}>
              <span className="nav-label">
                {{ workspace: 'WORKSPACE', capabilities: 'CAPACIDADES' }[group]}
              </span>
              {navigation
                .filter((item) => item.group === group)
                .map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={section === item.id ? 'active' : ''}
                    onClick={() => go(item.id)}
                    aria-current={section === item.id ? 'page' : undefined}
                  >
                    <item.icon size={18} strokeWidth={1.7} />
                    <span>{item.label}</span>
                    {item.id === 'channels' && ready && (
                      <small>
                        {data.value.channels.filter((channel) => !channel.revokedAt).length}
                      </small>
                    )}
                  </button>
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
          <button type="button" onClick={logout}>
            <LogOut size={16} />
            Sair do painel
          </button>
        </div>
      </aside>
      <div className="workspace" inert={mobile}>
        <header className="topbar">
          <div>
            <button
              type="button"
              className="icon-button mobile-menu"
              aria-label="Abrir navegação"
              onClick={() => setMobile(true)}
            >
              <Menu size={20} />
            </button>
            <span className="muted">Workspace</span>
            <span className="breadcrumb-slash">/</span>
            <strong>{navigation.find((item) => item.id === section)?.label}</strong>
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
        <main id="main-content" className="main-content">
          <div className="page-meta">
            <span className="profile-context">{profile?.name ?? 'Seu Gateway'}</span>
            <Badge>Administrador</Badge>
          </div>
          {notice && (
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
          )}
          {!profiles.length ? (
            <Empty
              title="Dê vida ao seu primeiro agente"
              action={
                <Button onClick={() => setNewProfile(true)}>
                  <Plus size={16} />
                  Criar perfil
                </Button>
              }
            >
              Comece com um nome e instruções. Depois conecte seus providers.
            </Empty>
          ) : props ? (
            <div key={props.profile.id} className="page-enter">
              {section === 'overview' && <Overview {...props} go={go} />}
              {section === 'profile' && (
                <ProfileEditor key={`${props.profile.id}:${props.profile.version}`} {...props} />
              )}
              {section === 'providers' && <Providers {...props} />}
              {section === 'defaults' && (
                <ModelDefaults
                  key={`${props.profile.id}:${props.data.modelDefaults.updatedAt}`}
                  {...props}
                />
              )}
              {section === 'channels' && <Channels {...props} />}
              {section === 'sessions' && <Sessions {...props} />}
              {section === 'memories' && <Memories {...props} />}
              {section === 'skills' && <Capabilities kind="skills" {...props} />}
              {section === 'mcps' && <Capabilities kind="mcpServers" {...props} />}
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
      {newProfile && (
        <NewProfileDialog
          api={api}
          close={() => setNewProfile(false)}
          done={(created) => {
            setProfiles((current) => [...current, created]);
            setSelected(created.id);
            setNewProfile(false);
            go('overview');
          }}
        />
      )}
    </div>
  );
}

export function GatewayConsole() {
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

  if (checking) {
    return (
      <main className="boot" aria-busy="true">
        <LoaderCircle size={22} className="spin" aria-label="Verificando a sessão" />
      </main>
    );
  }

  return profiles ? (
    <Workspace
      initialProfiles={profiles}
      logout={async () => {
        // The cookie is the session; a failed call must not leave the panel looking signed in.
        await gatewayApi()
          .signOut()
          .catch(() => undefined);
        setProfiles(undefined);
      }}
    />
  ) : (
    <Login connected={setProfiles} />
  );
}
