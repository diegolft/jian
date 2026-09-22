'use client';

import {
  Check,
  MessageCircle,
  QrCode,
  Send,
  ShieldQuestion,
  Smartphone,
  Terminal,
  Unplug,
  UserCheck,
  UserX,
} from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { useEffect, useState } from 'react';
import {
  type Channel,
  type ChannelType,
  type Connection,
  type Contact,
  date,
  type GatewayApi,
  type Mutation,
  type Profile,
  type ProfileData,
} from '../lib/api';
import { Badge, Button, Confirm, Field, Modal, Secret, SectionHeading } from './ui';

type Props = {
  profile: Profile;
  data: ProfileData;
  api: GatewayApi;
  mutate: Mutation;
  busy: boolean;
};

const kinds = [
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

const states = {
  disconnected: 'Aparelho desconectado',
  connecting: 'Conectando',
  qr: 'Aguardando leitura do QR',
  connected: 'Aparelho conectado',
  error: 'Falha na conexão',
};

function Pairing({
  profileId,
  channel,
  api,
  close,
}: {
  profileId: string;
  channel: Channel;
  api: GatewayApi;
  close: () => void;
}) {
  const [connection, setConnection] = useState<Connection>();
  const [qr, setQr] = useState<{ qr: string; expiresAt: string }>();
  const [now, setNow] = useState(Date.now());
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;

    const poll = async () => {
      try {
        const state = await api.connection(profileId, channel.id);

        if (stopped) {
          return;
        }

        setConnection(state);

        if (state.status === 'qr') {
          const value = await api.qr(profileId, channel.id);

          if (!stopped) {
            setQr(value);
          }
        } else {
          setQr(undefined);
        }

        if (!stopped) {
          setError('');
        }
      } catch (error) {
        if (!stopped) {
          setQr(undefined);

          setError(
            error instanceof Error ? error.message : 'Não foi possível consultar a conexão.',
          );
        }
      } finally {
        if (!stopped) {
          timer = setTimeout(poll, 5000);
        }
      }
    };

    void poll();

    const clock = setInterval(() => setNow(Date.now()), 1000);

    return () => {
      stopped = true;
      clearTimeout(timer);
      clearInterval(clock);
    };
  }, [api, profileId, channel.id]);

  const validQr = qr && Date.parse(qr.expiresAt) > now;

  return (
    <Modal
      title="Conectar WhatsApp"
      description="No WhatsApp do celular, abra Dispositivos conectados → Conectar dispositivo."
      close={close}
    >
      <div className="pairing-stage">
        {connection?.status === 'connected' ? (
          <>
            <div className="success-orbit">
              <Check size={32} />
            </div>
            <h3>WhatsApp conectado</h3>
            <p>{connection.accountId}</p>
            <small>
              {connection.sessionSavedAt
                ? 'Sessão criptografada salva no Gateway.'
                : 'Preparando a primeira cópia da sessão. Pode levar cerca de um minuto.'}
            </small>
          </>
        ) : validQr ? (
          <>
            <div className="qr-frame">
              <QRCodeSVG
                value={qr.qr}
                size={240}
                level="M"
                marginSize={2}
                title="QR Code para vincular o WhatsApp"
              />
            </div>
            <small>O código se renova automaticamente.</small>
          </>
        ) : (
          <>
            <Smartphone size={40} strokeWidth={1.5} />
            <h3>{connection ? states[connection.status] : 'Consultando conexão'}</h3>
            <p>
              {connection?.status === 'connecting' || connection?.status === 'qr'
                ? 'Aguarde o Gateway preparar um novo QR Code.'
                : 'Inicie a conexão para gerar um QR Code.'}
            </p>
          </>
        )}
      </div>
      {(error || connection?.error) && (
        <p className="form-error" role="alert">
          {error || connection?.error}
        </p>
      )}
      <p className="note">
        Esta conexão usa um dispositivo vinculado ao seu WhatsApp; mantenha o QR privado. Quem
        escrever para você entra como solicitação de contato: nada é respondido antes da sua
        aprovação.
      </p>
      <footer>
        <Button variant="secondary" onClick={close}>
          Fechar
        </Button>
        {connection?.status !== 'connected' && (
          <Button
            busy={busy}
            onClick={async () => {
              setBusy(true);
              setError('');

              try {
                setConnection(await api.connect(profileId, channel.id));
              } catch (error) {
                setError(error instanceof Error ? error.message : 'Não foi possível conectar.');
              } finally {
                setBusy(false);
              }
            }}
          >
            <QrCode size={16} />
            {connection?.status === 'connecting' || connection?.status === 'qr'
              ? 'Reconectar'
              : 'Gerar QR Code'}
          </Button>
        )}
      </footer>
    </Modal>
  );
}

