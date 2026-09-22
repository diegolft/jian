'use client';

import { ArrowUpRight, ChevronDown, KeyRound, Save, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { GatewayApi } from '../../lib/api';
import { date } from '../../lib/format';
import type { SectionProps } from '../props';
import { Badge, Button, Field, SectionHeading } from '../ui';
import { providers } from './catalog';

export function Providers({ data, api, mutate, busy }: SectionProps) {
  const [editing, setEditing] = useState<string>();
  const [formError, setFormError] = useState('');
  const [codexLogin, setCodexLogin] = useState<Awaited<ReturnType<GatewayApi['codexLogin']>>>();

  useEffect(() => {
    let active = true;
    void api
      .codexLogin()
      .then((state) => {
        if (active) setCodexLogin(state);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [api]);

  useEffect(() => {
    if (codexLogin?.status !== 'pending') return;
    const timer = setInterval(() => {
      void api
        .codexLogin()
        .then((state) => {
          setCodexLogin(state);
          if (state.status === 'connected') void mutate(async () => {}, 'ChatGPT conectado.');
        })
        .catch(() =>
          setCodexLogin({ status: 'failed', error: 'Não foi possível verificar o login.' }),
        );
    }, 5000);
    return () => clearInterval(timer);
  }, [api, codexLogin?.status, mutate]);

  return (
    <>
      <SectionHeading
        title="Providers"
        description="Conecte uma vez, use em todos os perfis. Cada perfil escolhe o próprio modelo em Modelos padrão."
      />
      <div className="connections-grid providers-grid">
        {providers.map((entry) => {
          const configured = data.providers.find(
            (provider) => provider.kind === entry.kind && !provider.revokedAt,
          );
          const list = configured ? data.providerModels[configured.id] : undefined;
          const uncatalogued = list?.models.filter((model) => !model.known).length ?? 0;
          return (
            <article className="connection-card" data-connected={!!configured} key={entry.kind}>
              <header className="connection-card-header">
                <span className="provider-symbol" aria-hidden="true">
                  {{ openai: '◎', anthropic: 'A', google: '✦', openrouter: '⇄' }[entry.kind]}
                </span>
                <Badge tone={configured ? 'good' : 'neutral'}>
                  {configured
                    ? configured.authMode === 'codex'
                      ? 'ChatGPT conectado'
                      : 'Conectado'
                    : 'Não configurado'}
                </Badge>
              </header>
              <h2>{entry.name}</h2>
              <p className="connection-description">
                {
                  {
                    openrouter: 'Uma conta, múltiplos modelos.',
                    anthropic: 'Modelos Claude para seus agentes.',
                    google: 'Modelos Gemini do Google.',
                    openai: 'API da OpenAI ou sua conta ChatGPT.',
                  }[entry.kind]
                }
              </p>
              <div className="connection-meta">
                {configured ? (
                  <>
                    <KeyRound size={13} />
                    <span>
                      {configured.apiKeyEnv
                        ? 'Credencial do ambiente'
                        : configured.authMode === 'codex'
                          ? 'Login ChatGPT'
                          : `Chave salva em ${date(configured.createdAt)}`}
                    </span>
                  </>
                ) : (
                  <span>Credenciais criptografadas</span>
                )}
                {list && !list.stale && (
                  <span>
                    {list.models.length} modelos disponíveis
                    {uncatalogued > 0 && ` · ${uncatalogued} sem capacidades catalogadas`}
                  </span>
                )}
              </div>
              {list?.stale && (
                <p className="note" role="status">
                  {list.models.length ? `Lista de ${date(list.fetchedAt)}. ` : ''}
                  {list.reason ?? 'Não foi possível atualizar os modelos.'}
                </p>
              )}
              <button
                type="button"
                className="connection-action"
                aria-expanded={editing === entry.kind}
                aria-controls={`provider-${entry.kind}`}
                disabled={busy}
                onClick={() => {
                  setEditing(editing === entry.kind ? undefined : entry.kind);
                  setFormError('');
                }}
              >
                {editing === entry.kind
                  ? 'Fechar configuração'
                  : configured
                    ? 'Gerenciar conexão'
                    : 'Conectar'}
                {editing === entry.kind ? <ChevronDown size={16} /> : <ArrowUpRight size={16} />}
              </button>
              <div
                id={`provider-${entry.kind}`}
                className="connection-disclosure"
                hidden={editing !== entry.kind}
              >
                <form
                  className="connection-form"
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
                        api.createProvider({
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
                    hint={
                      configured?.apiKeyEnv
                        ? `Chave atual: ${configured.apiKeyEnv}. A nova chave substitui a do ambiente.`
                        : 'O valor salvo não aparece novamente.'
                    }
                  >
                    <input name="secret" type="password" autoComplete="off" required />
                  </Field>
                  <div className="flex flex-wrap items-center gap-3">
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
                            () => api.revokeProvider(configured.id),
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
                    <div className="mt-5 border-t border-line pt-5">
                      <Button
                        type="button"
                        variant="secondary"
                        disabled={busy || codexLogin?.status === 'pending'}
                        onClick={() =>
                          void api
                            .startCodexLogin()
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
                  {formError && editing === entry.kind && (
                    <p className="form-error" role="alert">
                      {formError}
                    </p>
                  )}
                </form>
              </div>
            </article>
          );
        })}
      </div>
    </>
  );
}
