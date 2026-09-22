'use client';

import { ArrowUp, MessageSquare, Plus, Square } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import {
  date,
  type GatewayApi,
  type Mutation,
  type Profile,
  type ProfileData,
  type Run,
} from '../lib/api';
import { Badge, Button, Empty, Field, Modal, SectionHeading } from './ui';

const running = (run?: Run) => run?.status === 'queued' || run?.status === 'running';

const statusLabels = {
  queued: 'Na fila',
  running: 'Em execução',
  completed: 'Concluída',
  failed: 'Falhou',
  interrupted: 'Interrompida',
  cancelled: 'Cancelada',
};

function Conversation({
  api,
  profileId,
  sessionId,
  initialRun,
}: {
  api: GatewayApi;
  profileId: string;
  sessionId: string;
  initialRun?: Run;
}) {
  const [messages, setMessages] = useState<Awaited<ReturnType<GatewayApi['messages']>>>([]);
  const [run, setRun] = useState(initialRun);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // Retain the key after an uncertain HTTP result, so a retry cannot enqueue the same text twice.
  const pending = useRef<{ text: string; key: string } | undefined>(undefined);
  const end = useRef<HTMLDivElement>(null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;

    return () => {
      alive.current = false;
    };
  }, []);

  const runId = run?.id;
  const isRunning = running(run);

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;

    const poll = async () => {
      try {
        const [history, active] = await Promise.all([
          api.messages(profileId, sessionId),
          runId && isRunning ? api.run(profileId, runId) : Promise.resolve(undefined),
        ]);

        if (stopped) {
          return;
        }

        setMessages(history);

        if (active) {
          setRun(active);
        }
      } catch (error) {
        if (!stopped) {
          setError(
            error instanceof Error ? error.message : 'Não foi possível atualizar a conversa.',
          );
        }
      } finally {
        if (!stopped) {
          timer = setTimeout(poll, isRunning ? 3000 : 10000);
        }
      }
    };

    void poll();

    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [api, profileId, sessionId, runId, isRunning]);

  useEffect(() => {
    if (messages.length) {
      end.current?.scrollIntoView({ block: 'nearest' });
    }
  }, [messages.length]);

  return (
    <div className="conversation">
      <section className="message-history" aria-label="Histórico da conversa">
        {messages.length ? (
          messages.map((message) => (
            <article key={message.id} className={`message ${message.role}`}>
              <header>
                <strong>{message.role === 'user' ? 'Você' : 'Agente'}</strong>
                <time>{date(message.createdAt)}</time>
              </header>
              <p>{message.content}</p>
            </article>
          ))
        ) : (
          <Empty title="Uma nova conversa">
            Envie uma mensagem para testar o modelo, as memórias e as ferramentas deste perfil.
          </Empty>
        )}
        <div ref={end} />
      </section>
      {run && (
        <div className="run-status">
          <Badge
            tone={
              run.status === 'completed'
                ? 'good'
                : ['failed', 'interrupted'].includes(run.status)
                  ? 'bad'
                  : 'neutral'
            }
          >
            {statusLabels[run.status]}
          </Badge>
          {run.usage && (
            <small>
              {(run.usage.inputTokens + run.usage.outputTokens).toLocaleString('pt-BR')} tokens ·{' '}
              {run.usage.steps} etapas
            </small>
          )}
          {running(run) && (
            <Button
              variant="quiet"
              busy={busy}
              onClick={async () => {
                setBusy(true);

                try {
                  const cancelled = await api.cancel(profileId, run.id);

                  if (alive.current) {
                    setRun(cancelled);
                  }
                } catch (error) {
                  if (alive.current) {
                    setError(error instanceof Error ? error.message : 'Não foi possível cancelar.');
                  }
                } finally {
                  if (alive.current) {
                    setBusy(false);
                  }
                }
              }}
            >
              <Square size={12} />
              Cancelar execução
            </Button>
          )}
        </div>
      )}
      {(error || run?.error) && (
        <p className="form-error" role="alert">
          {error || run?.error}
        </p>
      )}
      <form
        method="post"
        action="/ui/"
        className="composer"
        onSubmit={async (event) => {
          event.preventDefault();

          const input = text.trim();

          if (!input || busy || running(run)) {
            return;
          }

          setBusy(true);
          setError('');

          if (pending.current?.text !== input) {
            pending.current = { text: input, key: crypto.randomUUID() };
          }

          try {
            const submitted = await api.submit(profileId, sessionId, input, pending.current.key);

            if (!alive.current) {
              return;
            }

            pending.current = undefined;
            setRun(submitted);
            setText('');
          } catch (error) {
            if (alive.current) {
              setError(error instanceof Error ? error.message : 'Não foi possível enviar.');
            }
          } finally {
            if (alive.current) {
              setBusy(false);
            }
          }
        }}
      >
        <textarea
          aria-label="Mensagem"
          placeholder="O que vamos fazer?"
          value={text}
          onChange={(event) => setText(event.target.value)}
          maxLength={8000}
          rows={3}
          required
          disabled={busy || running(run)}
        />
        <div>
          <small>A memória pertence ao perfil. O histórico pertence à sessão.</small>
          <Button
            type="submit"
            aria-label="Enviar mensagem"
            busy={busy}
            disabled={!text.trim() || running(run)}
          >
            <ArrowUp size={18} />
          </Button>
        </div>
      </form>
    </div>
  );
}