function Requests({ profile, data, api, mutate, busy }: Props) {
  const pending = data.contacts.filter((contact) => contact.status === 'pending');

  if (!pending.length) {
    return null;
  }

  const decide = (contact: Contact, approve: boolean) =>
    mutate(
      () =>
        approve
          ? api.approveContact(profile.id, contact.id)
          : api.blockContact(profile.id, contact.id),
      approve
        ? 'Contato aprovado. A mensagem em espera seguiu para o agente.'
        : 'Contato bloqueado.',
    );

  return (
    <section className="request-panel">
      <header>
        <ShieldQuestion size={20} />
        <div className="grow">
          <h2>Solicitações de contato</h2>
          <p>Alguém novo escreveu. O agente só responde depois que você aprovar.</p>
        </div>
        <Badge tone="warn">{pending.length} aguardando</Badge>
      </header>
      {pending.map((contact) => (
        <article className="request-row" key={contact.id}>
          <div className="grow">
            <h3>{contact.displayName ?? contact.actorId}</h3>
            <small>
              {kinds.find((kind) => kind.type === contact.type)?.name} · {contact.actorId} ·{' '}
              {date(contact.createdAt)}
            </small>
            <p className="request-message">{contact.message ?? 'Sem mensagem em espera.'}</p>
          </div>
          <div className="row-actions">
            <Button variant="secondary" disabled={busy} onClick={() => void decide(contact, true)}>
              <UserCheck size={16} />
              Aprovar
            </Button>
            <Button
              variant="quiet"
              disabled={busy}
              aria-label={`Recusar ${contact.actorId}`}
              onClick={() => void decide(contact, false)}
            >
              <UserX size={17} />
            </Button>
          </div>
        </article>
      ))}
    </section>
  );
}

