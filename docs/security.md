# Segurança e operação

## Fronteira de confiança

Uma instalação pertence a um dono confiável. `JIAN_API_TOKEN` é a única credencial da API e abre a instalação inteira: mantenha-o no host e só o entregue a aparelhos em que você confia. Não há chaves de cliente com permissão reduzida — quem tem o token pode tudo. Todas as sessões de um perfil compartilham o mesmo acesso aos dados e ferramentas daquele perfil. Não conecte públicos com permissões diferentes ao mesmo perfil.

Cada operação do contrato é `admin`, `public` ou `webhook`. Só `/health` e a troca do token por um cookie de painel respondem sem autenticação; um webhook autentica o token da própria ligação de canal, que é aleatório, tem 256 bits de entropia e é persistido como hash SHA-256. Todo o resto exige o token do host ou o cookie do painel assinado com ele.

Chaves de provider, tokens de MCP e de canal são digitados onde a coisa é configurada, cifrados por perfil e nunca devolvidos em leitura alguma.

Perfis conversam entre si trocando texto, e só texto: a descoberta mostra nome e o resumo escrito pelo dono, a resposta é a saída do run de quem foi chamado, e nenhuma ferramenta lê memória, credencial, sessão ou histórico de outro perfil. O texto que chega de outro agente é dado não confiável como qualquer entrada — o nome de quem chama é endereçamento, não autoridade. A cadeia de chamadas é limitada por um orçamento de profundidade que viaja com ela e por não chamar duas vezes o mesmo perfil na mesma conversa; sem isso, agentes se respondem em laço e cada volta gasta chave de provider.

## Criptografia e rotação

`JIAN_MASTER_KEYS` é um objeto JSON de identificadores para chaves de 32 bytes em Base64. `JIAN_ACTIVE_KEY_ID` escolhe a chave usada para novas gravações. O setup cria um keyring em `.env` com permissão `0600`; na hospedagem, injete-o por um gerenciador de segredos. Não coloque esse keyring no banco, no Git ou no mesmo backup do banco.

AES-256-GCM usa nonce aleatório por gravação. Os dados autenticados vinculam cada ciphertext ao perfil e ao dono do segredo — `provider:<id>`, `mcp:<nome>`, `channel:<id>` —, impedindo a troca de envelopes entre registros ou entre perfis. Essa proteção cobre vazamento isolado do banco; um processo worker comprometido também pode acessar as chaves em memória.

Para rotacionar:

1. Gere outra chave aleatória de 32 bytes e adicione-a ao keyring com outro ID.
2. Distribua o keyring completo a todas as APIs/workers e altere o ID ativo.
3. Reenvie cada segredo pela tela que o configura: um provider cifra a chave nova com o ID ativo, e o mesmo vale para o token de um servidor MCP ou de um canal.
4. Só remova a chave antiga do keyring depois disso. Backups antigos continuam dependendo dela.

Reenviar a chave no cofre não troca a chave no provider. Para trocar a chave externa, digite a nova na tela de Providers: o gateway revoga o provider anterior e descarta o segredo dele. Runs enfileirados guardam a configuração antiga; cancele-os se a troca for urgente.

O token administrativo fica no ambiente, separado do banco. Troque-o no host e reinicie API/workers; a troca também invalida os cookies de sessão do painel, que são assinados com ele. Nunca envie segredos em parâmetros de URL; use HTTPS e armazene tokens do cliente no cofre do sistema operacional.

## Rede e limites

Providers e MCPs usam o mesmo transporte de saída. Ele exige HTTPS público, valida e fixa a resolução DNS na conexão, bloqueia redirecionamentos, credenciais embutidas e destinos privados. `JIAN_ALLOW_PRIVATE_ORIGINS` permite origens exatas para serviços internos administrados pelo dono, por exemplo `http://127.0.0.1:11434`. Endereços de metadata e link-local continuam proibidos.

A API limita o corpo a 256 KiB, aplica rate limit por endereço de conexão e limita streams. Ela não confia automaticamente em `X-Forwarded-For`; atrás de um proxy todos os clientes podem compartilhar o limite. Configure limites adicionais no proxy conforme a implantação. Instâncias distintas têm contadores HTTP próprios; os limites de runs e as reservas de recursos ficam no banco.

Inputs desconhecidos são rejeitados nos contratos administrativos. Logs não incluem corpos, cabeçalhos de autenticação ou exceções de providers. Memórias, mensagens e artefatos são dados do usuário e permanecem em texto no banco: criptografia de credenciais não significa criptografia integral das conversas. Restrinja acesso ao banco e aos backups.

Skills e resultados de ferramentas são instruções/dados não confiáveis. As listas de ferramentas permitidas reduzem capacidades; elas não eliminam prompt injection. Habilite apenas as ferramentas que o perfil pode realmente exercer e use credenciais externas de menor privilégio.

## Falhas e efeitos externos

Uma lease expirada interrompe o run; não reinicia automaticamente ferramentas. A continuação exige reconciliação explícita, cria outro run e preserva os checkpoints anteriores. Ela não oferece exatamente uma execução de efeitos externos.

Reservas de recursos coordenam sessões do mesmo perfil e emitem um número de fence crescente. Um recurso externo só está protegido contra um titular antigo se também validar esse número; a reserva não intercepta automaticamente todos os MCPs.

Uma entrega Telegram sem confirmação recebe estado `unknown` e não é reenviada automaticamente. Envios abandonados são marcados incertos após dez minutos. Verifique o destino antes de reenviar manualmente. Cancelar um run não desfaz ações já executadas.

## Reportar vulnerabilidades

Não publique credenciais ou provas com dados privados em issues. Antes de disponibilizar o projeto publicamente, configure um canal privado de contato e o recurso de reporte privado do repositório. Use dados sintéticos para reproduções.

## Dispositivos WhatsApp

Parear por QR concede acesso à conta. Conexão, estado e QR exigem o token do host; o QR é criptografado no banco, expira e usa `Cache-Control: no-store`. Backups da sessão são criptografados e isolados por perfil/canal. Callbacks de gerações ou posses antigas não podem regravar credenciais após desconexão/revogação.

A sessão em texto claro existe somente na memória do worker; nada é escrito em disco. O worker abre um WebSocket direto para o WhatsApp: aplique controles de saída também a ele. A integração não é uma API oficial da Meta.
