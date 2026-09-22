# Canais

Um perfil tem três canais possíveis — WhatsApp, Telegram e API Server — e no máximo um de cada. Conectar é toda a configuração: não existe nome, sessão escolhida nem lista de remetentes. Quem pode falar com o agente é decidido depois: contato por contato nas conversas privadas, e uma vez por sala nos grupos.

`POST /v1/profiles/{profileId}/channels` conecta um tipo e retorna o `webhookToken` uma única vez; o banco guarda apenas o hash. Um segundo canal do mesmo tipo responde `409`. `DELETE /v1/profiles/{profileId}/channels/{channelId}` desconecta, apaga o segredo do canal no cofre e libera o tipo para uma nova conexão. Contatos aprovados e suas conversas continuam salvos.

## Contatos e aprovação

A primeira mensagem de um remetente desconhecido não entra no perfil. O Gateway registra uma solicitação de contato com quem escreveu e o que mandou, avisa a pessoa uma única vez que o dono precisa aprovar, e guarda a mensagem.

| Método e caminho | Comportamento |
| --- | --- |
| `GET /v1/profiles/{profileId}/contacts` | Solicitações pendentes primeiro, depois aprovados e bloqueados |
| `POST /v1/profiles/{profileId}/contacts/{contactId}/approve` | Cria a sessão da conversa e libera a mensagem em espera |
| `POST /v1/profiles/{profileId}/contacts/{contactId}/block` | Descarta a mensagem e ignora o remetente em silêncio |

Todas exigem o token de administrador: aprovar é dar acesso ao agente.

Regras que a implementação garante:

- Uma solicitação por remetente, não por mensagem. Se o desconhecido insistir, o texto novo é anexado à mesma solicitação, até 8.000 caracteres.
- Um aviso automático por solicitação. Mensagens seguintes de quem está esperando não geram resposta, o que impede qualquer laço entre dois sistemas automáticos.
- Um bloqueado não recebe nada e não gera execução.
- Enquanto está pendente, o remetente não tem sessão, execução nem histórico no perfil.
- Aprovar cria a sessão daquela conversa e envia a mensagem retida. A chave de idempotência dela é derivada do canal, do chat e do ID da mensagem original, então reenvios do protocolo e uma segunda aprovação recuperam o mesmo run em vez de criar outro.

O aviso automático só existe em canais que sabem responder. O API Server apenas recebe: a resposta HTTP traz `contact: "pending"`, e cabe ao chamador avisar seu usuário.

## Sessões por conversa

Cada conversa é uma sessão do perfil, criada na aprovação e intitulada com o canal e o remetente — `WhatsApp · 5511999999999@c.us`, `WhatsApp · Grupo Equipe`. Nada é configurado para isso. As sessões aparecem em **Conversas** no painel, compartilham identidade, ferramentas e memórias do perfil, e mantêm o histórico separado por conversa. A sessão de um grupo é separada das conversas privadas das mesmas pessoas.

## Grupos

Um grupo é uma conversa onde várias pessoas e vários agentes escrevem. Cada agente entra com a própria conexão — o próprio número no WhatsApp, o próprio bot no Telegram —, então o isolamento por perfil continua inteiro: cada perfil enxerga o grupo pela sua conexão, e o que os outros agentes escrevem chega a ele como mensagem de outro participante, pelo próprio protocolo. Não existe sala compartilhada nem transcrição comum dentro do Gateway.

O canal marca a conversa: `scope: "group"`. No WhatsApp é o JID `@g.us`, com o participante como remetente e o grupo como conversa; no Telegram são os chats `group` e `supergroup`. Uma mensagem de grupo vira uma sessão do perfil identificada pelo grupo, e a execução recebe o autor junto do texto — `Lucas: Ada, você consegue olhar o relatório?` —, porque num grupo o agente precisa saber quem falou para responder a quem.

### Aprovação por grupo

O dono aprova o grupo uma vez, não cada participante. A solicitação registra a conversa, e quem escrever ali depois entra pela mesma decisão.

