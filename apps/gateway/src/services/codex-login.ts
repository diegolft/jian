import { z } from 'zod';
import { GatewayError } from '../core/errors.js';
import type { Gateway } from '../gateway.js';
import type { Credentials } from './credentials.js';

const clientId = 'app_EMoamEEZ73f0CkXaXp7hrann';
const authOrigin = 'https://auth.openai.com';

const tokensSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1),
});

type LoginState = {
  status: 'pending' | 'connected' | 'failed';
  verificationUrl?: string;
  userCode?: string;
  error?: string;
};

export class CodexLogin {
  private pending = new Map<string, LoginState>();
  private starting = new Map<string, Promise<LoginState>>();
  private stopped = false;

  constructor(
    private readonly gateway: Gateway,
    private readonly credentials: Credentials,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  stop() {
    this.stopped = true;
    this.pending.clear();
  }

  async status(profileId: string): Promise<LoginState> {
    await this.gateway.profile(profileId);
    const pending = this.pending.get(profileId);
    if (pending) return pending;

    const providers = await this.gateway.providers(profileId);
    const credentials = await this.credentials.list(profileId);
    return providers.some(
      (provider) =>
        provider.authMode === 'codex' &&
        !provider.revokedAt &&
        credentials.some(
          (credential) => credential.id === provider.credentialId && !credential.revokedAt,
        ),
    )
      ? { status: 'connected' }
      : { status: 'failed' };
  }

  async start(profileId: string): Promise<LoginState> {
    if (this.stopped) throw new GatewayError(503, 'Codex login is unavailable');
    await this.gateway.profile(profileId);
    const existing = this.pending.get(profileId);
    if (existing?.status === 'pending') return existing;

    const current = this.starting.get(profileId);
    if (current) return current;
    const request = this.requestCode(profileId);
    this.starting.set(profileId, request);
    try {
      return await request;
    } finally {
      this.starting.delete(profileId);
    }
  }

  private async requestCode(profileId: string): Promise<LoginState> {
    const response = await this.fetcher(`${authOrigin}/api/accounts/deviceauth/usercode`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ client_id: clientId }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new GatewayError(502, 'OpenAI login could not start');

    const payload = z
      .object({
        user_code: z.string().min(1),
        device_auth_id: z.string().min(1),
        interval: z.coerce.number().int().min(3).max(30).default(5),
      })
      .parse(await response.json());
    const state: LoginState = {
      status: 'pending',
      verificationUrl: `${authOrigin}/codex/device`,
      userCode: payload.user_code,
    };
    this.pending.set(profileId, state);
    void this.poll(profileId, payload.device_auth_id, payload.user_code, payload.interval);
    return state;
  }

  private async poll(profileId: string, deviceId: string, userCode: string, interval: number) {
    const deadline = Date.now() + 15 * 60_000;
    try {
      while (
        !this.stopped &&
        Date.now() < deadline &&
        this.pending.get(profileId)?.status === 'pending'
      ) {
        await new Promise((resolve) => {
          const timer = setTimeout(resolve, interval * 1000);
          timer.unref();
        });
        if (this.stopped) return;
        const response = await this.fetcher(`${authOrigin}/api/accounts/deviceauth/token`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ device_auth_id: deviceId, user_code: userCode }),
          signal: AbortSignal.timeout(15_000),
        });
        if (response.status === 403 || response.status === 404) continue;
        if (!response.ok) throw new Error('OpenAI rejected the login request');
        const code = z
          .object({ authorization_code: z.string().min(1), code_verifier: z.string().min(1) })
          .parse(await response.json());
        const tokens = await this.exchange(code.authorization_code, code.code_verifier);
        if (this.stopped) return;
        const credential = await this.credentials.create(profileId, {
          label: 'OpenAI · ChatGPT',
          kind: 'provider',
          secret: JSON.stringify(tokens),
        });
        const previous = (await this.gateway.providers(profileId)).filter(
          (provider) => provider.authMode === 'codex' && !provider.revokedAt,
        );
        await this.gateway.configureCodexProvider(profileId, credential.id);
        for (const provider of previous) {
          if (provider.credentialId) {
            await this.credentials.revoke(profileId, provider.credentialId).catch(() => {});
          }
        }
        this.pending.delete(profileId);
        return;
      }
      throw new Error('Login expired');
    } catch {
      if (this.stopped) return;
      this.pending.set(profileId, {
        status: 'failed',
        error: 'Login não concluído. Tente novamente.',
      });
    }
  }

  private async exchange(code: string, verifier: string) {
    const response = await this.fetcher(`${authOrigin}/oauth/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: `${authOrigin}/deviceauth/callback`,
        client_id: clientId,
        code_verifier: verifier,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error('Token exchange failed');
    return tokensSchema.parse(await response.json());
  }

  async accessToken(profileId: string, credentialId: string) {
    const secret = await this.credentials.transformSecret(
      profileId,
      credentialId,
      async (current) => {
        const tokens = tokensSchema.parse(JSON.parse(current));
        const payload = JSON.parse(
          Buffer.from(tokens.access_token.split('.')[1] ?? '', 'base64url').toString('utf8'),
        ) as { exp?: number };
        if ((payload.exp ?? 0) > Math.floor(Date.now() / 1000) + 120) return current;

        const response = await this.fetcher(`${authOrigin}/oauth/token`, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            grant_type: 'refresh_token',
            refresh_token: tokens.refresh_token,
            client_id: clientId,
          }),
          signal: AbortSignal.timeout(20_000),
        });
        if (!response.ok) throw new Error('ChatGPT login expired; sign in again');
        const fresh = z
          .object({ access_token: z.string().min(1), refresh_token: z.string().optional() })
          .parse(await response.json());
        return JSON.stringify({
          access_token: fresh.access_token,
          refresh_token: fresh.refresh_token ?? tokens.refresh_token,
        });
      },
    );
    return tokensSchema.parse(JSON.parse(secret)).access_token;
  }
}
