/** Milliseconds since the epoch. Injected so a test can control time. */
export type Clock = () => number;

export function nowIso(clock: Clock): string {
  return new Date(clock()).toISOString();
}
