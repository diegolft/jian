'use client';

import { BookOpen, Pencil, Plug, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { lines } from '../../lib/format';
import type { SectionProps } from '../props';
import { Button, Confirm, Empty, Field, Modal, SectionHeading } from '../ui';
import { BuiltinSkills } from './built-in';
import { SkillCatalog } from './catalog';
import { SkillImport } from './import';

export function Capabilities({
  kind,
  profile,
  api,
  mutate,
  busy,
}: Omit<SectionProps, 'data'> & { kind: 'skills' | 'mcpServers' }) {
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
      {isSkill && <SkillImport profile={profile} api={api} mutate={mutate} busy={busy} />}
      {isSkill && <BuiltinSkills profile={profile} api={api} mutate={mutate} busy={busy} />}
      {isSkill && <h2 className="mb-4 text-2xl">Importadas</h2>}
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
                {isSkill && profile.skills[index]?.origin && (
                  <div className="tag-list">
                    <a href={profile.skills[index].origin.url} target="_blank" rel="noreferrer">
                      Importada de {new URL(profile.skills[index].origin.url).pathname.slice(1)}
                    </a>
                  </div>
                )}
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
      ) : isSkill ? (
        <p className="rounded-md bg-surface px-5 py-4 text-sm">
          Nenhuma skill instalada. Escolha no catálogo abaixo ou importe do seu repositório.
        </p>
      ) : (
        <Empty title="Ferramentas, com limites claros">
          Adicione um endpoint MCP HTTP e a lista de ferramentas autorizadas para este perfil.
        </Empty>
      )}
      {isSkill && <SkillCatalog profile={profile} api={api} mutate={mutate} busy={busy} />}
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
                    ...(form.get('token') ? { bearerToken: String(form.get('token')) } : {}),
                    ...(form.get('env') ? { bearerTokenEnv: String(form.get('env')) } : {}),
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
                <Field
                  label="Token do servidor"
                  hint={
                    editing === 'new'
                      ? 'Fica criptografado no Gateway e não aparece novamente.'
                      : 'Deixe em branco para manter o token atual.'
                  }
                >
                  <input name="token" type="password" autoComplete="off" maxLength={16000} />
                </Field>
                <Field
                  label="Variável de ambiente (alternativa)"
                  hint="Usada somente quando nenhum token é informado."
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
