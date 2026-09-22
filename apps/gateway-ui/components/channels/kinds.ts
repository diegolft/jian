import { Send, Smartphone, Terminal } from 'lucide-react';

/** The three transports a profile can connect, and what each one asks of the owner. */
export const kinds = [
  {
    type: 'whatsapp' as const,
    name: 'WhatsApp',
    icon: Smartphone,
    description: 'Um aparelho conectado ao seu WhatsApp. Conectar é ler o QR Code.',
  },
  {
    type: 'telegram' as const,
    name: 'Telegram',
    icon: Send,
    description: 'Um bot do BotFather. Conectar é informar o token dele.',
  },
  {
    type: 'api' as const,
    name: 'API Server',
    icon: Terminal,
    description: 'Um endpoint HTTP para os seus próprios sistemas enviarem mensagens.',
  },
];

export const states = {
  disconnected: 'Aparelho desconectado',
  connecting: 'Conectando',
  qr: 'Aguardando leitura do QR',
  connected: 'Aparelho conectado',
  error: 'Falha na conexão',
};
