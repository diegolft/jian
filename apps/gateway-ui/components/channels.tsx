'use client';

import { Check, Link2, Plus, QrCode, Smartphone, Trash2, Unplug } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { useEffect, useState } from 'react';
import {
  type Channel,
  type Connection,
  date,
  type GatewayApi,
  lines,
  type Mutation,
  type NewChannel,
  type Profile,
  type ProfileData,
} from '../lib/api';
import { Badge, Button, Confirm, Empty, Field, Modal, Secret, SectionHeading } from './ui';

const labels = { whatsapp: 'WhatsApp', telegram: 'Telegram', generic: 'Webhook HTTP' };

const states = {
  disconnected: 'Desconectado',
  connecting: 'Conectando',
  qr: 'Aguardando leitura',
  connected: 'Conectado',
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
      title={`Conectar ${channel.name}`}
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
        Esta conexão usa um dispositivo vinculado ao seu WhatsApp; mantenha o QR privado.
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

export function Channels({
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
  const [creating, setCreating] = useState(false);
  const [type, setType] = useState<NewChannel['type']>('whatsapp');
  const [pairing, setPairing] = useState<Channel>();
  const [secret, setSecret] = useState<string>();
  const [confirm, setConfirm] = useState<{ channel: Channel; action: 'revoke' | 'disconnect' }>();
  const [failed, setFailed] = useState(false);

  const normalize = (value: string) =>
    lines(value).map((item) =>
      type === 'whatsapp' && !item.includes('@') ? `${item.replace(/\D/g, '')}@c.us` : item,
    );

  return (
    <>
      <SectionHeading
        title="Canais"
        description="O mesmo perfil, presente onde suas conversas acontecem."
        action={
          <Button
            onClick={() => {
              setFailed(false);
              setCreating(true);
            }}
          >
            <Plus size={16} />
            Adicionar canal
          </Button>
        }
      />
      <div className="channel-intro">
        <div className="channel-illustration" aria-hidden="true">
          <Smartphone size={26} />
          <span />
          <Link2 size={24} />
        </div>
        <div>
          <h2>Conecte uma vez. Converse de qualquer lugar.</h2>
          <p>
            Cada canal usa uma sessão própria e compartilha a identidade, as ferramentas e as
            memórias do perfil.
          </p>
        </div>
      </div>
      {data.channels.length ? (
        <div className="resource-list">
          {data.channels.map((item) => (
            <article className="resource-row channel-row" key={item.id}>
              <div className={`resource-icon ${item.type}`}>
                <Smartphone size={22} />
              </div>
              <div className="grow">
                <h3>{item.name}</h3>
                <p>
                  {labels[item.type]} ·{' '}
                  {data.sessions.find((session) => session.id === item.sessionId)?.title ??
                    'Sessão vinculada'}
                </p>
                <small>{item.actorIds.length} remetente(s) permitido(s)</small>
              </div>
              <Badge tone={item.revokedAt ? 'neutral' : 'good'}>
                {item.revokedAt ? 'Revogado' : 'Configurado'}
              </Badge>
              {!item.revokedAt && (
                <div className="row-actions">
                  {item.type === 'whatsapp' && (
                    <>
                      <Button variant="secondary" onClick={() => setPairing(item)}>
                        <QrCode size={16} />
                        Conexão
                      </Button>
                      <Button
                        variant="quiet"
                        aria-label={`Desconectar ${item.name}`}
                        onClick={() => setConfirm({ channel: item, action: 'disconnect' })}
                      >
                        <Unplug size={17} />
                      </Button>
                    </>
                  )}
                  <Button
                    variant="quiet"
                    aria-label={`Revogar ${item.name}`}
                    onClick={() => setConfirm({ channel: item, action: 'revoke' })}
                  >
                    <Trash2 size={17} />
                  </Button>
                </div>
              )}
            </article>
          ))}
        </div>
      ) : (
        <Empty
          title="Escolha seu primeiro canal"
          action={
            <Button variant="secondary" onClick={() => setCreating(true)}>
              Conectar um canal
            </Button>
          }
        >
          WhatsApp por QR Code, Telegram ou uma integração via webhook.
        </Empty>
      )}
      {data.deliveries.length > 0 && (
        <section className="subsection">
          <h2>Entregas recentes</h2>
          <div className="resource-list">
            {data.deliveries.slice(0, 10).map((item) => (
              <div className="resource-row" key={item.id}>
                <div className="grow">
                  <strong>
                    {data.channels.find((channel) => channel.id === item.channelId)?.name ??
                      'Canal'}
                  </strong>
                  <p>
                    {item.chatId} · {date(item.updatedAt)}
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
      {creating && (
        <Modal title="Adicionar canal" close={() => setCreating(false)}>
          <form
            method="post"
            action="/ui/"
            onSubmit={async (event) => {
              event.preventDefault();

              const form = new FormData(event.currentTarget);

              const ok = await mutate(async () => {
                const created = await api.createChannel(profile.id, {
                  name: String(form.get('name')),
                  type,
                  sessionId: String(form.get('session')),
                  actorIds: normalize(String(form.get('actors'))),
                  chatIds: normalize(String(form.get('chats'))),
                  ...(type === 'telegram' ? { credentialId: String(form.get('credential')) } : {}),
                });

                if (type === 'whatsapp') {
                  setPairing(created);
                } else {
                  setSecret(
                    `Webhook: ${window.location.origin}/v1/${type === 'telegram' ? 'telegram' : 'ingress'}/${created.id}\n${type === 'telegram' ? 'X-Telegram-Bot-Api-Secret-Token' : 'X-Jian-Channel-Token'}: ${created.webhookToken}`,
                  );
                }
              }, 'Canal criado.');

              setFailed(!ok);

              if (ok) {
                setCreating(false);
              }
            }}
          >
            <Field label="Tipo">
              <select
                value={type}
                onChange={(event) => setType(event.target.value as NewChannel['type'])}
              >
                <option value="whatsapp">WhatsApp · QR Code</option>
                <option value="telegram">Telegram · Bot</option>
                <option value="generic">Webhook HTTP</option>
              </select>
            </Field>
            <Field label="Nome">
              <input name="name" required maxLength={100} placeholder="Ex.: WhatsApp pessoal" />
            </Field>
            <Field
              label="Sessão"
              hint="Crie uma sessão na aba Conversas antes de vincular o canal."
            >
              <select name="session" required defaultValue="">
                <option value="" disabled>
                  Selecionar sessão
                </option>
                {data.sessions.map((item) => (
                  <option value={item.id} key={item.id}>
                    {item.title}
                  </option>
                ))}
              </select>
            </Field>
            {type === 'telegram' && (
              <Field
                label="Credencial do bot"
                hint="Cadastre o token do BotFather em Credenciais, com uso Canal."
              >
                <select name="credential" required defaultValue="">
                  <option value="" disabled>
                    Selecionar credencial
                  </option>
                  {data.credentials
                    .filter((item) => item.kind === 'channel' && !item.revokedAt)
                    .map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.label}
                      </option>
                    ))}
                </select>
              </Field>
            )}
            <Field
              label="Remetentes permitidos"
              hint={
                type === 'whatsapp'
                  ? 'Um telefone por linha, com código do país e DDD. Ex.: 5571999999999.'
                  : 'IDs exatos dos remetentes, um por linha.'
              }
            >
              <textarea name="actors" required rows={3} />
            </Field>
            <Field
              label="Conversas permitidas"
              hint={
                type === 'whatsapp'
                  ? 'Em conversas diretas, repita os telefones permitidos. Grupos não são atendidos.'
                  : 'IDs exatos dos chats, um por linha.'
              }
            >
              <textarea name="chats" required rows={3} />
            </Field>
            {type === 'telegram' && (
              <p className="note">
                Após criar, registre a URL do webhook e seu secret_token no Telegram usando
                setWebhook.
              </p>
            )}
            {type === 'generic' && (
              <p className="note">
                O webhook recebe mensagens. Consulte a execução pela API para obter a resposta.
              </p>
            )}
            {failed && (
              <p role="alert" className="form-error">
                Não foi possível criar. Confira a sessão, os IDs permitidos e a credencial.
              </p>
            )}
            <footer>
              <Button variant="secondary" onClick={() => setCreating(false)}>
                Cancelar
              </Button>
              <Button type="submit" busy={busy} disabled={!data.sessions.length}>
                Criar canal
              </Button>
            </footer>
          </form>
        </Modal>
      )}
      {pairing && !creating && (
        <Pairing
          profileId={profile.id}
          channel={pairing}
          api={api}
          close={() => setPairing(undefined)}
        />
      )}
      {secret && !creating && (
        <Secret title="Configuração do webhook" value={secret} close={() => setSecret(undefined)} />
      )}
      {confirm && (
        <Confirm
          title={confirm.action === 'revoke' ? 'Revogar canal?' : 'Desconectar WhatsApp?'}
          description={
            confirm.action === 'revoke'
              ? 'O canal deixará de receber mensagens. Crie um novo canal para restabelecer o acesso.'
              : 'A sessão salva será apagada. Você precisará ler um novo QR Code para conectar novamente.'
          }
          busy={busy}
          close={() => setConfirm(undefined)}
          confirm={async () => {
            if (
              await mutate(
                () =>
                  confirm.action === 'revoke'
                    ? api.revokeChannel(profile.id, confirm.channel.id)
                    : api.disconnect(profile.id, confirm.channel.id),
                'Canal atualizado.',
              )
            ) {
              setConfirm(undefined);
            }
          }}
        />
      )}
    </>
  );
}
