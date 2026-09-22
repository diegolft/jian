'use client';

import { Check, QrCode, Smartphone } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { useEffect, useState } from 'react';
import type { Channel, Connection, GatewayApi } from '../../lib/api';
import { Button, Modal } from '../ui';
import { states } from './kinds';

export function Pairing({
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
