'use client';

import { ArrowUpRight, Check, Download, LoaderCircle, Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { GatewayApi } from '../../lib/api';
import type { SectionProps } from '../props';
import { Button, Confirm } from '../ui';

const sources = [
  {
    id: 'claude',
    name: 'Claude',
    publisher: 'Anthropic',
    url: 'https://github.com/anthropics/skills/tree/main/skills',
  },
  {
    id: 'codex',
    name: 'Codex',
    publisher: 'OpenAI',
    url: 'https://github.com/openai/skills/tree/main/skills/.curated',
  },
] as const;
type Entry = Awaited<ReturnType<GatewayApi['skillCatalog']>>['entries'][number];

export function SkillCatalog({
  profile,
  api,
  mutate,
  busy,
}: Pick<SectionProps, 'profile' | 'api' | 'mutate' | 'busy'>) {
  const [source, setSource] = useState<(typeof sources)[number]>(sources[0]);
  const [catalogs, setCatalogs] = useState<Record<string, Entry[]>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [retry, setRetry] = useState(0);
  const [replacing, setReplacing] = useState<Entry>();
  const entries = catalogs[source.id];
  // biome-ignore lint/correctness/useExhaustiveDependencies: Retry explicitly restarts a failed read.
  useEffect(() => {
    if (entries) {
      setLoading(false);
      setError('');
      return;
    }
    let alive = true;
    setLoading(true);
    setError('');
    api
      .skillCatalog(profile.id, source.url)
      .then((catalog) => {
        if (alive) setCatalogs((current) => ({ ...current, [source.id]: catalog.entries }));
      })
      .catch((failure) => {
        if (alive)
          setError(
            failure instanceof Error ? failure.message : 'Não foi possível carregar o catálogo.',
          );
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [api, profile.id, source, entries, retry]);
  const importEntry = async (entry: Entry) => {
    if (
      await mutate(() => api.importSkill(profile.id, entry.url), `Skill ${entry.name} importada.`)
    )
      setReplacing(undefined);
  };
  const filtered = (entries ?? []).filter((entry) =>
    `${entry.name} ${entry.description}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
  );
  return (
    <section className="skill-marketplace" aria-label="Catálogos de skills">
      <header className="section-row">
        <div>
          <h2>Explorar skills</h2>
          <p className="mt-1 text-sm">Catálogos oficiais, prontos para adicionar ao perfil.</p>
        </div>
        <span className="text-xs text-muted">{profile.skills.length}/20 instaladas</span>
      </header>
      <div className="catalog-toolbar">
        <fieldset className="catalog-sources">
          <legend className="sr-only">Origem das skills</legend>
          {sources.map((item) => (
            <button
              type="button"
              key={item.id}
              aria-pressed={source.id === item.id}
              onClick={() => {
                setSource(item);
                setQuery('');
              }}
            >
              <strong>{item.name}</strong>
              <small>{item.publisher}</small>
            </button>
          ))}
        </fieldset>
        <div className="search-field">
          <Search size={16} />
          <input
            aria-label="Buscar skills no catálogo"
            placeholder="Buscar skills…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
      </div>
      <p className="catalog-note">
        Importa as instruções do SKILL.md. Scripts e arquivos auxiliares não são instalados.
      </p>
      {loading ? (
        <div className="catalog-loading" role="status">
          <LoaderCircle size={20} className="spin" />
          Carregando {source.name}…
        </div>
      ) : error ? (
        <div className="history-error" role="alert">
          <p>{error}</p>
          <Button variant="secondary" onClick={() => setRetry((value) => value + 1)}>
            Tentar novamente
          </Button>
        </div>
      ) : filtered.length ? (
        <div className="skill-catalog-grid">
          {filtered.map((entry) => {
            const existing = profile.skills.find((skill) => skill.name === entry.name);
            const installed =
              existing?.origin?.url.replace(/\/(?:SKILL\.md)?$/, '') ===
              entry.url.replace(/\/(?:SKILL\.md)?$/, '');
            return (
              <article className="skill-catalog-card" key={entry.url}>
                <div className="skill-catalog-title">
                  <h3>{entry.name}</h3>
                  <a
                    href={entry.url}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={`Ver origem de ${entry.name}`}
                  >
                    <ArrowUpRight size={16} />
                  </a>
                </div>
                {entry.description !== 'Skill in this repository' && <p>{entry.description}</p>}
                <footer>
                  <span>{source.publisher}</span>
                  <Button
                    variant="quiet"
                    disabled={busy || installed || (!existing && profile.skills.length >= 20)}
                    onClick={() => (existing ? setReplacing(entry) : void importEntry(entry))}
                  >
                    {installed ? <Check size={14} /> : <Download size={14} />}
                    {installed ? 'Instalada' : existing ? 'Substituir' : 'Adicionar'}
                  </Button>
                </footer>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="catalog-loading">Nenhuma skill encontrada.</div>
      )}
      {replacing && (
        <Confirm
          title={`Substituir ${replacing.name}?`}
          description="Já existe uma skill com esse nome no perfil. As instruções atuais serão substituídas pelas do catálogo."
          busy={busy}
          close={() => setReplacing(undefined)}
          confirm={() => void importEntry(replacing)}
        />
      )}
    </section>
  );
}
