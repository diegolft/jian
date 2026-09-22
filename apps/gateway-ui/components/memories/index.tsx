'use client';

import { BookOpen, Trash2 } from 'lucide-react';
import { useState } from 'react';
import type { Memory } from '../../lib/api';
import { date } from '../../lib/format';
import type { SectionProps } from '../props';
import { Button, Confirm, Empty, Field, SectionHeading } from '../ui';

export function Memories({ profile, data, api, mutate, busy }: SectionProps) {
  const [query, setQuery] = useState('');
  const [removing, setRemoving] = useState<Memory>();
  const terms = query.trim().toLowerCase();

  const found = data.memories.filter((item) =>
    terms ? `${item.key} ${item.content}`.toLowerCase().includes(terms) : true,
  );

  return (
    <>
      <SectionHeading
        title="Memórias"
        description="O que o agente guardou entre as conversas deste perfil."
      />
      <div className="notice">
        <BookOpen size={18} />
        <p>
          Só o agente escreve aqui, pelas próprias ferramentas. Você lê o que ele guardou e apaga o
          que estiver errado — uma memória errada se repete em toda sessão nova.
        </p>
      </div>
      <Field label="Buscar">
        <input
          type="search"
          value={query}
          placeholder="Identificador ou conteúdo"
          onChange={(event) => setQuery(event.target.value)}
        />
      </Field>
      {found.length ? (
        <div className="memory-grid">
          {found.map((item) => (
            <article className="memory-card" key={item.key}>
              <header>
                <code>{item.key}</code>
                <Button
                  variant="quiet"
                  aria-label={`Apagar ${item.key}`}
                  onClick={() => setRemoving(item)}
                >
                  <Trash2 size={16} />
                </Button>
              </header>
              <p>{item.content}</p>
              <small>
                Versão {item.version} · {date(item.updatedAt)}
              </small>
            </article>
          ))}
        </div>
      ) : data.memories.length ? (
        <Empty title="Nada encontrado">Nenhuma memória combina com essa busca.</Empty>
      ) : (
        <Empty title="Um lugar para o que importa">
          O agente ainda não guardou nada. O que ele registrar nas conversas aparece aqui.
        </Empty>
      )}
      {removing && (
        <Confirm
          title="Apagar memória?"
          description="O agente deixa de ler este registro nas próximas execuções. Não é possível desfazer."
          busy={busy}
          close={() => setRemoving(undefined)}
          confirm={async () => {
            if (await mutate(() => api.forget(profile.id, removing.key), 'Memória apagada.')) {
              setRemoving(undefined);
            }
          }}
        />
      )}
    </>
  );
}

/**
 * Import copies the instructions once; the repository is provenance, not a live link. Naming
 * that in the form keeps the owner from expecting a skill to follow upstream on its own.
 */
