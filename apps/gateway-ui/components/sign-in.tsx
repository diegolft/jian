'use client';

import { ArrowRight, CircleHelp, LockKeyhole, ShieldCheck } from 'lucide-react';
import { useEffect, useState } from 'react';
import { gatewayApi } from '../lib/api';
import { Button, Field, Mark } from './ui';

export function SignIn({ connected }: { connected: () => void }) {
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');

  // The static login must not submit a secret before React has attached its handler.
  useEffect(() => setReady(true), []);

  return (
    <main className="login-layout">
      <section className="login-story">
        <a className="brand" href="/ui/">
          <Mark />
          <span>
            jian<span className="brand-label">比翼の鳥</span>
          </span>
        </a>
        <div className="login-copy">
          <div className="login-emblem" aria-hidden="true">
            <Mark />
          </div>
          <h1>
            Seu espaço.
            <br />
            Seus agentes.
          </h1>
          <p>Conversas, memória e ferramentas sob seu controle.</p>
        </div>
        <small>Aberto por natureza. Seu por completo.</small>
      </section>
      <section className="login-form-wrap">
        <form
          method="post"
          action="/ui/"
          className="login-form"
          onSubmit={async (event) => {
            event.preventDefault();
            setBusy(true);
            setError('');

            const token = String(new FormData(event.currentTarget).get('token')).trim();
            const api = gatewayApi();

            try {
              await api.signIn(token);
              await api.profiles();
              connected();
            } catch (error) {
              setError(
                error instanceof Error ? error.message : 'Não foi possível conectar ao Gateway.',
              );
            } finally {
              setBusy(false);
            }
          }}
        >
          <div className="login-lock">
            <LockKeyhole size={24} />
          </div>
          <h2>Conecte-se ao Jian.</h2>
          <p>Entre com o token de administrador desta instância.</p>
          <Field label="Token de administrador">
            <input
              name="token"
              type="password"
              placeholder="Cole seu token de acesso"
              autoComplete="off"
              required
              minLength={32}
              spellCheck={false}
            />
          </Field>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <Button type="submit" busy={busy} disabled={!ready}>
            Entrar no Gateway
            <ArrowRight size={17} />
          </Button>
          <p className="secure-note">
            <ShieldCheck size={16} />
            Seu token não é armazenado no navegador. A sessão expira em 30 dias.
          </p>
          <details className="login-help">
            <summary>
              <CircleHelp size={15} />
              Onde encontro meu token?
            </summary>
            <p>
              Use o valor de <code>JIAN_API_TOKEN</code> definido na configuração do servidor. É o
              único token que o Gateway aceita.
            </p>
          </details>
        </form>
      </section>
    </main>
  );
}
