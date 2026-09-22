'use client';

import { ShieldQuestion, UserCheck, UserX } from 'lucide-react';
import type { Contact } from '../../lib/api';
import { date } from '../../lib/format';
import type { SectionProps } from '../props';
import { Badge, Button } from '../ui';
import { kinds } from './kinds';

export function Requests({ profile, data, api, mutate, busy }: SectionProps) {
  const pending = data.contacts.filter((contact) => contact.status === 'pending');

  if (!pending.length) {
    return null;
  }

  const decide = (contact: Contact, approve: boolean) =>
    mutate(
      () =>
        approve
          ? api.approveContact(profile.id, contact.id)
          : api.blockContact(profile.id, contact.id),
      approve
        ? 'Contato aprovado. A mensagem em espera seguiu para o agente.'
        : 'Contato bloqueado.',
    );

  return (
    <section className="request-panel">
      <header>
        <ShieldQuestion size={20} />
        <div className="grow">
          <h2>Solicitações de contato</h2>
          <p>Alguém novo escreveu. O agente só responde depois que você aprovar.</p>
        </div>
        <Badge tone="warn">{pending.length} aguardando</Badge>
      </header>
      {pending.map((contact) => (
        <article className="request-row" key={contact.id}>
          <div className="grow">
            <h3>
              {contact.scope === 'group' ? 'Grupo: ' : ''}
              {contact.displayName ?? contact.actorId}
            </h3>
            <small>
              {kinds.find((kind) => kind.type === contact.type)?.name} · {contact.actorId} ·{' '}
              {date(contact.createdAt)}
            </small>
            <p className="request-message">
              {contact.scope === 'group'
                ? 'Aprovar vale para o grupo inteiro. Dentro dele o agente só responde quando alguém escreve o nome dele.'
                : (contact.message ?? 'Sem mensagem em espera.')}
            </p>
          </div>
          <div className="row-actions">
            <Button variant="secondary" disabled={busy} onClick={() => void decide(contact, true)}>
              <UserCheck size={16} />
              Aprovar
            </Button>
            <Button
              variant="quiet"
              disabled={busy}
              aria-label={`Recusar ${contact.actorId}`}
              onClick={() => void decide(contact, false)}
            >
              <UserX size={17} />
            </Button>
          </div>
        </article>
      ))}
    </section>
  );
}
