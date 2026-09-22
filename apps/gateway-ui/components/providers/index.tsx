'use client';

import { Save, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { GatewayApi } from '../../lib/api';
import { date } from '../../lib/format';
import type { SectionProps } from '../props';
import { Badge, Button, Field, SectionHeading } from '../ui';
import { providers } from './catalog';

export function Providers({ profile, data, api, mutate, busy }: SectionProps) {
  const [formError, setFormError] = useState('');
  const [codexLogin, setCodexLogin] = useState<Awaited<ReturnType<GatewayApi['codexLogin']>>>();

  useEffect(() => {
    let active = true;
    void api
      .codexLogin(profile.id)
      .then((state) => {
        if (active) setCodexLogin(state);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [api, profile.id]);

  useEffect(() => {
    if (codexLogin?.status !== 'pending') return;
    const timer = setInterval(() => {
      void api
        .codexLogin(profile.id)
        .then((state) => {
          setCodexLogin(state);
          if (state.status === 'connected') void mutate(async () => {}, 'ChatGPT conectado.');
        })
        .catch(() =>
          setCodexLogin({ status: 'failed', error: 'Não foi possível verificar o login.' }),
        );
    }, 5000);
    return () => clearInterval(timer);
  }, [api, profile.id, codexLogin?.status, mutate]);

  return (
    <>
      <SectionHeading
        title="Providers"
        description="Configure uma chave para cada serviço. As variáveis do ambiente são detectadas automaticamente. A lista de modelos vem da conta, não daqui."
      />
      <div className="resource-list">
        {providers.map((entry) => {
          const configured = data.providers.find(
            (provider) => provider.kind === entry.kind && !provider.revokedAt,
          );
          const list = configured ? data.providerModels[configured.id] : undefined;
          const uncatalogued = list?.models.filter((model) => !model.known).length ?? 0;
          return (
            <div className="settings-section" key={entry.kind}>
              <div className="settings-caption">
                <h2>{entry.name}</h2>
                <p>{entry.variables}</p>
                <Badge tone={configured ? 'good' : 'neutral'}>
                  {configured
                    ? configured.authMode === 'codex'
                      ? 'ChatGPT conectado'
                      : 'Configurado'
                    : 'Sem chave'}
                </Badge>
                {configured?.apiKeyEnv ? (
                  <p>Variável: {configured.apiKeyEnv}</p>
                ) : (
                  configured && <p>Chave guardada em {date(configured.createdAt)}</p>
                )}
                {list && !list.stale && (
                  <p>
                    {list.models.length} modelos nesta conta, lidos em {date(list.fetchedAt)}
                    {uncatalogued > 0 && ` · ${uncatalogued} sem capacidades catalogadas`}
                  </p>
                )}
                {list?.stale && (
                  <p className="note" role="status">
                    {list.models.length
                      ? `Não foi possível atualizar a lista; mostrando a leitura de ${date(list.fetchedAt)}. ${list.reason ?? ''}`
                      : `Nenhuma lista disponível. ${list.reason ?? ''}`}
                  </p>
                )}
              </div>
              <form
                className="settings-fields"
                method="post"
                action="/ui/"
                onSubmit={async (event) => {
                  event.preventDefault();
                  setFormError('');
                  const element = event.currentTarget;
                  const secret = String(new FormData(element).get('secret') ?? '').trim();
                  if (!secret) {
                    setFormError(`Informe a chave de ${entry.name}.`);
                    return;
                  }
                  // Registering replaces the provider of this vendor, key included.
                  const ok = await mutate(
                    () =>
                      api.createProvider(profile.id, {
                        name: entry.name,
                        kind: entry.kind,
                        secret,
                      }),
                    `${entry.name} configurado.`,
                  );
                  if (ok) element.reset();
                }}
              >
                <Field
                  label={`Chave de ${entry.name}`}
                  hint="O valor salvo fica criptografado e não aparece novamente."
                >
                  <input name="secret" type="password" autoComplete="off" required />
                </Field>
                <div className="save-bar">
                  <Button type="submit" busy={busy}>
                    <Save size={16} />
                    {configured ? 'Trocar chave' : 'Salvar chave'}
                  </Button>
                  {configured && !configured.apiKeyEnv && (
                    <Button
                      type="button"
                      variant="quiet"
                      disabled={busy}
                      onClick={() =>
                        void mutate(
                          () => api.revokeProvider(profile.id, configured.id),
                          `${entry.name} desconectado.`,
                        )
                      }
                    >
                      <Trash2 size={16} />
                      {configured.authMode === 'codex' ? 'Desconectar ChatGPT' : 'Remover chave'}
                    </Button>
                  )}
                </div>
                {entry.kind === 'openai' && (
                  <div className="settings-fields">
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={busy || codexLogin?.status === 'pending'}
                      onClick={() =>
                        void api
                          .startCodexLogin(profile.id)
                          .then(setCodexLogin)
                          .catch((error) =>
                            setFormError(
                              error instanceof Error ? error.message : 'Login indisponível.',
                            ),
                          )
                      }
                    >
                      Entrar com ChatGPT
                    </Button>
                    {codexLogin?.status === 'pending' && (
                      <p className="note">
                        Abra{' '}
                        <a href={codexLogin.verificationUrl} target="_blank" rel="noreferrer">
                          o login da OpenAI
                        </a>{' '}
                        e informe o código <strong>{codexLogin.userCode}</strong>.
                      </p>
                    )}
                    {codexLogin?.status === 'failed' && codexLogin.error && (
                      <p className="form-error" role="alert">
                        {codexLogin.error}
                      </p>
                    )}
                  </div>
                )}
              </form>
            </div>
          );
        })}
      </div>
      {formError && (
        <p className="form-error" role="alert">
          {formError}
        </p>
      )}
    </>
  );
}
