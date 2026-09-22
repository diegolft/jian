# Painel do Gateway

`apps/gateway-ui` é um app Next.js com `output: 'export'`, React e TypeScript. O painel usa o SDK gerado a partir do OpenAPI; validação, autorização e regras de domínio continuam no Gateway.

## Build e hospedagem

`pnpm build` e `pnpm --filter @jian/gateway build` compilam contratos, SDK, painel e servidor. O export é copiado para `apps/gateway/dist/ui` e incluído no pacote de produção e na imagem Docker. O runtime serve `/ui/` com Fastify; não precisa de Next.js instalado no servidor.

`pnpm --filter @jian/gateway build:server` compila apenas o servidor para desenvolvimento. Uma execução a partir do código-fonte serve o último export disponível em `dist/ui`. Reinicie o processo após substituir esse export, pois a CSP é calculada na inicialização; use o servidor de desenvolvimento do Next.js para atualização automática.

A aplicação usa uma página estática, com navegação por fragmentos (`/ui/#channels`, por exemplo). Não há Server Actions, cookies de sessão, SSR ou código de provider no navegador. Fontes, ícones e QR Code são locais, sem serviços externos de renderização.

## Configurar um perfil

1. Entre com o token administrativo `JIAN_API_TOKEN`.
2. Crie um perfil com nome e instruções. Papel, tom e objetivos pertencem às instruções.
3. Em **Providers**, configure a chave de Anthropic, Gemini ou OpenAI. `ANTHROPIC_API_KEY`, `ANTHROPIC_API_TOKEN`, `GEMINI_API_TOKEN` e `OPENAI_API_KEY` no ambiente são detectadas automaticamente. A OpenAI também aceita login ChatGPT por código de dispositivo.
4. Em **Modelos padrão**, escolha o modelo de cada papel. A lista vem da conta do provider, não de uma lista escrita no código, e o painel marca os modelos cujas capacidades o gateway não cataloga. O nível de esforço aparece onde o modelo aceita. **Conversas** é obrigatório para conversar; os demais podem ficar vazios.

   Os papéis são: conversas, canais, compactação de contexto, geração de imagem, geração de áudio, fala a partir de texto e texto a partir de fala. Só conversas e canais têm runtime hoje — os outros cinco são salvos, validados e **não executados**, e o painel diz isso em cada um. Quando o provider não responde, o painel mostra a última lista lida com aviso; a configuração salva não muda. O login ChatGPT não publica lista de modelos: use **Informar ID…** para digitar o ID.
5. Adicione Skills, escritas na tela ou importadas de um repositório do GitHub no formato aberto `SKILL.md` — o mesmo que Claude Code, Codex e Copilot leem. A importação copia as instruções uma vez e guarda de onde vieram; o repositório mudar depois não reescreve o que o agente já segue, e só o dono importa. Adicione também servidores MCP, com ferramentas explicitamente permitidas. Crie uma conversa, escolha um modelo e um esforço no Composer se quiser substituir o padrão, e teste uma mensagem. O worker precisa estar em execução para processar a fila.
6. Em **Canais**, conecte WhatsApp, Telegram ou API Server. Cada tipo existe uma vez e aparece como conectado ou não, como em Providers. Para um grupo com vários agentes, conecte um canal por perfil — um número ou um bot para cada um — e aprove a sala em cada perfil que deve falar nela.

O login ChatGPT usa o backend Codex com o mesmo ciclo de contexto, ferramentas e registro de uso do Jian. Tokens OAuth ficam criptografados no cofre e são renovados pelo gateway. Não cole tokens de login no campo de chave de API. Perfis antigos com `model` e `contextPolicy` continuam legíveis e funcionais.

Conectar o WhatsApp é ler o QR Code: o painel abre o pareamento na hora e acompanha a conexão e a primeira cópia criptografada da sessão. O QR expira sem ser gravado no navegador. Conectar o Telegram é informar o token do BotFather, que o Gateway guarda criptografado; o painel mostra a URL e o segredo do webhook uma única vez, e o `setWebhook` continua sendo uma etapa externa. Conectar o API Server gera essa mesma URL e token. Nada além disso é pedido — nem nome, nem sessão, nem lista de remetentes.

