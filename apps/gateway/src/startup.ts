export type StartupStage = 'database' | 'queue' | 'http';

const failures: Record<string, string> = {
  ECONNREFUSED: 'Connection refused. Start PostgreSQL or correct DATABASE_URL.',
  ENOTFOUND: 'Database host not found. Check the hostname in DATABASE_URL.',
  EAI_AGAIN: 'Database hostname resolution failed. Check DNS and try again.',
  ETIMEDOUT: 'Database connection timed out. Check connectivity and firewall rules.',
  '28P01': 'PostgreSQL rejected the credentials. Check DATABASE_URL.',
  '28000': 'PostgreSQL denied access. Check authentication and pg_hba.conf.',
  '3D000': 'The configured database does not exist. Create it or correct DATABASE_URL.',
  '42501': 'The database user lacks permissions to initialize the schema.',
  EADDRINUSE: 'The HTTP port is already in use. Change PORT or stop the conflicting server.',
  EACCES: 'Permission denied while opening the HTTP listener. Check HOST and PORT.',
};

function knownFailure(error: unknown, depth = 0): string | undefined {
  if (!error || typeof error !== 'object' || depth > 3) {
    return;
  }

  if ('code' in error && typeof error.code === 'string' && Object.hasOwn(failures, error.code)) {
    return `${error.code}: ${failures[error.code]}`;
  }

  // Node can wrap IPv4/IPv6 connection attempts in an AggregateError.
  if (error instanceof AggregateError) {
    for (const nested of error.errors) {
      const failure = knownFailure(nested, depth + 1);

      if (failure) {
        return failure;
      }
    }
  }

  if ('cause' in error) {
    return knownFailure(error.cause, depth + 1);
  }
}

/** Driver messages and stacks can contain connection strings; log only recognized codes. */
export function startupFailure(stage: StartupStage, error: unknown): string {
  const detail = knownFailure(error) ?? 'Unexpected failure. Check configuration and service logs.';

  return `Jian startup failed [${stage}]. ${detail}`;
}
