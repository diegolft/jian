'use client';

import { Check, Plus, Save } from 'lucide-react';
import { useState } from 'react';
import type { GatewayApi, Mutation, Profile } from '../lib/api';
import { AvatarField } from './avatar-field';
import { Button, Field, Modal, SectionHeading } from './ui';

const lines = (value: string) =>
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
      description="Uma identidade para todas as conversas."
      close={close}
    >
      <form
        method="post"
        action="/ui/"
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          setError('');

          const form = new FormData(event.currentTarget);

          try {
            done(
              await api.createProfile({
                name: String(form.get('name')),
                instructions: String(form.get('instructions')),
                avatar: String(form.get('avatar')) || null,
              }),
            );
          } catch (error) {
            setError(error instanceof Error ? error.message : 'Não foi possível criar o perfil.');
          } finally {
            setBusy(false);
          }
        }}
      >
        <AvatarField name="avatar" />
        <Field label="Nome">
          <input name="name" required maxLength={100} placeholder="Ex.: Assistente pessoal" />
        </Field>
        <Field label="Instruções" hint="Descreva propósito, papel, tom e objetivos.">
          <textarea
            name="instructions"
            rows={5}
            required
            maxLength={8000}
            placeholder="Ajude a organizar minhas tarefas e acompanhar decisões."
          />
        </Field>
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

export function ProfileEditor({
  profile,
  api,
  mutate,
  busy,
}: {
  profile: Profile;
  api: GatewayApi;
  mutate: Mutation;
  busy: boolean;
}) {
  const legacyIdentity = [
    profile.identity.role && `Papel: ${profile.identity.role}`,
    profile.identity.tone && `Tom: ${profile.identity.tone}`,
    ...profile.identity.goals.map((goal) => `Objetivo: ${goal}`),
  ].filter(Boolean);
  const instructions = [profile.instructions, ...legacyIdentity].join('\n\n');

  return (
    <>
      <SectionHeading
        title="Identidade"
        description="Instruções compartilhadas entre todas as sessões."
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
                summary: String(form.get('summary')),
                avatar: String(form.get('avatar')) || null,
                identity: {
                  role: '',
                  tone: '',
                  goals: [],
                  boundaries: lines(String(form.get('boundaries'))),
                },
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
            <AvatarField name="avatar" profileName={profile.name} current={profile.avatar} />
            <Field label="Nome">
              <input name="name" defaultValue={profile.name} required maxLength={100} />
            </Field>
            <Field label="Instruções">
              <textarea
                name="instructions"
                defaultValue={instructions}
                rows={8}
                required
                maxLength={8000}
              />
            </Field>
            <Field
              label="Resumo para a equipe"
              hint="Uma linha sobre o que este agente faz. É tudo o que os outros perfis veem dele."
            >
              <input
                name="summary"
                defaultValue={profile.summary}
                maxLength={280}
                placeholder="Ex.: Cuida das entregas e sabe o estado de cada uma."
              />
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
