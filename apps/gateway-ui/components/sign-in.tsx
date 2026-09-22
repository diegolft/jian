'use client';

import {
  ArrowRight,
  BookOpen,
  CircleHelp,
  LockKeyhole,
  MessageSquare,
  ShieldCheck,
  Smartphone,
} from 'lucide-react';
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
            jian<span className="brand-label">GATEWAY</span>
          </span>
        </a>
        <div className="login-copy">
          <span className="eyebrow">SEU AGENTE. EM TODA CONVERSA.</span>
          <h1>
            Muitas conversas.
            <br />
            Uma identidade.
          </h1>
          <p>
            Um lugar para conectar seus agentes, dar contexto às conversas e manter você no
            controle.
          </p>
          <div className="identity-orbit" aria-hidden="true">
            <span className="orbit-node node-one">
              <MessageSquare />
            </span>
            <span className="orbit-node node-two">
              <Smartphone />
            </span>
            <span className="orbit-center">
              <Mark />
            </span>
            <span className="orbit-node node-three">
              <BookOpen />
            </span>
          </div>
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
          <h2>Seu Gateway começa aqui.</h2>
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
            <ShieldCheck size={16} />O token não fica no navegador: a sessão vira um cookie
            assinado, ilegível por scripts, que expira em 30 dias.
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
