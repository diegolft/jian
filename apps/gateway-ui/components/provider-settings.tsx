'use client';

import { Save, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { GatewayApi, ModelSelection, Mutation, Profile, ProfileData } from '../lib/api';
import { Badge, Button, Empty, Field, SectionHeading } from './ui';

type Props = {
  profile: Profile;
  data: ProfileData;
  api: GatewayApi;
  mutate: Mutation;
  busy: boolean;
};

const providers = [
  {
    kind: 'anthropic',
    name: 'Anthropic',
    variables: 'ANTHROPIC_API_KEY ou ANTHROPIC_API_TOKEN',
    models: [{ id: 'claude-sonnet-5', contextWindow: 1_000_000, maxOutputTokens: 128_000 }],
  },
  {
    kind: 'google',
    name: 'Gemini',
    variables: 'GEMINI_API_TOKEN',
    models: [{ id: 'gemini-3.8-flash', contextWindow: 1_000_000, maxOutputTokens: 65_536 }],
  },
  {
    kind: 'openai',
    name: 'OpenAI',
    variables: 'OPENAI_API_KEY',
    models: [{ id: 'gpt-5.6-terra', contextWindow: 1_000_000, maxOutputTokens: 128_000 }],
  },
] as const;

export const availableModels = (data: ProfileData) =>
  data.providers
    .filter(
      (provider) =>
        !provider.revokedAt &&
        (provider.apiKeyEnv ||
          data.credentials.some(
            (credential) => credential.id === provider.credentialId && !credential.revokedAt,
          )),
    )
    .flatMap((provider) => provider.models.map((model) => ({ provider, model })));

const keyOf = (value: ModelSelection | null) =>
  value ? `${value.providerId}:${value.modelId}` : '';

function selection(value: string): ModelSelection | null {
  if (!value) return null;

  const [providerId, ...modelId] = value.split(':');

  return { providerId, modelId: modelId.join(':') };
}

export function Providers({ profile, data, api, mutate, busy }: Props) {
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
        description="Configure uma chave para cada serviço. As variáveis do ambiente são detectadas automaticamente."
      />
      <div className="resource-list">
        {providers.map((entry) => {
          const configured = data.providers.find(
            (provider) =>
              provider.kind === entry.kind &&
              !provider.revokedAt &&
              (provider.apiKeyEnv ||
                data.credentials.some(
                  (credential) => credential.id === provider.credentialId && !credential.revokedAt,
                )),
          );
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
                    : 'Sem credencial'}
                </Badge>
                {configured?.apiKeyEnv && <p>Variável: {configured.apiKeyEnv}</p>}
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
                  const ok = await mutate(async () => {
                    const credential = await api.createCredential(profile.id, {
                      label: entry.name,
                      kind: 'provider',
                      secret,
                    });
                    await api.createProvider(profile.id, {
                      name: entry.name,
                      kind: entry.kind,
                      credentialId: credential.id,
                      models: [...entry.models],
                    });
                    if (configured && !configured.apiKeyEnv) {
                      await api.revokeProvider(profile.id, configured.id);
                      if (configured.credentialId) {
                        await api.revokeCredential(profile.id, configured.credentialId);
                      }
                    }
                  }, `${entry.name} configurado.`);
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
                        void mutate(async () => {
                          await api.revokeProvider(profile.id, configured.id);
                          if (configured.credentialId) {
                            await api.revokeCredential(profile.id, configured.credentialId);
                          }
                        }, `${entry.name} desconectado.`)
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

export function ModelDefaults({ profile, data, api, mutate, busy }: Props) {
  const models = availableModels(data);
  const [conversation, setConversation] = useState(keyOf(data.modelDefaults.conversation));
  const [channel, setChannel] = useState(keyOf(data.modelDefaults.channel));

  return (
    <>
      <SectionHeading
        title="Modelos padrão"
        description="Defina o modelo para conversas e mensagens de canais. O Composer pode escolher outro."
      />
      {!models.length ? (
        <Empty title="Cadastre um provider primeiro">
          Os modelos aparecem aqui quando uma conexão estiver pronta.
        </Empty>
      ) : (
        <form
          method="post"
          action="/ui/"
          onSubmit={(event) => {
            event.preventDefault();
            void mutate(
              () =>
                api.setModelDefaults(profile.id, {
                  conversation: selection(conversation),
                  channel: selection(channel),
                }),
              'Modelos padrão salvos.',
            );
          }}
        >
          <div className="settings-section">
            <div className="settings-caption">
              <h2>Por atividade</h2>
              <p>O orçamento de contexto é calculado a partir do modelo selecionado.</p>
            </div>
            <div className="settings-fields">
              <Field
                label="Conversas"
                hint="Usado no painel e na API quando nenhum modelo é indicado."
              >
                <select
                  value={conversation}
                  onChange={(event) => setConversation(event.target.value)}
                >
                  <option value="">Nenhum padrão</option>
                  {models.map(({ provider, model }) => (
                    <option key={`${provider.id}:${model.id}`} value={`${provider.id}:${model.id}`}>
                      {provider.name} · {model.id}
                    </option>
                  ))}
                </select>
              </Field>
              <Field
                label="Canais"
                hint="WhatsApp, Telegram e webhooks. Sem escolha, usa o padrão de conversas."
              >
                <select value={channel} onChange={(event) => setChannel(event.target.value)}>
                  <option value="">Usar o padrão de conversas</option>
                  {models.map(({ provider, model }) => (
                    <option key={`${provider.id}:${model.id}`} value={`${provider.id}:${model.id}`}>
                      {provider.name} · {model.id}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
          </div>
          <div className="save-bar">
            <span>Alterações valem para novas execuções.</span>
            <Button type="submit" busy={busy}>
              <Save size={16} />
              Salvar modelos
            </Button>
          </div>
        </form>
      )}
    </>
  );
}
