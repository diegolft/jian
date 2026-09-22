'use client';

import { LoaderCircle, PencilLine, Sparkles, Wrench } from 'lucide-react';
import type { Run } from '../../lib/api';

/** What the panel calls each tool, so the owner reads an action instead of a function name. */
const toolLabels: Record<string, string> = {
  read_memories: 'lendo memórias',
  remember: 'salvando uma memória',
  list_sessions: 'procurando conversas',
  read_session: 'lendo outra conversa',
  load_skill: 'carregando uma skill',
  search_history: 'buscando no histórico',
  read_artifact: 'lendo um resultado grande',
  list_activities: 'vendo o que está em andamento',
  read_run_checkpoints: 'revendo os passos de uma execução',
  send_session_message: 'escrevendo para outra conversa',
  list_agents: 'vendo os outros agentes',
  ask_agent: 'perguntando a outro agente',
  read_inbox: 'lendo a caixa de entrada',
  acquire_resource: 'reservando um recurso',
  release_resource: 'liberando um recurso',
  update_skills: 'reescrevendo as próprias skills',
  update_identity: 'ajustando a própria identidade',
  read_identity: 'relendo a própria identidade',
  create_profile: 'criando um perfil',
};

/**
 * What the agent is doing, while it does it. The panel is the only surface that names tools:
 * a chat channel gets the answer taking shape and nothing else.
 */
export function RunProgress({ run }: { run: Run }) {
  const progress = run.progress;
  const phase =
    run.status === 'queued'
      ? 'Na fila'
      : progress?.phase === 'tool'
        ? `Usando ferramentas — ${toolLabels[progress.tool ?? ''] ?? progress.tool}`
        : progress?.phase === 'writing'
          ? 'Escrevendo a resposta'
          : 'Pensando';

  const icon =
    progress?.phase === 'tool' ? (
      <Wrench size={15} />
    ) : progress?.phase === 'writing' ? (
      <PencilLine size={15} />
    ) : (
      <Sparkles size={15} />
    );

  return (
    <article className="message assistant pending" aria-live="polite">
      <header>
        <strong>Agente</strong>
        <span className="run-phase">
          {icon}
          {phase}
          <LoaderCircle size={13} className="spin" aria-hidden="true" />
        </span>
      </header>
      {progress?.text ? (
        <p>
          {progress.text}
          <span className="caret" aria-hidden="true" />
        </p>
      ) : (
        <p className="muted">
          {progress?.steps ? `${progress.steps} etapas até agora.` : 'Preparando a resposta.'}
        </p>
      )}
    </article>
  );
}
