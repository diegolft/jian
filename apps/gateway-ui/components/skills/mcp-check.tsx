'use client';

import { CheckCircle2, Plug, TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import type { GatewayApi, McpStatus, Profile } from '../../lib/api';
import { Button } from '../ui';

/**
 * Runs the connection now and shows what the server answered. The tools are not a setting —
 * they come from the server — so this is also how the owner sees what it actually offers.
 */
export function McpCheck({
  profile,
  name,
  api,
}: {
  profile: Profile;
  name: string;
  api: GatewayApi;
}) {
  const [status, setStatus] = useState<McpStatus>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const visible = expanded ? (status?.tools ?? []) : (status?.tools ?? []).slice(0, 12);

  return (
    <div className="mcp-check">
      <Button
        variant="secondary"
        busy={busy}
        onClick={async () => {
          setBusy(true);
          setError('');

          try {
            setStatus(await api.checkMcpServer(profile.id, name));
          } catch (failure) {
            setError(failure instanceof Error ? failure.message : 'Não foi possível testar.');
          } finally {
            setBusy(false);
          }
        }}
      >
        <Plug size={15} />
        Testar conexão
      </Button>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {status &&
        (status.reachable ? (
          <div className="mcp-result good" role="status">
            <p>
              <CheckCircle2 size={15} />
              Conectado — {status.tools.length}{' '}
              {status.tools.length === 1 ? 'ferramenta' : 'ferramentas'}
            </p>
            <div className="tag-list">
              {visible.map((tool) => (
                <code key={tool.name} title={tool.description}>
                  {tool.name}
                </code>
              ))}
            </div>
            {status.tools.length > visible.length && (
              <button type="button" className="text-button" onClick={() => setExpanded(true)}>
                Ver as {status.tools.length - visible.length} restantes
              </button>
            )}
          </div>
        ) : (
          <div className="mcp-result bad" role="alert">
            <p>
              <TriangleAlert size={15} />
              Não conectou
            </p>
            <small>{status.error}</small>
          </div>
        ))}
    </div>
  );
}
