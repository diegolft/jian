'use client';

import { Check, Plus, Save, SlidersHorizontal } from 'lucide-react';
import { useState } from 'react';
import type { GatewayApi, Mutation, NewProfile, Profile, ProfileData } from '../lib/api';
import { Button, Field, Modal, SectionHeading } from './ui';

const identityLines = (value: string) =>
  value
    .split('\n')
    .map((item) => item.trim())
    .filter(Boolean);

export function NewProfileDialog({
  api,
  done,
  close,
}: {
  api: GatewayApi;
  done: (profile: Profile) => void;
  close: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  return (
    <Modal
      title="Um novo perfil"
      description="Cada perfil tem sua identidade, memória e conexões."
      close={close}
    >
      <form
        method="post"
        action="/ui/"
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          setError('');

          const data = new FormData(event.currentTarget);

          try {
            const profile = await api.createProfile({
              name: String(data.get('name')),
              instructions: String(data.get('instructions')),
              model: {
                provider: data.get('provider') as NewProfile['model']['provider'],
                modelId: String(data.get('model')),
                ...(data.get('baseURL') ? { baseURL: String(data.get('baseURL')) } : {}),
              },
            });

            done(profile);
          } catch (error) {
            setError(error instanceof Error ? error.message : 'Não foi possível criar o perfil.');
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field label="Nome">
          <input name="name" placeholder="Ex.: Assistente pessoal" required maxLength={100} />
        </Field>
        <Field label="Instruções" hint="O que ele deve fazer e como deve se comportar.">
          <textarea
            name="instructions"
            rows={4}
            required
            maxLength={8000}
            placeholder="Ajude a organizar minhas tarefas e acompanhe decisões importantes."
          />
        </Field>
        <div className="form-grid">
          <Field label="Provider">
            <select name="provider">
              <option value="openai">OpenAI</option>
              <option value="anthropic">Anthropic</option>
              <option value="google">Google</option>
              <option value="openai-compatible">Compatível com OpenAI</option>
            </select>
          </Field>
          <Field label="Modelo">
            <input name="model" required placeholder="ID do modelo" maxLength={160} />
          </Field>
        </div>
        <Field
          label="URL do provider"
          hint="Obrigatória para providers compatíveis com OpenAI; opcional nos demais."
        >
          <input name="baseURL" type="url" placeholder="https://seu-provider.com/v1" />
        </Field>
        <p className="note">
          Depois de criar, cadastre a chave do provider para habilitar as conversas.
        </p>
        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
        <footer>
          <Button variant="secondary" onClick={close}>
            Cancelar
          </Button>
          <Button type="submit" busy={busy}>
            <Plus size={16} />
            Criar perfil
          </Button>
        </footer>
      </form>
    </Modal>
  );
}

const policies: Array<{
  key: keyof Profile['contextPolicy'];
  label: string;
  min: number;
  max: number;
  hint: string;
}> = [
  {
    key: 'inputTokens',
    label: 'Janela de contexto',
    min: 4096,
    max: 128000,
    hint: 'Limite total por etapa, com reserva para a resposta.',
  },
  {
    key: 'outputTokens',
    label: 'Reserva de resposta',
    min: 256,
    max: 16000,
    hint: 'Máximo de tokens na resposta de cada etapa.',
  },
  {
    key: 'memoryTokens',
    label: 'Memórias relevantes',
    min: 0,
    max: 8000,
    hint: 'Somente memórias relacionadas à conversa entram no contexto.',
  },
  {
    key: 'historyTokens',
    label: 'Histórico anterior',
    min: 0,
    max: 32000,
    hint: 'O pedido atual é preservado mesmo com zero de histórico.',
  },
  {
    key: 'toolResultTokens',
    label: 'Resultado de ferramentas',
    min: 128,
    max: 8000,
    hint: 'Resultados maiores ficam disponíveis sob demanda.',
  },
  {
    key: 'maxSteps',
    label: 'Etapas por execução',
    min: 1,
    max: 30,
    hint: 'Limita o ciclo de decisões e ferramentas.',
  },
  {
    key: 'maxRunTokens',
    label: 'Tokens por execução',
    min: 8192,
    max: 1000000,
    hint: 'Orçamento acumulado da execução inteira.',
  },
];

export function ProfileEditor({
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
  const [provider, setProvider] = useState(profile.model.provider);
  const [policy, setPolicy] = useState(profile.contextPolicy);
  const [credential, setCredential] = useState(profile.model.credentialId ?? '');

  return (
    <>
      <SectionHeading
        title="Identidade e modelo"
        description="Dê uma direção ao perfil. Ela acompanha todas as suas conversas."
      />
      <form
        method="post"
        action="/ui/"
        onSubmit={(event) => {
          event.preventDefault();

          const form = new FormData(event.currentTarget);

          void mutate(
            () =>
              api.updateProfile(profile.id, {
                expectedVersion: profile.version,
                name: String(form.get('name')),
                instructions: String(form.get('instructions')),
                identity: {
                  role: String(form.get('role')),
                  tone: String(form.get('tone')),
                  goals: identityLines(String(form.get('goals'))),
                  boundaries: identityLines(String(form.get('boundaries'))),
                },
                model: {
                  provider,
                  modelId: String(form.get('model')),
                  ...(form.get('baseURL') ? { baseURL: String(form.get('baseURL')) } : {}),
                  ...(credential
                    ? { credentialId: credential }
                    : form.get('apiKeyEnv')
                      ? { apiKeyEnv: String(form.get('apiKeyEnv')) }
                      : {}),
                },
                contextPolicy: policy,
                allowSelfManagement: form.get('selfManagement') === 'on',
              }),
            'Perfil atualizado.',
          );
        }}
      >
        <div className="settings-section">
          <div className="settings-caption">
            <h2>Identidade</h2>
            <p>Um propósito claro, em qualquer canal.</p>
          </div>
          <div className="settings-fields">
            <Field label="Nome">
              <input name="name" defaultValue={profile.name} required maxLength={100} />
            </Field>
            <Field label="Instruções">
              <textarea
                name="instructions"
                defaultValue={profile.instructions}
                rows={5}
                required
                maxLength={8000}
              />
            </Field>
            <div className="form-grid">
              <Field label="Papel">
                <input
                  name="role"
                  defaultValue={profile.identity.role}
                  placeholder="Ex.: Assistente de pesquisa"
                  maxLength={1000}
                />
              </Field>
              <Field label="Tom">
                <input
                  name="tone"
                  defaultValue={profile.identity.tone}
                  placeholder="Ex.: Direto e amigável"
                  maxLength={1000}
                />
              </Field>
            </div>
            <Field label="Objetivos" hint="Um por linha; até 10.">
              <textarea name="goals" defaultValue={profile.identity.goals.join('\n')} rows={3} />
            </Field>
            <Field label="Limites" hint="Regras que o perfil deve respeitar, uma por linha.">
              <textarea
                name="boundaries"
                defaultValue={profile.identity.boundaries.join('\n')}
                rows={3}
              />
            </Field>
            <label className="check-row">
              <input
                name="selfManagement"
                type="checkbox"
                defaultChecked={profile.allowSelfManagement}
              />
              <span>
                <strong>Permitir autogerenciamento</strong>
                <small>
                  O agente pode atualizar sua identidade e skills. Providers e permissões continuam
                  sob seu controle.
                </small>
              </span>
            </label>
          </div>
        </div>
        <div className="settings-section">
          <div className="settings-caption">
            <h2>Inteligência</h2>
            <p>Escolha quem processa as conversas.</p>
          </div>
          <div className="settings-fields">
            <div className="form-grid">
              <Field label="Provider">
                <select
                  value={provider}
                  onChange={(event) => setProvider(event.target.value as typeof provider)}
                >
                  <option value="openai">OpenAI</option>
                  <option value="anthropic">Anthropic</option>
                  <option value="google">Google</option>
                  <option value="openai-compatible">Compatível com OpenAI</option>
                </select>
              </Field>
              <Field label="Modelo">
                <input name="model" defaultValue={profile.model.modelId} required maxLength={160} />
              </Field>
            </div>
            <Field
              label="Credencial do provider"
              hint="Cadastre a chave em Credenciais. O valor secreto nunca é devolvido pela API."
            >
              <select value={credential} onChange={(event) => setCredential(event.target.value)}>
                <option value="">Selecionar credencial</option>
                {data.credentials
                  .filter((item) => item.kind === 'provider' && !item.revokedAt)
                  .map((item) => (
                    <option value={item.id} key={item.id}>
                      {item.label}
                    </option>
                  ))}
              </select>
            </Field>
            <Field label="URL do provider" hint="Use para um endpoint personalizado.">
              <input
                name="baseURL"
                type="url"
                defaultValue={profile.model.baseURL ?? ''}
                required={provider === 'openai-compatible'}
              />
            </Field>
            {!credential && (
              <Field
                label="Variável de ambiente da chave"
                hint="Alternativa para chaves configuradas no servidor. Deve começar com ELOS_PROVIDER_."
              >
                <input
                  name="apiKeyEnv"
                  defaultValue={profile.model.apiKeyEnv ?? ''}
                  placeholder="ELOS_PROVIDER_OPENAI"
                  pattern="ELOS_PROVIDER_[A-Z0-9_]+"
                />
              </Field>
            )}
          </div>
        </div>
        <div className="settings-section">
          <div className="settings-caption">
            <h2>Contexto e consumo</h2>
            <p>Controle o que entra em cada conversa e quanto o perfil pode gastar em tokens.</p>
            <SlidersHorizontal size={24} className="muted" />
          </div>
          <div className="settings-fields">
            <div className="form-grid">
              {policies.map((item) => (
                <Field key={item.key} label={item.label} hint={item.hint}>
                  <input
                    type="number"
                    required
                    min={item.min}
                    max={item.max}
                    value={policy[item.key]}
                    onChange={(event) =>
                      setPolicy({ ...policy, [item.key]: Number(event.target.value) })
                    }
                  />
                </Field>
              ))}
            </div>
          </div>
        </div>
        <div className="save-bar">
          <span>
            <Check size={15} />
            Alterações valem para novas execuções
          </span>
          <Button type="submit" busy={busy}>
            <Save size={16} />
            Salvar perfil
          </Button>
        </div>
      </form>
    </>
  );
}
