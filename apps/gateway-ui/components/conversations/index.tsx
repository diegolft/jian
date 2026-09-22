'use client';

import { MessageSquare, Pencil, Plus } from 'lucide-react';
import { useState } from 'react';
import { date } from '../../lib/api';
import type { SectionProps } from '../props';
import { Button, Empty, Field, Modal, SectionHeading } from '../ui';
import { Conversation } from './conversation';

export function Sessions({ profile, data, api, mutate, busy }: SectionProps) {
  const [renaming, setRenaming] = useState<string>();
  const [selected, setSelected] = useState(data.sessions[0]?.id);
  const active = data.sessions.find((item) => item.id === selected);

  return (
    <>
      <SectionHeading
        title="Conversas"
        description="Sessões independentes, conectadas pela memória do perfil."
        action={
          <Button
            busy={busy}
            onClick={async () => {
              await mutate(async () => {
                const session = await api.createSession(profile.id, 'web');

                setSelected(session.id);
              }, 'Conversa criada.');
            }}
          >
            <Plus size={16} />
            Nova conversa
          </Button>
        }
      />
      {data.sessions.length ? (
        <div className="sessions-layout">
          <aside className="session-list" aria-label="Sessões">
            {data.sessions.map((item) => (
              <div
                className={`session-row ${selected === item.id ? 'selected' : ''}`}
                key={item.id}
              >
                <button
                  type="button"
                  onClick={() => setSelected(item.id)}
                  aria-pressed={selected === item.id}
                >
                  <MessageSquare size={17} />
                  <span>
                    <strong className={item.title ? '' : 'unnamed'}>
                      {item.title ?? 'Sem título'}
                    </strong>
                    <small>
                      {item.channel} · {date(item.createdAt)}
                    </small>
                  </span>
                </button>
                <Button
                  variant="quiet"
                  aria-label={`Renomear ${item.title ?? 'conversa sem título'}`}
                  onClick={() => setRenaming(item.id)}
                >
                  <Pencil size={15} />
                </Button>
              </div>
            ))}
          </aside>
          {active ? (
            <Conversation
              key={active.id}
              api={api}
              profileId={profile.id}
              sessionId={active.id}
              initialRun={data.activities.filter((run) => run.sessionId === active.id).at(-1)}
              data={data}
            />
          ) : (
            <Empty title="Selecione uma conversa">
              Escolha uma sessão ao lado para abrir o histórico.
            </Empty>
          )}
        </div>
      ) : (
        <Empty
          title="Tudo começa com uma conversa"
          action={
            <Button
              variant="secondary"
              busy={busy}
              onClick={async () => {
                await mutate(async () => {
                  const session = await api.createSession(profile.id, 'web');

                  setSelected(session.id);
                }, 'Conversa criada.');
              }}
            >
              Criar conversa
            </Button>
          }
        >
          Crie uma sessão para conversar pelo painel ou vinculá-la a um canal.
        </Empty>
      )}
      {renaming && (
        <Modal title="Renomear conversa" close={() => setRenaming(undefined)}>
          <form
            method="post"
            action="/ui/"
            onSubmit={async (event) => {
              event.preventDefault();

              const title = String(new FormData(event.currentTarget).get('title')).trim();

              if (
                title &&
                (await mutate(
                  () => api.renameSession(profile.id, renaming, title),
                  'Conversa renomeada.',
                ))
              ) {
                setRenaming(undefined);
              }
            }}
          >
            <Field label="Título">
              <input
                name="title"
                required
                maxLength={160}
                defaultValue={data.sessions.find((item) => item.id === renaming)?.title ?? ''}
                placeholder="Ex.: Planejamento da semana"
              />
            </Field>
            <footer>
              <Button variant="secondary" onClick={() => setRenaming(undefined)}>
                Cancelar
              </Button>
              <Button type="submit" busy={busy}>
                Salvar
              </Button>
            </footer>
          </form>
        </Modal>
      )}
    </>
  );
}
