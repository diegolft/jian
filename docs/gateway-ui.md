# Painel do Gateway

`apps/gateway-ui` é um app Next.js com `output: 'export'`, React e TypeScript. O painel usa o SDK gerado a partir do OpenAPI; validação, autorização e regras de domínio continuam no Gateway.

## Build e hospedagem

`pnpm build` e `pnpm --filter @elos/gateway build` compilam contratos, SDK, painel e servidor. O export é copiado para `apps/gateway/dist/ui` e incluído no pacote de produção e na imagem Docker. O runtime serve `/ui/` com Fastify; não precisa de Next.js instalado no servidor.

`pnpm --filter @elos/gateway build:server` compila apenas o servidor para desenvolvimento. Uma execução a partir do código-fonte serve o último export disponível em `dist/ui`. Reinicie o processo após substituir esse export, pois a CSP é calculada na inicialização; use o servidor de desenvolvimento do Next.js para atualização automática.

A aplicação usa uma página estática, com navegação por fragmentos (`/ui/#channels`, por exemplo). Não há Server Actions, cookies de sessão, SSR ou código de provider no navegador. Fontes, ícones e QR Code são locais, sem serviços externos de renderização.

## Configurar um perfil

1. Entre com o token administrativo `ELOS_API_TOKEN`.
2. Crie um perfil com nome, instruções, provider e ID do modelo.
3. Adicione uma credencial de provider em **Credenciais** e selecione-a em **Identidade e modelo**. Uma variável `ELOS_PROVIDER_*` do servidor também pode ser usada.
4. Ajuste identidade e orçamento de tokens. Adicione Skills e servidores MCP, com ferramentas explicitamente permitidas.
5. Crie uma conversa e teste uma mensagem. O worker precisa estar em execução para processar a fila.
6. Em **Canais**, vincule uma sessão e informe as listas de remetentes e conversas autorizados.

Para WhatsApp, abra **Conexão**, gere o QR Code e leia-o no celular em **Dispositivos conectados**. O worker precisa de Chromium. O painel acompanha a conexão e a primeira cópia criptografada da sessão. O QR expira e não é gravado no navegador.

Para Telegram, cadastre o token do BotFather como credencial de canal. Depois da criação, o painel mostra a URL e o segredo do webhook uma única vez. O registro de `setWebhook` no Telegram continua sendo uma etapa externa; consulte [canais](channels.md). O webhook HTTP genérico recebe mensagens, mas não envia respostas a um serviço externo.

Chaves de acesso são isoladas por perfil, têm escopos e data de expiração. O token gerado é exibido uma única vez. Memórias podem ser criadas ou editadas; conflitos de versão exigem atualizar os dados antes de reenviar.

## Segurança e limites

- A página de entrada e os assets são públicos. APIs administrativas continuam exigindo Bearer authentication.
- O formulário de entrada só habilita o envio após a hidratação e usa POST como fallback, impedindo envio do token na URL. O token administrativo fica apenas na memória React. Sair ou recarregar limpa a sessão do painel; não há localStorage, sessionStorage ou cookie de autenticação.
- Requisições usam a mesma origem, sem cache, com tempo limite. O painel não contém credenciais no build.
- A política CSP aceita scripts do próprio Gateway e hashes exatos dos scripts de hidratação do export. Enquadramento em iframe, plugins e alteração da URL-base são bloqueados.
- Inputs são renderizados como texto; o histórico e as instruções não executam HTML.
- Mudanças de perfil usam `expectedVersion`; submissões de mensagem conservam a chave de idempotência quando a resposta HTTP é incerta.
- Listagens seguem os limites atuais da API: até 100 sessões, mensagens recentes, memórias e entregas. O painel não substitui a API de histórico paginado.

Infraestrutura permanece na configuração do servidor: PostgreSQL, keyring de criptografia, token administrativo, papel API/worker, Chromium, HTTPS e regras de rede. A UI não transforma esta instalação de dono único em um SaaS multiusuário.

A prévia local de desenvolvimento usa dados sintéticos em memória. Validação visual e testes HTTP locais não comprovam persistência PostgreSQL, entrega por serviços externos ou pareamento real do WhatsApp.
