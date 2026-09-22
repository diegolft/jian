import type { Run } from '@elos/contracts';
import { tokenCounter } from '../context/budget.js';
import type { RuntimeOptions } from './types.js';

// Replace longer secrets first so an overlapping shorter value cannot leave a suffix exposed.
export function redactText(text: string, secrets: ReadonlySet<string>): string {
  let result = text;

  const variants = [...secrets].flatMap((secret) =>
    secret ? [secret, JSON.stringify(secret).slice(1, -1)] : [],
  );

  for (const variant of [...new Set(variants)].sort((a, b) => b.length - a.length)) {
    result = result.replaceAll(variant, '[REDACTED]');
  }

  return result;
}

export function redactOutput(output: unknown, secrets: ReadonlySet<string>): unknown {
  let normalized: unknown;

  try {
    normalized = JSON.parse(JSON.stringify(output) ?? 'null');
  } catch {
    return '[Unserializable tool result]';
  }

  const visit = (value: unknown): unknown => {
    if (typeof value === 'string') {
      return redactText(value, secrets);
    }

    if (Array.isArray(value)) {
      return value.map(visit);
    }

    if (value && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value).map(([key, item]) => [redactText(key, secrets), visit(item)]),
      );
    }

    return value;
  };

  return visit(normalized);
}

export async function boundToolResult(
  output: unknown,
  toolName: string,
  run: Run,
  secrets: ReadonlySet<string>,
  options: Pick<RuntimeOptions, 'storeArtifact'>,
): Promise<unknown> {
  const sanitized = redactOutput(output, secrets);
  const json = JSON.stringify(sanitized) ?? 'null';
  const model = run.model ?? run.profile.model;
  const count = tokenCounter(model.provider, model.modelId);
  const limit = (run.contextPolicy ?? run.profile.contextPolicy).toolResultTokens;

  if (count(json) <= limit) {
    return sanitized;
  }

  let artifact: { artifactId: string; bytes: number } | undefined;

  try {
    artifact = await options.storeArtifact?.(run, toolName, sanitized);
  } catch {
    // Tool execution already happened. Keep a bounded preview rather than retrying the effect.
  }

  let preview = json.slice(0, Math.min(json.length, limit));

  let result: { truncated: true; preview: string; artifactId?: string; bytes: number } = {
    truncated: true,
    preview,
    artifactId: artifact?.artifactId,
    bytes: Buffer.byteLength(json),
  };

  while (preview.length > 0 && count(JSON.stringify(result)) > limit) {
    preview = preview.slice(0, Math.floor(preview.length / 2));
    result = { ...result, preview };
  }

  if (count(JSON.stringify(result)) > limit) {
    throw new Error('Tool result budget exceeded');
  }

  return result;
}
