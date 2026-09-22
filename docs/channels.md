# Canais

Uma ligação associa um canal a uma sessão existente. O administrador define o perfil indiretamente pela rota, a sessão, os IDs de atores e os IDs de chats permitidos. A entrada externa não pode escolher outro perfil, sessão ou credencial.

`POST /v1/profiles/{profileId}/channels` retorna um `webhookToken` somente na criação. O banco guarda apenas o hash. `DELETE /v1/profiles/{profileId}/channels/{channelId}` revoga a ligação. Se precisar trocar sessão, público ou token, revogue e crie outra ligação.

## Entrada genérica

Envie `actorId`, `chatId`, `text` e `requestKey` a `POST /v1/ingress/{channelId}`, usando `X-Jian-Channel-Token`. O adapter que chama essa rota deve autenticar a identidade externa antes de preencher os IDs; quem possui o token pode representar atores permitidos. O retorno contém o ID do run. Consulte resultados pela API administrativa.

## Telegram

1. Cadastre o token do bot no cofre com `kind: "channel"`.
2. Crie uma ligação `type: "telegram"`, informando `token` (o token do BotFather), sessão e IDs permitidos. O token é cifrado no cofre e nunca é devolvido.
3. Configure no Telegram o webhook HTTPS `/v1/telegram/{channelId}`, passando o `webhookToken` como `secret_token` e limitando `allowed_updates` a `message`.

O Gateway valida `X-Telegram-Bot-Api-Secret-Token`, ator e chat antes de aceitar mensagens. Reentregas de um mesmo update recuperam o mesmo run. A resposta final é enviada em partes de até 4.000 caracteres, sem modo de interpretação HTML/Markdown. As configurações seguem a [API oficial do Telegram](https://core.telegram.org/bots/api#setwebhook).

Esta implementação atende mensagens de texto de usuários com `from`, `chat` e `text`; mídias, edições, callbacks e tópicos separados não estão implementados. Cada ligação usa uma sessão: todos os chats permitidos nela compartilham o histórico. Crie ligações distintas quando precisar separar sessões.

O worker processa entregas após a conclusão do run. `GET /v1/profiles/{profileId}/deliveries` mostra `pending`, `sending`, `sent`, `failed` ou `unknown`. Falhas incertas não são repetidas automaticamente; consulte os IDs de mensagens confirmadas antes de uma ação manual.

A configuração do webhook no serviço externo é responsabilidade do operador. Os testes locais simulam Telegram e não configuram um bot real.

## Adaptadores

Cada protocolo implementa `Channel`, em `apps/gateway/src/channels/channel.ts`. `GenericChannel` normaliza a entrada HTTP; `TelegramChannel` interpreta updates e envia respostas. `WhatsAppChannel` usa a conexão de dispositivo vinculado mantida pelo worker. `ChannelRegistry` seleciona o adaptador pelo tipo configurado, sem ramificações de protocolo no serviço `Channels`.

A interface define o cabeçalho opcional de autenticação do webhook, a normalização de entrada, a validação opcional de configuração e o envio opcional. A ausência de `send` significa que o canal só recebe: o genérico não produz uma entrega fictícia. Credenciais e o cliente HTTP protegido são fornecidos ao adaptador somente durante o envio.

O serviço comum mantém as garantias compartilhadas: autenticação do token, atores/chats permitidos, vínculo com perfil/sessão, deduplicação, registro da entrega e recuperação de estados incertos. Os adaptadores não escolhem permissões nem acessam o banco. Antes de enviar, o serviço grava `sending` em uma transação; se perder a confirmação, marca `unknown` em vez de repetir um possível efeito externo.

Para adicionar um protocolo, implemente o adaptador, registre-o e declare seu tipo e entrada em `packages/contracts`, incluindo a rota HTTP quando necessária. Gere novamente o OpenAPI/SDK. A interface é interna; o contrato público continua sendo explícito e versionável. Protocolos com assinatura de payload, em vez de token em cabeçalho, precisarão de uma estratégia de autenticação correspondente. Dispositivos vinculados não aceitam webhook: suas mensagens vêm somente da conexão autenticada do worker. IDs de entrega aceitam números e strings conforme o protocolo.

O vínculo fixo foi escolhido para tornar o acesso explícito e evitar que o remetente escolha uma sessão arbitrária. Isso não equivale a roteamento automático por conversa externa. Esse roteamento, quando implementado, deve associar cada chat/tópico a uma sessão sem perder as memórias compartilhadas do perfil.

## WhatsApp por dispositivo vinculado

`WhatsAppChannel` usa [`baileys`](https://github.com/WhiskeySockets/Baileys), com licença MIT. A conexão funciona como um dispositivo vinculado por QR Code; não usa a Cloud API da Meta. A biblioteca é não oficial: mudanças no WhatsApp podem interromper a conexão e há risco de restrição da conta.

O worker fala o protocolo multi-dispositivo direto por WebSocket, sem navegador. Cada ligação abre um socket próprio; não há executável externo a instalar nem variável de ambiente a configurar. Processos que executam somente a API não abrem socket algum.

Crie uma ligação usando `type: "whatsapp"`, a sessão existente e os contatos autorizados em `actorIds` e `chatIds`. Para conversas diretas, ambos usam o mesmo JID, como `5511999999999@c.us`. O driver resolve identificadores LID para telefone quando o WhatsApp fornece esse mapeamento; IDs `@lid` também podem ser autorizados explicitamente. Não informe `token`: a sessão do aparelho é criada pelo pareamento. O `webhookToken` do contrato comum não é usado pelo WhatsApp; o canal não aceita entrada HTTP pública.

Exemplo de corpo para `POST /v1/profiles/{profileId}/channels`:

```json
{
  "name": "WhatsApp pessoal",
  "type": "whatsapp",
  "sessionId": "00000000-0000-4000-8000-000000000001",
  "actorIds": ["5511999999999@c.us"],
  "chatIds": ["5511999999999@c.us"]
}
```

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

Uma lease no banco atribui a conexão a um worker. A geração e o contador de posse impedem que callbacks ou backups antigos restabeleçam uma sessão desconectada. Revogar a ligação também apaga suas credenciais recuperáveis. O logout remoto é tentado pelo worker; se ele estiver indisponível, remova o dispositivo no próprio telefone para revogar também no WhatsApp.

Mensagens de texto diretas são persistidas em uma caixa de entrada, deduplicadas e submetidas quando a sessão deixa de estar ocupada. Há limite de 1.000 mensagens pendentes por ligação; atingir esse limite interrompe a conexão com erro. Mensagens próprias, grupos, status, mídia e chamadas são ignorados. Os contatos autorizados em uma ligação compartilham a mesma sessão; use ligações/sessões separadas para contextos distintos e evite vincular a mesma conta a múltiplos canais que atendam o mesmo contato.

Respostas usam a fila de entregas comum. `sent` significa que a biblioteca confirmou o envio, não que o destinatário leu a mensagem. Confirmações perdidas viram `unknown` e não provocam reenvio automático. Os IDs remotos são strings no WhatsApp e continuam numéricos no Telegram.

A validação automatizada usa um dispositivo simulado. O pareamento, a restauração da sessão e a entrega real exigem um worker com saída para o WhatsApp e um telefone. Os testes locais não conectam uma conta real.
