'use client';

import { Download } from 'lucide-react';
import { useState } from 'react';
import type { SectionProps } from '../props';
import { Button, Field } from '../ui';

export function SkillImport({
  profile,
  api,
  mutate,
  busy,
}: Pick<SectionProps, 'profile' | 'api' | 'mutate' | 'busy'>) {
  const [url, setUrl] = useState('');

  return (
    <form
      className="skill-import"
      method="post"
      action="/ui/"
      onSubmit={async (event) => {
        event.preventDefault();

        if (!url.trim()) {
          return;
        }

        if (await mutate(() => api.importSkill(profile.id, url.trim()), 'Skill importada.')) {
          setUrl('');
        }
      }}
    >
      <Field
        label="Importar de um repositório"
        hint="Endereço no GitHub de uma skill ou de uma pasta de skills. As instruções são copiadas uma vez."
      >
        <input
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          placeholder="https://github.com/dono/repositorio/tree/main/skills/deploy"
          inputMode="url"
        />
      </Field>
      <Button type="submit" busy={busy} disabled={!url.trim()}>
        <Download size={16} />
        Importar
      </Button>
    </form>
  );
}
