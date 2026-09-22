import { execFileSync } from 'node:child_process';
import { cp, rm } from 'node:fs/promises';

const root = new URL('../../../', import.meta.url);
const run = (args) => execFileSync('pnpm', args, { cwd: root, stdio: 'inherit' });

run(['--filter', '@elos/contracts', 'build']);
run(['--filter', '@elos/sdk', 'build']);
run(['--filter', '@elos/gateway-ui', 'build']);
run(['--filter', '@elos/gateway', 'build:server']);

const destination = new URL('../dist/ui/', import.meta.url);
await rm(destination, { recursive: true, force: true });
await cp(new URL('../../gateway-ui/out/', import.meta.url), destination, { recursive: true });
console.log('Gateway UI embedded at /ui.');
