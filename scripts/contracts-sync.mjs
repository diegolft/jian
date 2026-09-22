import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// The panel and the gateway import the client from its build output, so regenerating is not
// enough: the client has to be compiled again before either of them sees a new field.
const cwd = fileURLToPath(new URL('..', import.meta.url));
const run = (...args) => execFileSync('pnpm', args, { cwd, stdio: 'inherit' });

try {
  run('contracts:generate');
  run('--filter', '@jian/sdk', 'build');
} catch {
  // Under `node --watch` a schema that does not compile must not kill the watcher; the
  // failure is already on screen and the next save tries again.
}
