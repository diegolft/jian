'use client';

import { Users } from 'lucide-react';
import type { SectionProps } from '../props';
import { Badge } from '../ui';
import { kinds } from './kinds';

export function Rooms({ profile, data }: SectionProps) {
  const rooms = data.groups.filter((group) =>
    group.profiles.some((item) => item.status === 'approved'),
  );

  if (!rooms.length) {
    return null;
  }

  return (
    <section className="subsection">
      <h2>Grupos</h2>
      <div className="resource-list">
        {rooms.map((room) => (
          <div className="resource-row" key={`${room.type}:${room.chatId}`}>
            <div className={`resource-icon ${room.type}`}>
              <Users size={20} />
            </div>
            <div className="grow">
              <h3>{room.name ?? room.chatId}</h3>
              <p>
                {kinds.find((kind) => kind.type === room.type)?.name} ·{' '}
                {room.profiles
                  .filter((item) => item.status === 'approved')
                  .map((item) =>
                    item.profileId === profile.id ? `${item.name} (este)` : item.name,
                  )
                  .join(', ')}
              </p>
            </div>
            <Badge
              tone={
                room.profiles.some((item) => item.profileId === profile.id) ? 'good' : 'neutral'
              }
            >
              {room.profiles.filter((item) => item.status === 'approved').length} agente(s)
            </Badge>
          </div>
        ))}
      </div>
      <p className="note">
        Num grupo com mais de um agente, cada um só responde quando a mensagem traz o nome dele. A
        conversa entre agentes tem limite de turnos e recomeça quando uma pessoa escreve.
      </p>
    </section>
  );
}
