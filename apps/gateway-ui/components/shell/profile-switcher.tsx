'use client';

import { ChevronDown, Plus } from 'lucide-react';
import { useWorkspace } from '../../lib/workspace';
import { Avatar } from '../profile/avatar-field';

export function ProfileSwitcher({ onCreate }: { onCreate: () => void }) {
  const { profiles, profile, selected, select, busy } = useWorkspace();

  return (
    <div className="profile-selector">
      <label htmlFor="profile-picker">SEU ESPAÇO</label>
      <div>
        <Avatar name={profile?.name} avatar={profile?.avatar} className="mini-avatar" />
        <select
          id="profile-picker"
          value={selected}
          disabled={busy}
          onChange={(event) => select(event.target.value)}
          aria-label="Perfil ativo"
        >
          {profiles.length ? (
            profiles.map((item) => (
              <option value={item.id} key={item.id}>
                {item.name}
              </option>
            ))
          ) : (
            <option value="">Nenhum perfil</option>
          )}
        </select>
        <ChevronDown size={14} />
      </div>
      <button type="button" className="new-profile" onClick={onCreate}>
        <Plus size={14} />
        Novo perfil
      </button>
    </div>
  );
}
