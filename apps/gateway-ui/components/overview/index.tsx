'use client';

import { Activity, ArrowRight, BookOpen, Check, MessageSquare, Smartphone } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { date, type Profile, type ProfileData } from '../../lib/api';
import { Avatar } from '../profile/avatar-field';
import { Badge, Button, SectionHeading } from '../ui';

export function Overview({ profile, data }: { profile: Profile; data: ProfileData }) {
  const router = useRouter();
  const go = (href: string) => router.push(href);

  const connected = data.channels.filter((item) => !item.revokedAt);

  const providerReady = data.providers.some((item) => !item.revokedAt) || !!profile.model.apiKeyEnv;

  const steps = [
    {
      label: 'Definir identidade',
      description: 'Propósito e instruções do seu agente.',
      done: true,
      href: '/identity',
    },
    {
      label: 'Conectar inteligência',
      description: 'Adicione os providers que processam as conversas.',
      done: providerReady,
      href: '/providers',
    },
    {
      label: 'Criar uma conversa',
      description: 'Uma sessão para testar. As dos canais nascem sozinhas.',
      done: data.sessions.length > 0,
      href: '/conversations',
    },
    {
      label: 'Abrir um canal',
      description: 'WhatsApp, Telegram ou o API Server.',
      done: connected.length > 0,
      href: '/channels',
    },
  ];

  const complete = steps.filter((step) => step.done).length;

  return (
    <>
      <SectionHeading
        title={`Seu espaço, ${profile.name}.`}
        description="Uma visão do seu agente e dos lugares onde ele atua."
        action={
          <Button variant="secondary" onClick={() => go('/conversations')}>
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
        <button className="text-button" type="button" onClick={() => go('/identity')}>
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
              onClick={() => go(step.href)}
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
          <button type="button" className="text-button" onClick={() => go('/models')}>
            Definir modelos padrão
            <ArrowRight size={16} />
          </button>
        </section>
      </div>
      <section className="subsection">
        <header className="section-row">
          <h2>Execuções em andamento</h2>
          <button type="button" className="text-button" onClick={() => go('/conversations')}>
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
