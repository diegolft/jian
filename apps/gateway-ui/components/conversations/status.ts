import type { Run } from '../../lib/api';

/** A run the gateway has not finished with yet; the composer waits on it. */
export const running = (run?: Run) => run?.status === 'queued' || run?.status === 'running';

export const statusLabels = {
  queued: 'Na fila',
  running: 'Em execução',
  completed: 'Concluída',
  failed: 'Falhou',
  interrupted: 'Interrompida',
  cancelled: 'Cancelada',
};
