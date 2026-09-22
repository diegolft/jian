'use client';

import { BookOpen, KeyRound, LockKeyhole, Pencil, Plug, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import {
  date,
  type GatewayApi,
  lines,
  type Memory,
  type Mutation,
  type NewCredential,
  type NewKey,
  type Profile,
  type ProfileData,
} from '../lib/api';
import { Badge, Button, Confirm, Empty, Field, Modal, Secret, SectionHeading } from './ui';

type Props = {
  profile: Profile;
  data: ProfileData;
  api: GatewayApi;
  mutate: Mutation;
  busy: boolean;
};

export function Credentials({ profile, data, api, mutate, busy }: Props) {
  const [creating, setCreating] = useState(false);
  const [revoking, setRevoking] = useState<string>();
  const [failed, setFailed] = useState(false);

  return (
    <>
      <SectionHeading
        title="Credenciais"
        description="Chaves dos serviços, criptografadas no Gateway e isoladas por perfil."
        action={
          <Button
            onClick={() => {
              setFailed(false);
              setCreating(true);
            }}
          >
            <Plus size={16} />
            Nova credencial
          </Button>
        }
      />
      <div className="notice">
        <LockKeyhole size={18} />
        <p>
          Os valores secretos nunca são exibidos novamente. Para substituir uma chave, crie outra
          credencial e atualize a conexão que a utiliza.
        </p>
      </div>
      {data.credentials.length ? (
        <div className="resource-list">
          {data.credentials.map((item) => (
            <article className="resource-row" key={item.id}>
              <div className="resource-icon">
                <KeyRound size={20} />
              </div>
              <div className="grow">
                <h3>{item.label}</h3>
                <p>
                  {item.kind} · criada em {date(item.createdAt)}
                </p>
              </div>
              <Badge tone={item.revokedAt ? 'neutral' : 'good'}>
                {item.revokedAt ? 'Revogada' : 'Disponível'}
              </Badge>
              {!item.revokedAt && (
                <Button
                  variant="quiet"
                  onClick={() => setRevoking(item.id)}
                  aria-label={`Revogar ${item.label}`}
                >
                  <Trash2 size={16} />
                </Button>
              )}
            </article>
          ))}
        </div>
      ) : (
        <Empty title="Seus serviços começam aqui">
          Adicione a chave do provider, do Telegram ou de um servidor MCP.
        </Empty>
      )}
      {creating && (
        <Modal title="Nova credencial" close={() => setCreating(false)}>
          <form
            method="post"
            action="/ui/"
            onSubmit={async (event) => {
              event.preventDefault();

              const form = new FormData(event.currentTarget);

              const ok = await mutate(
                () =>
                  api.createCredential(profile.id, {
                    label: String(form.get('label')),
                    kind: form.get('kind') as NewCredential['kind'],
                    secret: String(form.get('secret')),
                  }),
                'Credencial armazenada.',
              );

              setFailed(!ok);

              if (ok) {
                setCreating(false);
              }
            }}
          >
            <Field label="Nome">
              <input name="label" required maxLength={100} placeholder="Ex.: OpenAI pessoal" />
            </Field>
            <Field label="Uso">
              <select name="kind">
                <option value="provider">Provider de IA</option>
                <option value="channel">Canal (Telegram)</option>
                <option value="mcp">Servidor MCP</option>
              </select>
            </Field>
            <Field label="Chave secreta">
              <input name="secret" type="password" required maxLength={16000} autoComplete="off" />
            </Field>
            {failed && (
              <p className="form-error" role="alert">
                Não foi possível salvar. Confira os campos e sua conexão.
              </p>
            )}
            <footer>
              <Button variant="secondary" onClick={() => setCreating(false)}>
                Cancelar
              </Button>
              <Button type="submit" busy={busy}>
                Armazenar credencial
              </Button>
            </footer>
          </form>
        </Modal>
      )}
      {revoking && (
        <Confirm
          title="Revogar credencial?"
          description="As conexões que usam esta chave deixarão de funcionar. Esta ação não pode ser desfeita."
          busy={busy}
          close={() => setRevoking(undefined)}
          confirm={async () => {
            if (
              await mutate(() => api.revokeCredential(profile.id, revoking), 'Credencial revogada.')
            ) {
              setRevoking(undefined);
            }
          }}
        />
      )}
    </>
  );
}

const scopes: Array<{ value: NewKey['scopes'][number]; title: string; description: string }> = [
  { value: 'read', title: 'Consultar', description: 'Ler as informações deste perfil.' },
  { value: 'chat', title: 'Conversar', description: 'Criar sessões e enviar mensagens.' },
  {
    value: 'memory:write',
    title: 'Escrever memórias',
    description: 'Criar e atualizar memórias persistentes.',
  },
  {
    value: 'profile:write',
    title: 'Editar identidade',
    description: 'Alterar identidade e skills do perfil.',
  },
];

export function AccessKeys({ profile, data, api, mutate, busy }: Props) {
  const [creating, setCreating] = useState(false);
  const [revoking, setRevoking] = useState<string>();
  const [secret, setSecret] = useState<string>();
  const [failed, setFailed] = useState(false);

  return (
    <>
      <SectionHeading
        title="Chaves de acesso"
        description="Conecte apps a este perfil com permissões e validade definidas."
        action={
          <Button
            onClick={() => {
              setFailed(false);
              setCreating(true);
            }}
          >
            <Plus size={16} />
            Nova chave
          </Button>
        }
      />
      {data.keys.length ? (
        <div className="resource-list">
          {data.keys.map((item) => (
            <article className="resource-row" key={item.id}>
              <div className="resource-icon">
                <KeyRound size={20} />
              </div>
              <div className="grow">
                <h3>
                  {item.label} <code>{item.prefix}…</code>
                </h3>
                <p>
                  {item.scopes.join(' · ')} · expira em {date(item.expiresAt)}
                </p>
              </div>
              <Badge
                tone={
                  item.revokedAt || Date.parse(item.expiresAt) <= Date.now() ? 'neutral' : 'good'
                }
              >
                {item.revokedAt
                  ? 'Revogada'
                  : Date.parse(item.expiresAt) <= Date.now()
                    ? 'Expirada'
                    : 'Ativa'}
              </Badge>
              {!item.revokedAt && (
                <Button
                  variant="quiet"
                  aria-label={`Revogar ${item.label}`}
                  onClick={() => setRevoking(item.id)}
                >
                  <Trash2 size={16} />
                </Button>
              )}
            </article>
          ))}
        </div>
      ) : (
        <Empty title="Acesso sob seu controle">
          Crie chaves para apps e integrações. Cada chave acessa apenas este perfil.
        </Empty>
      )}
      {creating && (
        <Modal title="Nova chave de acesso" close={() => setCreating(false)}>
          <form
            method="post"
            action="/ui/"
            onSubmit={async (event) => {
              event.preventDefault();

              const form = new FormData(event.currentTarget);

              const ok = await mutate(async () => {
                const issued = await api.issueKey(profile.id, {
                  label: String(form.get('label')),
                  scopes: form.getAll('scopes') as NewKey['scopes'],
                  expiresAt: new Date(String(form.get('expires'))).toISOString(),
                });

                setSecret(issued.token);
              }, 'Chave criada.');

              setFailed(!ok);

              if (ok) {
                setCreating(false);
              }
            }}
          >
            <Field label="Nome">
              <input name="label" required maxLength={100} placeholder="Ex.: App do Mac" />
            </Field>
            <Field label="Expiração">
              <input name="expires" type="datetime-local" required />
            </Field>
            <fieldset>
              <legend>Permissões</legend>
              {scopes.map((scope) => (
                <label key={scope.value} className="check-row">
                  <input
                    type="checkbox"
                    name="scopes"
                    value={scope.value}
                    defaultChecked={scope.value === 'read'}
                  />
                  <span>
                    <strong>{scope.title}</strong>
                    <small>{scope.description}</small>
                  </span>
                </label>
              ))}
            </fieldset>
            {failed && (
              <p className="form-error" role="alert">
                Defina uma data futura e ao menos uma permissão.
              </p>
            )}
            <footer>
              <Button variant="secondary" onClick={() => setCreating(false)}>
                Cancelar
              </Button>
              <Button type="submit" busy={busy}>
                Gerar chave
              </Button>
            </footer>
          </form>
        </Modal>
      )}
      {secret && !creating && (
        <Secret title="Sua chave de acesso" value={secret} close={() => setSecret(undefined)} />
      )}
      {revoking && (
        <Confirm
          title="Revogar chave?"
          description="Os apps que usam esta chave perderão acesso imediatamente."
          busy={busy}
          close={() => setRevoking(undefined)}
          confirm={async () => {
            if (await mutate(() => api.revokeKey(profile.id, revoking), 'Chave revogada.')) {
              setRevoking(undefined);
            }
          }}
        />
      )}
    </>
  );
}

export function Memories({ profile, data, api, mutate, busy }: Props) {
  const [editing, setEditing] = useState<Memory | 'new'>();
  const [failed, setFailed] = useState(false);

  return (
    <>
      <SectionHeading
        title="Memórias"
        description="Conhecimento persistente, compartilhado entre as conversas deste perfil."
        action={
          <Button
            onClick={() => {
              setFailed(false);
              setEditing('new');
            }}
          >
            <Plus size={16} />
            Nova memória
          </Button>
        }
      />
      <div className="notice">
        <BookOpen size={18} />
        <p>
          O Gateway seleciona as memórias relevantes para cada pedido. O orçamento acompanha o
          modelo escolhido para a execução.
        </p>
      </div>
      {data.memories.length ? (
        <div className="memory-grid">
          {data.memories.map((item) => (
            <article className="memory-card" key={item.key}>
              <header>
                <code>{item.key}</code>
                <Button
                  variant="quiet"
                  aria-label={`Editar ${item.key}`}
                  onClick={() => {
                    setFailed(false);
                    setEditing(item);
                  }}
                >
                  <Pencil size={16} />
                </Button>
              </header>
              <p>{item.content}</p>
              <small>
                Versão {item.version} · {date(item.updatedAt)}
              </small>
            </article>
          ))}
        </div>
      ) : (
        <Empty title="Um lugar para o que importa">
          Guarde preferências, decisões e informações que devem continuar entre sessões.
        </Empty>
      )}
      {editing && (
        <Modal
          title={editing === 'new' ? 'Nova memória' : 'Editar memória'}
          close={() => setEditing(undefined)}
        >
          <form
            method="post"
            action="/ui/"
            onSubmit={async (event) => {
              event.preventDefault();

              const form = new FormData(event.currentTarget);

              const ok = await mutate(
                () =>
                  api.remember(
                    profile.id,
                    String(form.get('key')),
                    String(form.get('content')),
                    editing === 'new' ? 0 : editing.version,
                  ),
                'Memória salva.',
              );

              setFailed(!ok);

              if (ok) {
                setEditing(undefined);
              }
            }}
          >
            <Field label="Identificador" hint="Letras minúsculas, números, hífen e sublinhado.">
              <input
                name="key"
                required
                pattern="[a-z0-9_-]{1,100}"
                defaultValue={editing === 'new' ? '' : editing.key}
                readOnly={editing !== 'new'}
              />
            </Field>
            <Field label="Conteúdo">
              <textarea
                name="content"
                required
                rows={8}
                maxLength={4000}
                defaultValue={editing === 'new' ? '' : editing.content}
              />
            </Field>
            {failed && (
              <p className="form-error" role="alert">
                Não foi possível salvar. Feche e atualize para verificar a versão mais recente.
              </p>
            )}
            <footer>
              <Button variant="secondary" onClick={() => setEditing(undefined)}>
                Cancelar
              </Button>
              <Button type="submit" busy={busy}>
                Salvar memória
              </Button>
            </footer>
          </form>
        </Modal>
      )}
    </>
  );
}

export function Capabilities({
  kind,
  profile,
  data,
  api,
  mutate,
  busy,
}: Props & { kind: 'skills' | 'mcpServers' }) {
  const [editing, setEditing] = useState<number | 'new'>();
  const [removing, setRemoving] = useState<number>();
  const [failed, setFailed] = useState(false);
  const isSkill = kind === 'skills';
  const items = profile[kind];
  const skill = typeof editing === 'number' && isSkill ? profile.skills[editing] : undefined;
  const mcp = typeof editing === 'number' && !isSkill ? profile.mcpServers[editing] : undefined;

  return (
    <>
      <SectionHeading
        title={isSkill ? 'Skills' : 'Servidores MCP'}
        description={
          isSkill
            ? 'Instruções especializadas, carregadas pelo agente quando necessárias.'
            : 'Conecte ferramentas e escolha explicitamente o que o agente pode executar.'
        }
        action={
          <Button
            onClick={() => {
              setFailed(false);
              setEditing('new');
            }}
            disabled={items.length >= (isSkill ? 20 : 10)}
          >
            <Plus size={16} />
            {isSkill ? 'Nova skill' : 'Conectar servidor'}
          </Button>
        }
      />
      {items.length ? (
        <div className="resource-list">
          {items.map((item, index) => (
            <article className="resource-row" key={item.name}>
              <div className="resource-icon">
                {isSkill ? <BookOpen size={20} /> : <Plug size={20} />}
              </div>
              <div className="grow">
                <h3>{item.name}</h3>
                <p>{'description' in item ? item.description : item.url}</p>
                {'allowedTools' in item && (
                  <div className="tag-list">
                    {item.allowedTools.map((tool) => (
                      <code key={tool}>{tool}</code>
                    ))}
                  </div>
                )}
              </div>
              <Button
                variant="quiet"
                aria-label={`Editar ${item.name}`}
                onClick={() => {
                  setFailed(false);
                  setEditing(index);
                }}
              >
                <Pencil size={16} />
              </Button>
              <Button
                variant="quiet"
                aria-label={`Remover ${item.name}`}
                onClick={() => setRemoving(index)}
              >
                <Trash2 size={16} />
              </Button>
            </article>
          ))}
        </div>
      ) : (
        <Empty title={isSkill ? 'Ensine um jeito de fazer' : 'Ferramentas, com limites claros'}>
          {isSkill
            ? 'Uma skill descreve um procedimento que o agente pode consultar sem carregar todas as instruções em cada mensagem.'
            : 'Adicione um endpoint MCP HTTP e a lista de ferramentas autorizadas para este perfil.'}
        </Empty>
      )}
      {editing !== undefined && (
        <Modal
          title={isSkill ? 'Configurar skill' : 'Configurar servidor MCP'}
          close={() => setEditing(undefined)}
        >
          <form
            method="post"
            action="/ui/"
            onSubmit={async (event) => {
              event.preventDefault();

              const form = new FormData(event.currentTarget);
              const name = String(form.get('name'));

              const next = isSkill
                ? {
                    name,
                    description: String(form.get('description')),
                    instructions: String(form.get('instructions')),
                  }
                : {
                    name,
                    url: String(form.get('url')),
                    allowedTools: lines(String(form.get('tools'))),
                    ...(form.get('credential')
                      ? { credentialId: String(form.get('credential')) }
                      : form.get('env')
                        ? { bearerTokenEnv: String(form.get('env')) }
                        : {}),
                  };

              const updated =
                editing === 'new'
                  ? [...items, next]
                  : items.map((item, index) => (index === editing ? next : item));

              const ok = await mutate(
                () =>
                  api.updateProfile(profile.id, {
                    expectedVersion: profile.version,
                    [kind]: updated,
                  }),
                'Configuração salva.',
              );

              setFailed(!ok);

              if (ok) {
                setEditing(undefined);
              }
            }}
          >
            <Field
              label="Nome"
              hint={
                isSkill
                  ? 'Letras minúsculas, números, hífen e sublinhado.'
                  : 'Letras minúsculas, números e sublinhado.'
              }
            >
              <input
                name="name"
                required
                pattern={isSkill ? '[a-z0-9_-]{1,64}' : '[a-z0-9_]{1,30}'}
                defaultValue={skill?.name ?? mcp?.name ?? ''}
              />
            </Field>
            {isSkill ? (
              <>
                <Field label="Descrição" hint="Ajuda o agente a decidir quando usar esta skill.">
                  <input
                    name="description"
                    required
                    maxLength={300}
                    defaultValue={skill?.description ?? ''}
                  />
                </Field>
                <Field label="Instruções">
                  <textarea
                    name="instructions"
                    required
                    rows={9}
                    maxLength={12000}
                    defaultValue={skill?.instructions ?? ''}
                  />
                </Field>
              </>
            ) : (
              <>
                <Field label="Endpoint HTTP">
                  <input
                    name="url"
                    type="url"
                    required
                    defaultValue={mcp?.url ?? ''}
                    placeholder="https://mcp.exemplo.com/mcp"
                  />
                </Field>
                <Field
                  label="Ferramentas permitidas"
                  hint="Nomes exatos, um por linha. Até 30 ferramentas."
                >
                  <textarea
                    name="tools"
                    rows={4}
                    required
                    defaultValue={mcp?.allowedTools.join('\n') ?? ''}
                  />
                </Field>
                <Field label="Credencial">
                  <select name="credential" defaultValue={mcp?.credentialId ?? ''}>
                    <option value="">Sem credencial armazenada</option>
                    {data.credentials
                      .filter((item) => item.kind === 'mcp' && !item.revokedAt)
                      .map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.label}
                        </option>
                      ))}
                  </select>
                </Field>
                <Field
                  label="Variável de ambiente (alternativa)"
                  hint="Usada somente quando nenhuma credencial está selecionada."
                >
                  <input
                    name="env"
                    pattern="JIAN_MCP_[A-Z0-9_]+"
                    defaultValue={mcp?.bearerTokenEnv ?? ''}
                    placeholder="JIAN_MCP_SERVICO"
                  />
                </Field>
              </>
            )}
            {failed && (
              <p role="alert" className="form-error">
                Não foi possível salvar. Confira os campos ou atualize o perfil.
              </p>
            )}
            <footer>
              <Button variant="secondary" onClick={() => setEditing(undefined)}>
                Cancelar
              </Button>
              <Button type="submit" busy={busy}>
                Salvar {isSkill ? 'skill' : 'servidor'}
              </Button>
            </footer>
          </form>
        </Modal>
      )}
      {removing !== undefined && (
        <Confirm
          title={isSkill ? 'Remover skill?' : 'Desconectar servidor?'}
          description="Esta capacidade deixará de estar disponível nas próximas execuções."
          busy={busy}
          close={() => setRemoving(undefined)}
          confirm={async () => {
            if (
              await mutate(
                () =>
                  api.updateProfile(profile.id, {
                    expectedVersion: profile.version,
                    [kind]: items.filter((_, index) => index !== removing),
                  }),
                'Configuração removida.',
              )
            ) {
              setRemoving(undefined);
            }
          }}
        />
      )}
    </>
  );
}
