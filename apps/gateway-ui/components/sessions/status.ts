import type { Run } from '../../lib/api';

export const running = (run?: Run) => run?.status === 'queued' || run?.status === 'running';

export const statusLabels = {
  queued: 'Na fila',
  running: 'Em execução',
  completed: 'Concluída',
  failed: 'Falhou',
  interrupted: 'Interrompida',
  cancelled: 'Cancelada',
};
