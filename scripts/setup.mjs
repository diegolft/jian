import { randomBytes } from 'node:crypto';
import { appendFile, chmod, readFile, writeFile } from 'node:fs/promises';

const masterKeys = JSON.stringify({ v1: randomBytes(32).toString('base64') });
const password = randomBytes(24).toString('hex');
const contents = `ELOS_API_TOKEN=${randomBytes(32).toString('hex')}
ELOS_ACTIVE_KEY_ID=v1
ELOS_MASTER_KEYS='${masterKeys}'
POSTGRES_PASSWORD=${password}
DATABASE_URL=postgres://elos:${password}@localhost:5432/elos
HOST=127.0.0.1
PORT=4310
ELOS_ROLE=all
OPENAI_API_KEY=
ANTHROPIC_API_KEY=
ANTHROPIC_API_TOKEN=
GEMINI_API_TOKEN=
`;
try {
  await writeFile(new URL('../.env', import.meta.url), contents, { mode: 0o600, flag: 'wx' });
  console.log(
    '.env criado com credenciais locais. Configure a chave do provider antes de executar agentes.',
  );
} catch (error) {
  if (error.code === 'EEXIST') {
    const path = new URL('../.env', import.meta.url);
    const existing = await readFile(path, 'utf8');
    if (!/^\s*(?:export\s+)?ELOS_MASTER_KEYS\s*=/m.test(existing)) {
      await appendFile(path, `\nELOS_ACTIVE_KEY_ID=v1\nELOS_MASTER_KEYS='${masterKeys}'\n`);
      await chmod(path, 0o600);
      console.log('Cofre configurado em .env; configurações existentes preservadas.');
    } else console.log('.env já existe; nenhuma alteração feita.');
  } else throw error;
}