- Grupo pendente não gera execução, não gera entrega e não recebe aviso automático: o Gateway não escreve dentro de uma sala que o dono não aprovou, nem para explicar que está esperando aprovação.
- Nada fica retido. Numa conversa privada a primeira mensagem espera a aprovação e é liberada depois; num grupo ela não é guardada, porque liberá-la faria o agente responder uma mensagem que não chamou ninguém.
- Cada perfil vê o grupo pela própria conexão, então cada um tem a própria solicitação e a própria sessão. Aprovar para um perfil não aprova para os outros.
- Renomear o grupo não reabre a solicitação; o nome novo atualiza o título.

### Só responde quem foi chamado

Num grupo em que mais de um agente da instalação está aprovado, o agente fica calado por padrão e só responde quando é endereçado. Sem isso, três agentes respondem a mesma mensagem e o grupo vira ruído. O agente reconhece que foi chamado de duas formas:

- Menção do protocolo ao endereço da própria conexão, quando o protocolo carrega isso — `mentionedJid` no WhatsApp, `text_mention` no Telegram.
- O nome do perfil escrito na mensagem, comparado sem diferenciar maiúsculas nem acentos e respeitando limites de palavra. Um nome composto também responde ao primeiro nome, com três letras ou mais.

Mensagem de outro agente sempre exige ser endereçada. Mensagem de pessoa exige o nome quando há mais de um agente aprovado no grupo; com um agente só não há ninguém para atropelar, e ele responde como numa conversa privada.

### O laço entre agentes termina

Um agente pode chamar outro dentro do grupo, e isso precisa parar: cada agente gasta dinheiro de verdade a cada turno. O limite é `GROUP_AGENT_TURN_LIMIT`, hoje 3, e vale para a sala, não para cada agente — a mesma ideia de orçamento da conversa entre perfis, contada pelo que todos escreveram em vez de reiniciar em cada um.

Cada perfil conta, no contato do grupo, os turnos de agente desde a última mensagem de gente: soma as mensagens que vê dos outros agentes e as respostas que ele mesmo envia. Ao estourar o limite, o agente silencia; como todos contam o mesmo tráfego, todos silenciam. Uma mensagem de pessoa zera a contagem e devolve o orçamento à sala. Um turno nunca é cobrado duas vezes: o contato guarda os identificadores das últimas mensagens vistas, então uma reentrega do protocolo é o mesmo turno, recupera a mesma execução e não produz uma segunda resposta.

### Quem é agente

O Gateway reconhece um participante como outro perfil da instalação pelo endereço da conexão dele: o canal guarda em `address` o que aquela conexão fala — a conta pareada no WhatsApp, gravada quando o dispositivo conecta, e o ID do bot no Telegram, perguntado uma vez ao `getMe` ao conectar o canal. O endereço não aparece em nenhuma resposta da API.

Uma conexão que o protocolo não sabe identificar fica sem endereço, e as mensagens dela contam como as de qualquer pessoa: o agente continua respondendo só quando chamado, mas aquele tráfego não gasta o orçamento da sala. Mensagem do próprio endereço é eco e é descartada antes de virar execução.

### O que o dono vê

`GET /v1/groups` lista os grupos conhecidos pela instalação, cada um com os perfis que participam dele, o estado de cada solicitação e o nome do grupo. É a única rota que cruza perfis, porque o grupo é de todos eles; exige o token de administrador, como todo o resto do painel.

### Limites

- No Telegram, um bot não recebe mensagens de outro bot, e o modo de privacidade padrão esconde dele as mensagens que não o mencionam. Ou seja: pessoas falam com os agentes num grupo do Telegram, mas conversa entre agentes só acontece de fato no WhatsApp. A regra do Gateway é a mesma nos dois.
- O assunto do grupo no WhatsApp é consultado uma vez por sala e mantido em memória pelo worker; um grupo renomeado só muda de nome no painel depois que o worker reinicia.
- A resposta vai para o grupo inteiro: não existe resposta privada a um participante dentro da sala.

## API Server

Envie `actorId`, `chatId`, `text`, `requestKey` e, se tiver, `displayName` a `POST /v1/ingress/{channelId}`, usando `X-Jian-Channel-Token`. Para uma conversa em grupo, mande `scope: "group"` com o `chatId` do grupo, o `actorId` de quem escreveu e, se tiver, `groupName` e `mentions`. O adapter que chama essa rota deve autenticar a identidade externa antes de preencher os IDs; quem possui o token pode representar qualquer remetente, e cada remetente novo vira uma solicitação de contato. O retorno traz `accepted`, o ID do run quando houver, e o estado do contato. Consulte resultados pela API administrativa.

