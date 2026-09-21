import { randomBytes } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
const password = randomBytes(24).toString('hex');
const contents = `ELOS_API_TOKEN=${randomBytes(32).toString('hex')}
POSTGRES_PASSWORD=${password}
DATABASE_URL=postgres://elos:${password}@localhost:5432/elos
HOST=127.0.0.1
PORT=4310
ELOS_ROLE=all
ELOS_PROVIDER_OPENAI=
ELOS_PROVIDER_ANTHROPIC=
ELOS_PROVIDER_GOOGLE=
`;
try {
  await writeFile(new URL('../.env', import.meta.url), contents, { mode: 0o600, flag: 'wx' });
  console.log('.env criado com credenciais locais. Configure a chave do provider antes de executar agentes.');
} catch (error) {
  if (error.code === 'EEXIST') console.log('.env já existe; nenhuma alteração feita.');
  else throw error;
}
