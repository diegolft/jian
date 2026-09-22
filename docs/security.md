# Segurança e operação

## Fronteira de confiança

Uma instalação pertence a um dono confiável. O token `ELOS_API_TOKEN` é administrativo: mantenha-o no host e use chaves com escopos nos clientes. Todas as sessões de um perfil compartilham o mesmo acesso aos dados e ferramentas daquele perfil. Não conecte públicos com permissões diferentes ao mesmo perfil.

As chaves de clientes são aleatórias, têm 256 bits de entropia e são persistidas como hash SHA-256, com perfil, escopos e expiração. Revogação é verificada a cada requisição e durante streams. Chaves de provider/MCP/canal são criptografadas e nunca retornadas em consultas do cofre.

## Criptografia e rotação

`ELOS_MASTER_KEYS` é um objeto JSON de identificadores para chaves de 32 bytes em Base64. `ELOS_ACTIVE_KEY_ID` escolhe a chave usada para novas gravações. O setup cria um keyring em `.env` com permissão `0600`; na hospedagem, injete-o por um gerenciador de segredos. Não coloque esse keyring no banco, no Git ou no mesmo backup do banco.

AES-256-GCM usa nonce aleatório por gravação. Os dados autenticados vinculam cada ciphertext ao ID, perfil e propósito da credencial, impedindo a troca de envelopes entre registros. Essa proteção cobre vazamento isolado do banco; um processo worker comprometido também pode acessar as chaves em memória.

Para rotacionar:

1. Gere outra chave aleatória de 32 bytes e adicione-a ao keyring com outro ID.
2. Distribua o keyring completo a todas as APIs/workers e altere o ID ativo.
3. Chame `POST /v1/profiles/{profileId}/credentials/{credentialId}/rotate` para cada credencial.
4. Confira o `keyId` dos metadados antes de remover a chave antiga. Backups antigos continuam dependendo dela.

Rotação do envelope não troca a chave no provider. Para trocar a credencial externa, crie outra credencial no cofre, atualize o perfil com controle de versão e revogue a anterior. Runs enfileirados guardam a configuração antiga; cancele-os se a revogação for urgente.

O token administrativo legado fica no ambiente, separado do banco. Troque-o no host e reinicie API/workers; a troca também invalida os cookies de sessão do painel, que são assinados com ele. Nunca envie segredos em parâmetros de URL; use HTTPS e armazene tokens do cliente no cofre do sistema operacional.

## Rede e limites

Providers e MCPs usam o mesmo transporte de saída. Ele exige HTTPS público, valida e fixa a resolução DNS na conexão, bloqueia redirecionamentos, credenciais embutidas e destinos privados. `ELOS_ALLOW_PRIVATE_ORIGINS` permite origens exatas para serviços internos administrados pelo dono, por exemplo `http://127.0.0.1:11434`. Endereços de metadata e link-local continuam proibidos.

A API limita o corpo a 256 KiB, aplica rate limit por endereço de conexão e limita streams. Ela não confia automaticamente em `X-Forwarded-For`; atrás de um proxy todos os clientes podem compartilhar o limite. Configure limites adicionais no proxy conforme a implantação. Instâncias distintas têm contadores HTTP próprios; os limites de runs e as reservas de recursos ficam no banco.

Inputs desconhecidos são rejeitados nos contratos administrativos. Logs não incluem corpos, cabeçalhos de autenticação ou exceções de providers. Memórias, mensagens e artefatos são dados do usuário e permanecem em texto no banco: criptografia de credenciais não significa criptografia integral das conversas. Restrinja acesso ao banco e aos backups.

Skills e resultados de ferramentas são instruções/dados não confiáveis. As listas permitidas e escopos reduzem capacidades; elas não eliminam prompt injection. Habilite apenas as ferramentas que o perfil pode realmente exercer e use credenciais externas de menor privilégio.

## Falhas e efeitos externos

Uma lease expirada interrompe o run; não reinicia automaticamente ferramentas. A continuação exige reconciliação explícita, cria outro run e preserva os checkpoints anteriores. Ela não oferece exatamente uma execução de efeitos externos.

Reservas de recursos coordenam sessões do mesmo perfil e emitem um número de fence crescente. Um recurso externo só está protegido contra um titular antigo se também validar esse número; a reserva não intercepta automaticamente todos os MCPs.

Uma entrega Telegram sem confirmação recebe estado `unknown` e não é reenviada automaticamente. Envios abandonados são marcados incertos após dez minutos. Verifique o destino antes de reenviar manualmente. Cancelar um run não desfaz ações já executadas.

## Reportar vulnerabilidades

Não publique credenciais ou provas com dados privados em issues. Antes de disponibilizar o projeto publicamente, configure um canal privado de contato e o recurso de reporte privado do repositório. Use dados sintéticos para reproduções.

## Dispositivos WhatsApp

Parear por QR concede acesso à conta. Conexão, estado e QR exigem token de administrador; o QR é criptografado no banco, expira e usa `Cache-Control: no-store`. Backups da sessão são criptografados e isolados por perfil/canal. Callbacks de gerações ou posses antigas não podem regravar credenciais após desconexão/revogação.

Chromium usa diretório temporário privado em texto claro durante a execução; prefira tmpfs no worker e limpe o volume após falhas abruptas. Mantenha o sandbox do navegador e o próprio Chromium atualizados. O processo acessa o WhatsApp diretamente; aplique controles de saída também ao worker. A integração não é uma API oficial da Meta.

O pnpm mantém Puppeteer 25.11.0 para evitar o `extract-zip` vulnerável da dependência original de `whatsapp-web.js`. Downloads automáticos de navegador ficam desativados: o executável é fornecido pelo operador ou pela imagem Docker.
