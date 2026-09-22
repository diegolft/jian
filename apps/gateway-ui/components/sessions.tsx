'use client';

import { ArrowUp, MessageSquare, Plus, Square } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import {
  date,
  type GatewayApi,
  type ModelSelection,
  type Mutation,
  type Profile,
  type ProfileData,
  type ReasoningEffort,
  type Run,
} from '../lib/api';
import { availableModels } from './provider-settings';
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
  data,
}: {
  api: GatewayApi;
  profileId: string;
  sessionId: string;
  initialRun?: Run;
  data: ProfileData;
}) {
  const [messages, setMessages] = useState<Awaited<ReturnType<GatewayApi['messages']>>>([]);
  const [run, setRun] = useState(initialRun);
  const [text, setText] = useState('');
  const [selectedModel, setSelectedModel] = useState(() => {
    const defaultModel = data.modelDefaults.conversation;
    return defaultModel ? `${defaultModel.providerId}:${defaultModel.modelId}` : '';
  });
  const [effort, setEffort] = useState(data.modelDefaults.conversation?.reasoningEffort ?? '');
  const models = availableModels(data);
  const chosen = models.find(
    (entry) => `${entry.provider.id}:${entry.model.id}` === selectedModel,
  )?.model;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // Retain the key after an uncertain HTTP result, so a retry cannot enqueue the same text twice.
  const pending = useRef<{ text: string; key: string; model: string } | undefined>(undefined);
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

          if (pending.current?.text !== input || pending.current.model !== selectedModel) {
            pending.current = { text: input, key: crypto.randomUUID(), model: selectedModel };
          }

          try {
            const model: ModelSelection | undefined = selectedModel
              ? {
                  providerId: selectedModel.split(':')[0],
                  modelId: selectedModel.split(':').slice(1).join(':'),
                  ...(effort ? { reasoningEffort: effort as ReasoningEffort } : {}),
                }
              : undefined;
            const submitted = await api.submit(
              profileId,
              sessionId,
              input,
              pending.current.key,
              model,
            );

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
          <label className="composer-model">
            <span>Modelo</span>
            <select
              aria-label="Modelo da conversa"
              value={selectedModel}
              onChange={(event) => setSelectedModel(event.target.value)}
              disabled={busy || running(run)}
            >
              <option value="">
                {models.length ? 'Padrão do perfil' : 'Configure um provider'}
              </option>
              {models.map(({ provider, model }) => (
                <option key={`${provider.id}:${model.id}`} value={`${provider.id}:${model.id}`}>
                  {provider.name} · {model.id}
                  {model.known ? '' : ' · desconhecido'}
                </option>
              ))}
            </select>
          </label>
          {!!chosen?.reasoningEfforts.length && (
            <label className="composer-model">
              <span>Esforço</span>
              <select
                aria-label="Nível de esforço"
                value={effort}
                onChange={(event) => setEffort(event.target.value)}
                disabled={busy || running(run)}
              >
                <option value="">Padrão do provider</option>
                {chosen.reasoningEfforts.map((level) => (
                  <option key={level} value={level}>
                    {level}
                  </option>
                ))}
              </select>
            </label>
          )}
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
              data={data}
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
