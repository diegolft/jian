'use client';
import { Accessibility, Check, Palette, SlidersHorizontal } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { type Preference, preferenceOptions } from '../../lib/preferences';
import { ThemePicker } from '../shell/theme-picker';
import { Field, SectionHeading } from '../ui';
import { Select } from '../ui/select';

function PreferenceField({
  preference,
  label,
  hint,
  labels,
}: {
  preference: Preference;
  label: string;
  hint: string;
  labels: string[];
}) {
  const [value, setValue] = useState<string>(preferenceOptions[preference][0]);
  useEffect(() => {
    const sync = () =>
      setValue(document.documentElement.dataset[preference] ?? preferenceOptions[preference][0]);
    sync();
    const storage = (event: StorageEvent) => {
      if (event.key !== `jian.${preference}` && event.key !== null) return;
      const next =
        preferenceOptions[preference].find((option) => option === event.newValue) ??
        preferenceOptions[preference][0];
      document.documentElement.dataset[preference] = next;
      sync();
    };
    window.addEventListener('storage', storage);
    return () => window.removeEventListener('storage', storage);
  }, [preference]);
  return (
    <Field label={label} hint={hint}>
      <Select
        value={value}
        options={preferenceOptions[preference].map((option, index) => ({
          value: option,
          label: labels[index] ?? option,
        }))}
        onValueChange={(next) => {
          document.documentElement.dataset[preference] = next;
          setValue(next);
          try {
            localStorage.setItem(`jian.${preference}`, next);
            toast.success('Preferência salva.', { id: 'preference' });
          } catch {
            toast.error('Aplicado nesta sessão. O navegador não permitiu salvar a preferência.');
          }
        }}
      />
    </Field>
  );
}

export function Settings({ tab }: { tab: 'appearance' | 'accessibility' }) {
  return (
    <>
      <SectionHeading
        title="Configurações"
        description="Preferências deste navegador, para todos os seus perfis."
      />
      <nav className="settings-tabs" aria-label="Configurações">
        <Link href="/settings/appearance" aria-current={tab === 'appearance' ? 'page' : undefined}>
          <Palette size={16} />
          Aparência
        </Link>
        <Link
          href="/settings/accessibility"
          aria-current={tab === 'accessibility' ? 'page' : undefined}
        >
          <Accessibility size={16} />
          Acessibilidade
        </Link>
      </nav>
      {tab === 'appearance' ? (
        <section className="appearance-panel">
          <div className="section-row">
            <div>
              <h2>Cor de acento</h2>
              <p className="mt-1 text-sm">Cinco variações. O mesmo espaço de trabalho.</p>
            </div>
            <span className="preference-autosave">
              <Check size={14} />
              Salvo automaticamente
            </span>
          </div>
          <ThemePicker />
          <div className="appearance-note">
            <SlidersHorizontal size={18} />
            <p>
              O tema acompanha você ao trocar de perfil. As cores de alerta mantêm o mesmo
              significado.
            </p>
          </div>
        </section>
      ) : (
        <section className="accessibility-panel">
          <PreferenceField
            preference="motion"
            label="Movimento"
            hint="A preferência de reduzir movimento do sistema é sempre respeitada."
            labels={['Acompanhar o sistema', 'Reduzir animações']}
          />
          <PreferenceField
            preference="text"
            label="Tamanho do texto"
            hint="Amplia textos e controles em todo o painel."
            labels={['Padrão', 'Ampliado']}
          />
        </section>
      )}
    </>
  );
}
