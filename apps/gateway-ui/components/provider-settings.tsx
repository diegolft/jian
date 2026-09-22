'use client';

import { Save, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import {
  date,
  type GatewayApi,
  type ModelDefaultsInput,
  type ModelSelection,
  type Mutation,
  type Profile,
  type ProfileData,
  type ProviderModel,
  type ReasoningEffort,
} from '../lib/api';
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
    kind: 'openrouter',
    name: 'OpenRouter',
    variables: 'OPENROUTER_API_KEY',
  },
  {
    kind: 'anthropic',
    name: 'Anthropic',
    variables: 'ANTHROPIC_API_KEY ou ANTHROPIC_API_TOKEN',
  },
  { kind: 'google', name: 'Gemini', variables: 'GEMINI_API_TOKEN' },
  { kind: 'openai', name: 'OpenAI', variables: 'OPENAI_API_KEY' },
] as const;

/**
 * The activities that can pin a model. `runtime: false` is deliberate and visible: the gateway
 * stores and validates the choice, and nothing executes it yet.
 */
const roles = [
  {
    key: 'conversation',
    label: 'Conversas',
    hint: 'Usado no painel e na API quando nenhum modelo é indicado.',
    runtime: true,
  },
  {
    key: 'channel',
    label: 'Canais',
    hint: 'WhatsApp, Telegram e webhooks. Sem escolha, usa o padrão de conversas.',
    runtime: true,
  },
  {
    key: 'compaction',
    label: 'Compactação de contexto',
    hint: 'Resumirá o histórico quando a conversa passar do orçamento.',
    runtime: false,
  },
  {
    key: 'image',
    label: 'Geração de imagem',
    hint: 'Modelo que produzirá imagens a pedido do agente.',
    runtime: false,
  },
  {
    key: 'audio',
    label: 'Geração de áudio',
    hint: 'Modelo que produzirá som que não é fala.',
    runtime: false,
  },
  {
    key: 'speech',
    label: 'Fala a partir de texto',
    hint: 'Modelo que lerá em voz alta uma resposta escrita.',
    runtime: false,
  },
  {
    key: 'transcription',
    label: 'Texto a partir de fala',
    hint: 'Modelo que transcreverá áudio recebido nos canais.',
    runtime: false,
  },
] as const;

type Role = (typeof roles)[number]['key'];

const efforts: Array<{ value: ReasoningEffort; label: string }> = [
  { value: 'none', label: 'Sem raciocínio' },
  { value: 'minimal', label: 'Mínimo' },
  { value: 'low', label: 'Baixo' },
  { value: 'medium', label: 'Médio' },
  { value: 'high', label: 'Alto' },
];

/** A live provider carries its own key: revoking it takes the key with it. */
export const usableProviders = (data: ProfileData) =>
  data.providers.filter((provider) => !provider.revokedAt);

/**
 * Every model the configured accounts actually reported, as the gateway last heard it. An
 * empty result means no provider answered — never that the panel has nothing to show.
 */
export const availableModels = (data: ProfileData) =>
  usableProviders(data).flatMap((provider) =>
    (data.providerModels[provider.id]?.models ?? []).map((model) => ({ provider, model })),
  );

const modelLabel = (model: ProviderModel) =>
  `${model.displayName ?? model.id}${model.known ? '' : ' · capacidades desconhecidas'}`;

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

type RoleValue = {
  providerId: string;
  modelId: string;
  reasoningEffort: string;
  /** The id was typed instead of picked, so the panel knows nothing about its capabilities. */
  manual: boolean;
};

const empty: RoleValue = { providerId: '', modelId: '', reasoningEffort: '', manual: false };

function initial(data: ProfileData, selection: ModelSelection | null): RoleValue {
  if (!selection) return empty;

  const listed = (data.providerModels[selection.providerId]?.models ?? []).some(
    (model) => model.id === selection.modelId,
  );

  return {
    providerId: selection.providerId,
    modelId: selection.modelId,
    reasoningEffort: selection.reasoningEffort ?? '',
    manual: !listed,
  };
}

function toSelection(value: RoleValue): ModelSelection | null {
  if (!value.providerId || !value.modelId.trim()) return null;

  return {
    providerId: value.providerId,
    modelId: value.modelId.trim(),
    ...(value.reasoningEffort ? { reasoningEffort: value.reasoningEffort as ReasoningEffort } : {}),
  };
}