Este canal não envia respostas a um serviço externo. A ideia de transformá-lo em um endpoint compatível com OpenAI é uma tarefa própria; o comportamento de entrada aqui descrito é o atual.

## Telegram

1. Conecte o canal com `type: "telegram"` e o token do BotFather em `botToken`. O Gateway cifra o token no cofre sob `channel:<id>`; ele não volta em nenhuma resposta. Para trocá-lo, desconecte e conecte de novo.
2. Configure no Telegram o webhook HTTPS `/v1/telegram/{channelId}`, passando o `webhookToken` como `secret_token` e limitando `allowed_updates` a `message`.

O Gateway valida `X-Telegram-Bot-Api-Secret-Token` e o contato antes de aceitar mensagens. Reentregas de um mesmo update recuperam o mesmo run. A resposta final é enviada em partes de até 4.000 caracteres, sem modo de interpretação HTML/Markdown. As configurações seguem a [API oficial do Telegram](https://core.telegram.org/bots/api#setwebhook).

Esta implementação atende mensagens de texto de usuários com `from`, `chat` e `text`, em conversas privadas e em grupos; mídias, edições, callbacks e tópicos separados não estão implementados. `first_name` ou `username` viram o nome exibido na solicitação de contato. Em grupo, `chat.title` vira o nome da sala e as entidades `text_mention` viram menções. Para um bot enxergar as mensagens do grupo que não o mencionam, desligue o modo de privacidade no BotFather.

O worker processa entregas após a conclusão do run. `GET /v1/profiles/{profileId}/deliveries` mostra `pending`, `sending`, `sent`, `failed` ou `unknown`. Falhas incertas não são repetidas automaticamente; consulte os IDs de mensagens confirmadas antes de uma ação manual.

A configuração do webhook no serviço externo é responsabilidade do operador. Os testes locais simulam Telegram e não configuram um bot real.

## Adaptadores

Cada protocolo implementa `Channel`, em `apps/gateway/src/channels/channel.ts`. `ApiChannel` normaliza a entrada HTTP; `TelegramChannel` interpreta updates e envia respostas. `WhatsAppChannel` usa a conexão de dispositivo vinculado mantida pelo worker. `ChannelRegistry` seleciona o adaptador pelo tipo, sem ramificações de protocolo no serviço `Channels`.

A interface define o cabeçalho opcional de autenticação do webhook, a normalização de entrada e o envio opcional. A ausência de `send` significa que o canal só recebe: o API Server não produz uma entrega fictícia, nem um aviso de aprovação. Credenciais e o cliente HTTP protegido são fornecidos ao adaptador somente durante o envio.

O serviço comum mantém as garantias compartilhadas: autenticação do token, decisão de contato, vínculo com perfil/sessão, deduplicação, registro da entrega e recuperação de estados incertos. Os adaptadores não escolhem permissões nem acessam o banco. Antes de enviar, o serviço grava `sending` em uma transação; se perder a confirmação, marca `unknown` em vez de repetir um possível efeito externo.

`Contacts`, em `apps/gateway/src/channels/contacts.ts`, decide quem é atendido. O registro do contato é escrito dentro da mesma transação que recebe a mensagem, com trava por perfil: é isso que garante uma solicitação — e um aviso — mesmo quando várias mensagens chegam juntas.

`Groups`, em `apps/gateway/src/channels/groups.ts`, decide se o perfil fala numa sala já aprovada: reconhece o autor, mede quem foi endereçado e escreve o orçamento da sala. Roda dentro da mesma transação, pela mesma razão — a trava por perfil é o que impede que uma rajada gaste o orçamento duas vezes.

Uma entrega pode existir sem run: o aviso de aprovação carrega o próprio texto em `notice`. O worker envia esse texto direto, sem esperar execução alguma.

Para adicionar um protocolo, implemente o adaptador, registre-o e declare seu tipo e entrada em `packages/contracts`, incluindo a rota HTTP quando necessária. Gere novamente o OpenAPI/SDK. A interface é interna; o contrato público continua sendo explícito e versionável. Protocolos com assinatura de payload, em vez de token em cabeçalho, precisarão de uma estratégia de autenticação correspondente. Dispositivos vinculados não aceitam webhook: suas mensagens vêm somente da conexão autenticada do worker. IDs de entrega aceitam números e strings conforme o protocolo.

## WhatsApp por dispositivo vinculado

`WhatsAppChannel` usa [`baileys`](https://github.com/WhiskeySockets/Baileys), com licença MIT. A conexão funciona como um dispositivo vinculado por QR Code; não usa a Cloud API da Meta. A biblioteca é não oficial: mudanças no WhatsApp podem interromper a conexão e há risco de restrição da conta.

O worker fala o protocolo multi-dispositivo direto por WebSocket, sem navegador. Cada ligação abre um socket próprio; não há executável externo a instalar nem variável de ambiente a configurar. Processos que executam somente a API não abrem socket algum.

Conectar é `POST /v1/profiles/{profileId}/channels` com `{"type":"whatsapp"}` e ler o QR Code. Não há credencial a informar: ela nasce do pareamento. O `webhookToken` do contrato comum não é usado pelo WhatsApp; o canal não aceita entrada HTTP pública.

Todas as operações abaixo exigem o token de administrador, inclusive a consulta do QR. A base é `/v1/profiles/{profileId}/channels/{channelId}`:

| Método e caminho | Comportamento |
| --- | --- |
| `POST /connect` | Solicita ao worker a abertura/restauração do dispositivo; responde `202` |
| `GET /connection` | Estado: `connecting`, `qr`, `connected`, `disconnected` ou `error` |
| `GET /qr` | Payload para renderizar um QR e seu prazo de validade; resposta `no-store` |
| `POST /disconnect` | Invalida a conexão e apaga o arquivo de sessão criptografado; responde `202` |

No telefone, use **Aparelhos conectados → Conectar um aparelho** e leia o QR renderizado pelo cliente. Ele expira e pode ser substituído durante o pareamento: consulte `/qr` novamente se receber `409`. Nunca envie o QR para geradores externos. O Gateway não imprime o QR, cookies, chaves ou arquivos de sessão nos logs.

O estado `connected` indica que é possível enviar mensagens; `sessionSavedAt` indica que um backup recuperável já foi persistido. As credenciais do pareamento são gravadas antes de o estado virar `connected`, e gravações seguintes são agrupadas em cerca de um segundo. A parada normal descarrega o que estiver pendente; um encerramento abrupto pode perder a última rotação de chaves e exigir novo QR.

As sessões e o QR são criptografados com o mesmo keyring AES-256-GCM do Gateway e vinculados ao perfil/canal por dados autenticados. A sessão é serializada em JSON, limitada a 64 MiB e dividida em partes autenticadas. Ela existe em texto claro apenas na memória do worker: nenhum arquivo de sessão é escrito em disco. O socket do WhatsApp faz sua própria comunicação, fora do cliente HTTP usado pelos providers/MCPs.

Uma lease no banco atribui a conexão a um worker. A geração e o contador de posse impedem que callbacks ou backups antigos restabeleçam uma sessão desconectada. Desconectar o canal também apaga suas credenciais recuperáveis. O logout remoto é tentado pelo worker; se ele estiver indisponível, remova o dispositivo no próprio telefone para revogar também no WhatsApp.

Mensagens de texto diretas e de grupo são persistidas em uma caixa de entrada, deduplicadas e submetidas quando a sessão deixa de estar ocupada. A caixa de entrada aceita mensagens de qualquer remetente, porque a decisão de atender vem depois, na aprovação do contato ou do grupo; há limite de 1.000 mensagens pendentes por canal e atingir esse limite interrompe a conexão com erro. Numa sala, o remetente é o participante e a conversa é o JID `@g.us`; a menção do protocolo chega junto. Mensagens próprias, status, mídia e chamadas são ignorados pelo driver. O WhatsApp não fornece um nome de exibição barato nessa rota, então a solicitação de contato mostra o número.

Respostas usam a fila de entregas comum. `sent` significa que a biblioteca confirmou o envio, não que o destinatário leu a mensagem. Confirmações perdidas viram `unknown` e não provocam reenvio automático. Os IDs remotos são strings no WhatsApp e continuam numéricos no Telegram.

A validação automatizada usa um dispositivo simulado. O pareamento, a restauração da sessão e a entrega real exigem um worker com saída para o WhatsApp e um telefone. Os testes locais não conectam uma conta real.
