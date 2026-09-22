'use client';

import { LoaderCircle, LockKeyhole } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { GatewayApi, Run } from '../../lib/api';
import { date } from '../../lib/format';
import { Badge, Button, Empty } from '../ui';
import { RunProgress } from './progress';
import { running, statusLabels } from './status';

export function History({
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const runId = run?.id;
  const isRunning = running(run);
  // biome-ignore lint/correctness/useExhaustiveDependencies: Retry explicitly restarts a failed read.
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const [history, active] = await Promise.all([
          api.messages(profileId, sessionId),
          runId && isRunning ? api.run(profileId, runId) : Promise.resolve(undefined),
        ]);
        if (stopped) return;
        setMessages(history);
        if (active) setRun(active);
        setError('');
        timer = setTimeout(poll, isRunning ? 3000 : 10000);
      } catch (failure) {
        if (!stopped)
          setError(
            failure instanceof Error ? failure.message : 'Não foi possível carregar o histórico.',
          );
      } finally {
        if (!stopped) setLoading(false);
      }
    };
    void poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [api, profileId, sessionId, runId, isRunning, retry]);

  return (
    <div className="session-history">
      <div className="history-caption">
        <LockKeyhole size={14} />
        <span>Somente leitura</span>
        <span>{messages.length} mensagens</span>
      </div>
      <section className="message-history" aria-label="Histórico da sessão" aria-busy={loading}>
        {loading ? (
          <div className="history-loading" role="status">
            <LoaderCircle size={20} className="spin" />
            Carregando histórico…
          </div>
        ) : messages.length ? (
          messages.map((message) => (
            <article key={message.id} className={`message ${message.role}`}>
              <header>
                <strong>
                  {message.role === 'user'
                    ? 'Usuário'
                    : message.role === 'assistant'
                      ? 'Agente'
                      : message.role === 'system'
                        ? 'Sistema'
                        : 'Ferramenta'}
                </strong>
                <time dateTime={message.createdAt}>{date(message.createdAt)}</time>
              </header>
              <p>{message.content}</p>
            </article>
          ))
        ) : (
          !error && (
            <Empty title="Nenhuma mensagem nesta sessão">
              As mensagens recebidas pelo canal aparecerão aqui.
            </Empty>
          )
        )}
        {run && isRunning && <RunProgress run={run} />}
      </section>
      {error && (
        <div className="history-error" role="alert">
          <p>{error}</p>
          <Button
            variant="secondary"
            onClick={() => {
              setLoading(true);
              setRetry((value) => value + 1);
            }}
          >
            Tentar novamente
          </Button>
        </div>
      )}
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
          {run.error && <p className="text-bad">{run.error}</p>}
        </div>
      )}
    </div>
  );
}