Quem escreve pela primeira vez aparece em **Solicitações de contato**, com o nome, o identificador e a mensagem que ficou esperando. Aprovar cria a conversa e libera essa mensagem; recusar bloqueia o remetente em silêncio. A solicitação chega sozinha: o painel acompanha o fluxo de eventos do perfil e se atualiza quando um contato ou um canal muda, sem recarregar a página. Consulte [canais](channels.md) para as garantias do lado do Gateway.

Um grupo aparece na mesma lista, marcado como **Grupo**, e a aprovação vale para a sala inteira: não existe uma solicitação por participante, e nada fica retido esperando a decisão. Depois de aprovado, ele aparece em **Grupos**, com o nome da sala, o canal e quais dos seus perfis participam dela — cada perfil entra com a própria conexão, então cada um é aprovado separadamente e o painel mostra os que ainda estão pendentes como não participantes. Dentro de um grupo com mais de um agente, cada um só responde quando a mensagem traz o nome dele, e a conversa entre agentes para no limite de turnos até que uma pessoa escreva de novo.

Segredo não tem tela própria: a chave do provider é digitada em **Providers**, o token de um servidor MCP junto do servidor e o token do bot junto do canal. O cofre continua cifrando por perfil, sem aparecer no painel, e nenhum valor é exibido de novo — para trocar, envie outro; para remover, remova a coisa que o usa.

**Memórias** é leitura: a tela lista o que o agente guardou, busca por identificador e conteúdo e apaga uma entrada. Quem escreve é o agente, pelas próprias ferramentas.

## Segurança e limites

- A página de entrada e os assets são públicos. Toda rota da API exige o token do host ou o cookie do painel assinado com ele; não existe chave de cliente com permissão reduzida.
- O formulário de entrada só habilita o envio após a hidratação e usa POST como fallback, impedindo envio do token na URL. O token administrativo é trocado uma vez por um cookie de sessão e não fica no navegador; não há localStorage nem sessionStorage.
- O cookie do painel é `HttpOnly`, `SameSite=Strict`, válido por 30 dias e `Secure` quando a requisição chega por HTTPS. Ele carrega apenas a própria validade e uma assinatura HMAC derivada de `JIAN_API_TOKEN`: nada é guardado no banco, e trocar o token do host encerra todas as sessões abertas. Recarregar mantém a sessão; sair apaga o cookie.
- O gateway só aceita o cookie em requisições que também enviam `x-jian-panel: 1`. Cabeçalho personalizado exige preflight CORS, que o gateway não responde, então outro site não consegue usar o cookie. O login tem limite próprio de 10 tentativas por minuto.
- Requisições usam a mesma origem, sem cache, com tempo limite. O painel não contém credenciais no build.
- A política CSP aceita scripts do próprio Gateway e hashes exatos dos scripts de hidratação do export. Enquadramento em iframe, plugins e alteração da URL-base são bloqueados.
- Inputs são renderizados como texto; o histórico e as instruções não executam HTML.
- Mudanças de perfil usam `expectedVersion`; submissões de mensagem conservam a chave de idempotência quando a resposta HTTP é incerta.
- Listagens seguem os limites atuais da API: até 100 sessões, mensagens recentes, memórias e entregas, até 200 contatos e até 500 contatos de grupo somados em toda a instalação. O painel não substitui a API de histórico paginado.
- O fluxo de eventos usa o mesmo cookie de sessão e o mesmo cabeçalho das demais chamadas, lido por `fetch` porque `EventSource` não envia cabeçalhos. O Gateway reconfere a sessão a cada ciclo e encerra o fluxo quando ela expira; o painel reabre a partir do último evento recebido.

Infraestrutura permanece na configuração do servidor: PostgreSQL, keyring de criptografia, token administrativo, papel API/worker, HTTPS e regras de rede. A UI não transforma esta instalação de dono único em um SaaS multiusuário.

A prévia local de desenvolvimento usa dados sintéticos em memória. Validação visual e testes HTTP locais não comprovam persistência PostgreSQL, entrega por serviços externos ou pareamento real do WhatsApp.
