# Limpeza da superfície do painel

Primeira de cinco especificações do redesenho. Três módulos do painel mudam de natureza: o
cofre de credenciais deixa de ser tela, as chaves de acesso deixam de existir, e memórias
passam a ser leitura. É a especificação mais de remoção do conjunto, e por isso vem antes:
ela encolhe a superfície que as outras quatro precisam considerar.

## 1. O cofre sai da interface

Hoje o segredo tem tela própria: você cria uma credencial em um lugar e a referencia em
outro, porque `providerInputSchema` exige `credentialId`. São dois passos e dois conceitos
para uma coisa só.

Passa a valer uma regra: **o segredo é digitado onde a coisa é configurada**. A chave da
OpenAI, da Anthropic e do Gemini é digitada na tela de Providers. O token de um servidor
MCP é digitado junto do servidor. O token de um canal é digitado junto do canal.

O cofre continua existindo como armazenamento cifrado por perfil, com a mesma rotação de
chaves do host. Ele deixa de ser um módulo e vira detalhe interno.

No contrato:

- `providerInputSchema` troca `credentialId` por um campo de segredo marcado como somente
  escrita. O gateway cifra e guarda; a resposta nunca devolve o valor.
- As quatro rotas de credencial saem do contrato: listar, criar, revogar e rotacionar.
- O registro de provider não expõe parte alguma do segredo. Mostra que existe e desde
  quando.
- `mcpSchema` e a entrada de canal seguem a mesma regra: onde hoje há um identificador de
  credencial, passa a haver um campo de segredo somente escrita.
- Trocar a chave é enviar outra no mesmo provider. Remover é revogar o provider. São as
  duas únicas operações, como o dono pediu.

A tela de Credenciais é apagada do painel.

## 2. Chaves de acesso deixam de existir

Toda a funcionalidade é descartada. Quem chama a API usa o token de administrador, que tem
controle total.

- As três rotas de chave saem do contrato.
- `scopeSchema` some. Cada operação passa a ser `admin`, `public` ou `webhook`.
- A autorização por escopo sai do serviço de segurança, junto com a guarda que impedia uma
  requisição com escopo de mudar concessão de capacidade em `updateProfile`.
- Registros do tipo `accessKey` deixam de ser lidos e escritos.

Consequência que vale dizer uma vez: **o app da Apple passa a guardar o token de
administrador**. Hoje ele guarda uma chave com escopo, que só lê. Depois desta mudança, o
aparelho que tiver o token tem a instalação inteira. O caminho certo para um app nativo é
pareamento por dispositivo, e isso não entra agora — entra quando o app nativo virar
prioridade.

A tela de Chaves de acesso é apagada do painel.

## 3. Memórias viram leitura

Memória é do agente. Só o agente escreve, pelas suas próprias ferramentas.

- A tela lista o que o agente guardou, com busca, e permite **apagar**. Não permite criar
  nem editar.
- `PUT /memories` sai do contrato. Uma rota de remoção entra no lugar — ela não existe
  hoje, e é a única adição desta especificação.
- A ferramenta de memória do agente continua como está. O que faltar nela é assunto da
  especificação de skills.

Apagar fica porque memória errada é o defeito mais caro de deixar sem saída: o agente
repete o erro em toda sessão nova, e sem botão o dono não tem como cortar.

## O que não muda

O cofre como armazenamento cifrado, a rotação do keyring do host, a sessão do painel por
cookie assinado, e o isolamento por perfil.

## Fora de escopo

Providers e modelos vindos da API, papéis novos de modelo padrão, redesenho de canais,
conversa entre perfis, skills com marketplaces, e o redesenho do banco. Cada um tem sua
própria especificação.

## Riscos

- **O middleware de autenticação é caminho único de tudo.** Tirar o escopo mexe no lugar
  por onde passa toda requisição. Um caminho esquecido vira 401 silencioso em produção, ou
  pior, uma rota que deixa de exigir token. Os testes de segurança existentes cobrem a
  matriz; qualquer rota nova sem cobertura é bloqueio.
- **O app da Apple compila contra o contrato gerado.** Remover rotas quebra a build dele,
  então ele entra no mesmo lote, não depois.
- **Providers existentes apontam para credenciais por identificador.** Como o banco vai ser
  recriado, não há migração de dados a escrever; se isso mudar, muda também esta linha.