export function Sessions({
  profile,
  data,
  api,
  mutate,
  busy,
}: {
  profile: Profile;
  data: ProfileData;
  api: GatewayApi;
  mutate: Mutation;
  busy: boolean;
}) {
  const [selected, setSelected] = useState(data.sessions[0]?.id);
  const [creating, setCreating] = useState(false);
  const [failed, setFailed] = useState(false);
  const active = data.sessions.find((item) => item.id === selected);

  return (
    <>
      <SectionHeading
        title="Conversas"
        description="Sessões independentes, conectadas pela memória do perfil."
        action={
          <Button
            onClick={() => {
              setFailed(false);
              setCreating(true);
            }}
          >
            <Plus size={16} />
            Nova conversa
          </Button>
        }
      />
      {data.sessions.length ? (
        <div className="sessions-layout">
          <aside className="session-list" aria-label="Sessões">
            {data.sessions.map((item) => (
              <button
                type="button"
                className={selected === item.id ? 'selected' : ''}
                key={item.id}
                onClick={() => setSelected(item.id)}
                aria-pressed={selected === item.id}
              >
                <MessageSquare size={17} />
                <span>
                  <strong>{item.title}</strong>
                  <small>
                    {item.channel} · {date(item.createdAt)}
                  </small>
                </span>
              </button>
            ))}
          </aside>
          {active ? (
            <Conversation
              key={active.id}
              api={api}
              profileId={profile.id}
              sessionId={active.id}
              initialRun={data.activities.filter((run) => run.sessionId === active.id).at(-1)}
            />
          ) : (
            <Empty title="Selecione uma conversa">
              Escolha uma sessão ao lado para abrir o histórico.
            </Empty>
          )}
        </div>
      ) : (
        <Empty
          title="Tudo começa com uma conversa"
          action={
            <Button variant="secondary" onClick={() => setCreating(true)}>
              Criar conversa
            </Button>
          }
        >
          Crie uma sessão para conversar pelo painel ou vinculá-la a um canal.
        </Empty>
      )}
      {creating && (
        <Modal title="Nova conversa" close={() => setCreating(false)}>
          <form
            method="post"
            action="/ui/"
            onSubmit={async (event) => {
              event.preventDefault();

              const form = new FormData(event.currentTarget);

              const ok = await mutate(async () => {
                const session = await api.createSession(
                  profile.id,
                  String(form.get('title')),
                  'web',
                );

                setSelected(session.id);
              }, 'Conversa criada.');

              setFailed(!ok);

              if (ok) {
                setCreating(false);
              }
            }}
          >
            <Field label="Título">
              <input
                name="title"
                required
                maxLength={160}
                placeholder="Ex.: Planejamento da semana"
              />
            </Field>
            {failed && (
              <p className="form-error" role="alert">
                Não foi possível criar a conversa.
              </p>
            )}
            <footer>
              <Button variant="secondary" onClick={() => setCreating(false)}>
                Cancelar
              </Button>
              <Button type="submit" busy={busy}>
                Criar conversa
              </Button>
            </footer>
          </form>
        </Modal>
      )}
    </>
  );
}