function Known({ profile, data, api, mutate, busy }: Props) {
  const known = data.contacts.filter((contact) => contact.status !== 'pending');

  if (!known.length) {
    return null;
  }

  return (
    <section className="subsection">
      <h2>Contatos</h2>
      <div className="resource-list">
        {known.map((contact) => (
          <div className="resource-row" key={contact.id}>
            <div className={`resource-icon ${contact.type}`}>
              <MessageCircle size={20} />
            </div>
            <div className="grow">
              <h3>{contact.displayName ?? contact.actorId}</h3>
              <p>
                {kinds.find((kind) => kind.type === contact.type)?.name} · {contact.actorId}
              </p>
            </div>
            <Badge tone={contact.status === 'approved' ? 'good' : 'neutral'}>
              {contact.status === 'approved' ? 'Aprovado' : 'Bloqueado'}
            </Badge>
            <div className="row-actions">
              {contact.status === 'approved' ? (
                <Button
                  variant="quiet"
                  disabled={busy}
                  aria-label={`Bloquear ${contact.actorId}`}
                  onClick={() =>
                    void mutate(
                      () => api.blockContact(profile.id, contact.id),
                      'Contato bloqueado.',
                    )
                  }
                >
                  <UserX size={17} />
                </Button>
              ) : (
                <Button
                  variant="quiet"
                  disabled={busy}
                  aria-label={`Aprovar ${contact.actorId}`}
                  onClick={() =>
                    void mutate(
                      () => api.approveContact(profile.id, contact.id),
                      'Contato aprovado.',
                    )
                  }
                >
                  <UserCheck size={17} />
                </Button>
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

export function Channels(props: Props) {
  const { profile, data, api, mutate, busy } = props;
  const [pairing, setPairing] = useState<Channel>();
  const [secret, setSecret] = useState<string>();
  const [token, setToken] = useState('');
  const [disconnecting, setDisconnecting] = useState<Channel>();
  const [error, setError] = useState('');

  const connected = (type: ChannelType) =>
    data.channels.find((channel) => channel.type === type && !channel.revokedAt);

  const webhook = (channel: Channel) =>
    channel.type === 'telegram'
      ? `${window.location.origin}/v1/telegram/${channel.id}`
      : `${window.location.origin}/v1/ingress/${channel.id}`;

  const connect = async (type: ChannelType) => {
    setError('');

    return mutate(
      async () => {
        const channel = await api.createChannel(profile.id, {
          type,
          ...(type === 'telegram' ? { botToken: token.trim() } : {}),
        });

        setToken('');

        if (type === 'whatsapp') {
          // Connecting WhatsApp is reading the QR: the device starts pairing right away.
          await api.connect(profile.id, channel.id);
          setPairing(channel);
        } else {
          setSecret(
            `Webhook: ${webhook(channel)}\n${
              type === 'telegram' ? 'X-Telegram-Bot-Api-Secret-Token' : 'X-Jian-Channel-Token'
            }: ${channel.webhookToken}`,
          );
        }
      },
      `${kinds.find((kind) => kind.type === type)?.name} conectado.`,
    );
  };

  return (
    <>
      <SectionHeading
        title="Canais"
        description="Três formas de falar com o seu agente. Cada uma está conectada ou não."
      />
      <Requests {...props} />
      <div className="resource-list">
        {kinds.map((kind) => {
          const channel = connected(kind.type);

          return (
            <div className="settings-section" key={kind.type}>
              <div className="settings-caption">
                <h2>{kind.name}</h2>
                <p>{kind.description}</p>
                <Badge tone={channel ? 'good' : 'neutral'}>
                  {channel ? 'Conectado' : 'Não conectado'}
                </Badge>
              </div>
              <div className="settings-fields">
                {channel ? (
                  <>
                    {kind.type !== 'whatsapp' && (
                      <p className="note">
                        Webhook: <code>{webhook(channel)}</code>
                      </p>
                    )}
                    {kind.type === 'telegram' && (
                      <p className="note">
                        Registre essa URL no Telegram com <code>setWebhook</code>, usando o segredo
                        mostrado na conexão. Para trocar o token do bot, desconecte e conecte de
                        novo.
                      </p>
                    )}
                    <div className="save-bar">
                      {kind.type === 'whatsapp' && (
                        <Button variant="secondary" onClick={() => setPairing(channel)}>
                          <QrCode size={16} />
                          Ver conexão
                        </Button>
                      )}
                      <Button
                        variant="quiet"
                        disabled={busy}
                        onClick={() => setDisconnecting(channel)}
                      >
                        <Unplug size={16} />
                        Desconectar
                      </Button>
                      <span>Cada conversa aprovada vira uma sessão sua.</span>
                    </div>
                  </>
                ) : (
                  <form
                    method="post"
                    action="/ui/"
                    onSubmit={(event) => {
                      event.preventDefault();

                      if (kind.type === 'telegram' && !token.trim()) {
                        setError('Informe o token do bot do Telegram.');

                        return;
                      }

                      void connect(kind.type);
                    }}
                  >
                    {kind.type === 'telegram' && (
                      <Field
                        label="Token do bot"
                        hint="O valor do BotFather. Fica criptografado no cofre e não aparece de novo."
                      >
                        <input
                          name="botToken"
                          type="password"
                          autoComplete="off"
                          spellCheck={false}
                          value={token}
                          onChange={(event) => setToken(event.target.value)}
                        />
                      </Field>
                    )}
                    <div className="save-bar">
                      <Button type="submit" busy={busy}>
                        <kind.icon size={16} />
                        Conectar {kind.name}
                      </Button>
                      <span>
                        {kind.type === 'whatsapp'
                          ? 'Abre o QR Code para ler no celular.'
                          : kind.type === 'api'
                            ? 'Gera a URL e o token do webhook, mostrados uma única vez.'
                            : 'Nada mais é pedido: nem nome, nem sessão.'}
                      </span>
                    </div>
                  </form>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <Known {...props} />
      {data.deliveries.length > 0 && (
        <section className="subsection">
          <h2>Entregas recentes</h2>
          <div className="resource-list">
            {data.deliveries.slice(0, 10).map((item) => (
              <div className="resource-row" key={item.id}>
                <div className="grow">
                  <strong>
                    {kinds.find(
                      (kind) =>
                        kind.type ===
                        data.channels.find((channel) => channel.id === item.channelId)?.type,
                    )?.name ?? 'Canal'}
                  </strong>
                  <p>
                    {item.chatId} · {date(item.updatedAt)}
                    {item.notice ? ' · aviso de aprovação' : ''}
                  </p>
                </div>
                <Badge
                  tone={
                    item.status === 'sent'
                      ? 'good'
                      : ['failed', 'unknown'].includes(item.status)
                        ? 'bad'
                        : 'warn'
                  }
                >
                  {
                    {
                      pending: 'Pendente',
                      sending: 'Enviando',
                      sent: 'Enviada',
                      failed: 'Falhou',
                      unknown: 'Resultado incerto',
                    }[item.status]
                  }
                </Badge>
              </div>
            ))}
          </div>
          <p className="note">
            Uma entrega com resultado incerto não é reenviada automaticamente para evitar
            duplicação.
          </p>
        </section>
      )}
      {pairing && (
        <Pairing
          profileId={profile.id}
          channel={pairing}
          api={api}
          close={() => setPairing(undefined)}
        />
      )}
      {secret && (
        <Secret title="Configuração do webhook" value={secret} close={() => setSecret(undefined)} />
      )}
      {disconnecting && (
        <Confirm
          title="Desconectar canal?"
          description="O canal deixa de receber mensagens. Os contatos aprovados e suas conversas continuam salvos."
          busy={busy}
          close={() => setDisconnecting(undefined)}
          confirm={async () => {
            if (
              await mutate(
                () => api.revokeChannel(profile.id, disconnecting.id),
                'Canal desconectado.',
              )
            ) {
              setDisconnecting(undefined);
            }
          }}
        />
      )}
    </>
  );
}