export function ModelDefaults({ profile, data, api, mutate, busy }: Props) {
  const configured = usableProviders(data);
  const [values, setValues] = useState<Record<Role, RoleValue>>(
    () =>
      Object.fromEntries(
        roles.map((role) => [role.key, initial(data, data.modelDefaults[role.key])]),
      ) as Record<Role, RoleValue>,
  );

  const change = (role: Role, patch: Partial<RoleValue>) =>
    setValues((current) => ({ ...current, [role]: { ...current[role], ...patch } }));

  if (!configured.length) {
    return (
      <>
        <SectionHeading
          title="Modelos padrão"
          description="Um modelo por atividade. Cada um pode ficar vazio."
        />
        <Empty title="Cadastre um provider primeiro">
          Os modelos aparecem aqui quando uma conexão estiver pronta.
        </Empty>
      </>
    );
  }

  return (
    <>
      <SectionHeading
        title="Modelos padrão"
        description="Um modelo por atividade, com o nível de esforço onde o modelo aceita. Cada um pode ficar vazio."
      />
      <form
        method="post"
        action="/ui/"
        onSubmit={(event) => {
          event.preventDefault();
          void mutate(
            () =>
              api.setModelDefaults(
                profile.id,
                Object.fromEntries(
                  roles.map((role) => [role.key, toSelection(values[role.key])]),
                ) as ModelDefaultsInput,
              ),
            'Modelos padrão salvos.',
          );
        }}
      >
        {roles.map((role) => {
          const value = values[role.key];
          const models = data.providerModels[value.providerId]?.models ?? [];
          const list = value.providerId ? data.providerModels[value.providerId] : undefined;
          const selected = models.find((model) => model.id === value.modelId);
          // A typed id has no capability row here, so every level is offered and the gateway
          // refuses the ones the model does not take.
          const allowed = value.manual
            ? efforts
            : efforts.filter((effort) => selected?.reasoningEfforts.includes(effort.value));

          return (
            <div className="settings-section" key={role.key}>
              <div className="settings-caption">
                <h2>{role.label}</h2>
                <p>{role.hint}</p>
                {!role.runtime && (
                  <Badge tone="warn">Configurável, ainda sem runtime: salvo e não usado</Badge>
                )}
                {selected && !selected.known && (
                  <Badge tone="warn">Capacidades desconhecidas: limites conservadores</Badge>
                )}
                {list?.stale && (
                  <p className="note" role="status">
                    Lista desatualizada: o provider não respondeu na última leitura.
                  </p>
                )}
              </div>
              <div className="settings-fields">
                <Field label={`Provider · ${role.label}`}>
                  <select
                    value={value.providerId}
                    disabled={busy}
                    onChange={(event) =>
                      change(role.key, {
                        providerId: event.target.value,
                        modelId: '',
                        reasoningEffort: '',
                        manual: false,
                      })
                    }
                  >
                    <option value="">Nenhum</option>
                    {configured.map((provider) => (
                      <option key={provider.id} value={provider.id}>
                        {provider.name}
                      </option>
                    ))}
                    {value.providerId &&
                      !configured.some((provider) => provider.id === value.providerId) && (
                        <option value={value.providerId}>Provider salvo (indisponível)</option>
                      )}
                  </select>
                </Field>
                <Field
                  label={`Modelo · ${role.label}`}
                  hint={
                    value.manual
                      ? 'ID informado à mão. Use quando o provider não publica a lista, como o login ChatGPT.'
                      : undefined
                  }
                >
                  {value.manual ? (
                    <input
                      type="text"
                      value={value.modelId}
                      disabled={busy || !value.providerId}
                      maxLength={160}
                      placeholder="ID do modelo"
                      onChange={(event) => change(role.key, { modelId: event.target.value })}
                    />
                  ) : (
                    <select
                      value={value.modelId}
                      disabled={busy || !value.providerId}
                      onChange={(event) =>
                        event.target.value === '__manual__'
                          ? change(role.key, { manual: true, modelId: '', reasoningEffort: '' })
                          : change(role.key, { modelId: event.target.value, reasoningEffort: '' })
                      }
                    >
                      <option value="">Nenhum</option>
                      {models.map((model) => (
                        <option key={model.id} value={model.id}>
                          {modelLabel(model)}
                        </option>
                      ))}
                      <option value="__manual__">Informar ID…</option>
                    </select>
                  )}
                </Field>
                <Field
                  label={`Esforço · ${role.label}`}
                  hint={
                    allowed.length
                      ? undefined
                      : 'Este modelo não tem níveis de esforço catalogados.'
                  }
                >
                  <select
                    value={value.reasoningEffort}
                    disabled={busy || !allowed.length}
                    onChange={(event) => change(role.key, { reasoningEffort: event.target.value })}
                  >
                    <option value="">Padrão do provider</option>
                    {allowed.map((effort) => (
                      <option key={effort.value} value={effort.value}>
                        {effort.label}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
            </div>
          );
        })}
        <div className="save-bar">
          <span>Alterações valem para novas execuções.</span>
          <Button type="submit" busy={busy}>
            <Save size={16} />
            Salvar modelos
          </Button>
        </div>
      </form>
    </>
  );
}
