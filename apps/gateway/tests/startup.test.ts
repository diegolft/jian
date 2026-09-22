import { expect, it } from 'vitest';
import { startupFailure } from '../src/startup.js';

it('explains refused IPv4/IPv6 database connections without exposing driver details', () => {
  const failure = new AggregateError([
    Object.assign(new Error('postgres://user:secret@localhost/jian'), { code: 'ECONNREFUSED' }),
    Object.assign(new Error('private driver details'), { code: 'ECONNREFUSED' }),
  ]);

  const message = startupFailure('database', failure);

  expect(message).toContain('[database]');
  expect(message).toContain('ECONNREFUSED');
  expect(message).toContain('Start PostgreSQL or correct DATABASE_URL');
  expect(message).not.toContain('secret');
  expect(message).not.toContain('private driver details');
});

it('distinguishes authentication and listener failures while keeping unknown errors private', () => {
  expect(startupFailure('database', { code: '28P01' })).toContain('rejected the credentials');
  expect(startupFailure('http', { cause: { code: 'EADDRINUSE' } })).toContain(
    'port is already in use',
  );
  expect(startupFailure('queue', { code: 'secret-code', message: 'secret-message' })).toBe(
    'Jian startup failed [queue]. Unexpected failure. Check configuration and service logs.',
  );
});
