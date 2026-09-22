# Arquitetura do Gateway

```text
Clientes / canais -> API e contratos -> serviços -> PostgreSQL
                                              -> fila -> runtime -> provider / MCP
```

`apps/gateway` contém o produto executável. `packages/contracts` define entradas, saídas públicas, permissões e identificadores estáveis de operações. `packages/sdk` depende somente do contrato HTTP gerado. Cada produto mantém seus testes e build; Biome, pnpm e hooks são compartilhados na raiz.

Cada área é uma pasta em `apps/gateway/src` com serviço, rotas, porta e tipos de registro; área nova é pasta nova com essas quatro peças. A dependência corre em um sentido só: `core/` — erros, relógio, store, eventos — não conhece área alguma, as áreas dependem de `core/`, `app.ts` registra as rotas de cada área e `main.ts` monta o processo. O mapa dos registros persistidos vive em `src/records.ts`, junto de `src/services.ts`, na camada de composição, porque listar as áreas é trabalho de quem as compõe; em `core/` ele faria `core/` importar de volta o que depende dele. Um consumidor recebe a porta de que precisa, não o serviço inteiro: `agent/tools.ts` declara `ProfileAdmin`, `MemoryWriter`, `SessionReader`, `RunReader`, `PeerAgents` e `RunExecution`, nunca as classes que os cumprem.

Perfil, revisões, sessões, mensagens, memórias e execuções são áreas do gateway; `Vault`, `Coordination`, `Peers` e `Channels` isolam o armazenamento cifrado, histórico/artefatos/reservas, conversa entre perfis e transporte externo. O cofre não tem rotas: cada segredo é endereçado pela coisa que o usa (`provider:<id>`, `mcp:<nome>`, `channel:<id>`), então remover a coisa remove o segredo. A montagem HTTP não deve conter regras de provider ou manipular ciphertexts. `http/security.ts` centraliza autenticação e erros públicos; `http/events.ts` controla as conexões de eventos. Em `agent/`, descoberta MCP e tratamento de resultados ficam separados da execução do agente.

Os canais implementam `Channel` e são selecionados por um registro de adaptadores. O serviço comum controla acesso e entregas duráveis; cada adaptador traduz somente seu protocolo. Veja [Canais](channels.md).

PostgreSQL armazena registros tipados em JSONB e eventos duráveis. Índices cobrem perfil/tipo/ordem, filtros JSONB e pesquisa textual de conteúdo/chave. A paginação de histórico usa um cursor de registro e sequência monotônica, sem OFFSET. Transações curtas usam advisory locks por perfil; nenhuma chamada de IA deve acontecer dentro delas.

Migrações versionadas rodam em transação, com lock global. A versão inicial pode adotar instalações anteriores; schemas mais novos que o binário impedem a inicialização. Perfis e snapshots legados recebem defaults de identidade/orçamento ao serem lidos. Revisões históricas preservam sua versão.

O dispatcher envia runs persistidos para pg-boss; a claim transacional impede que workers concorrentes executem o mesmo run. Lease e heartbeat detectam workers perdidos. Checkpoints registram início de ferramentas e resultado de etapas. Resultados grandes usam referências para artefatos; resultados pequenos são persistidos com limite e redação de segredos conhecidos.

O contexto é composto em cada etapa. Instruções/identidade e catálogos pequenos formam a parte estável. Memórias relevantes, atividade de outras sessões e histórico recente formam a parte dinâmica. O orçamento também conta schemas ativos e resultados de ferramentas. Ao reduzir histórico, pares de chamada/resultado de ferramenta são mantidos juntos. Cada bloco é tokenizado uma vez por preparação; os cortes subtraem o custo já calculado. Se o turno obrigatório não couber, a execução falha antes de chamar o modelo.

As memórias são explícitas, versionadas e compartilhadas pelo perfil; não há aprendizado de pesos ou consciência literal. Comunicação entre sessões usa uma caixa de mensagens consultável. O agente escolhe consultar histórico, checkpoints, artefatos e outras atividades por ferramentas.

## Conversa entre perfis

O isolamento por perfil tem uma porta declarada, e ela é de dados: um perfil descobre os outros da instalação e fala com um deles, mas o que atravessa é texto. A descoberta devolve identificador, nome e o resumo escrito pelo dono — nunca instruções, identidade, skills, memórias, credenciais ou histórico. Toda outra leitura continua presa ao perfil de quem chama; não há caminho, por ferramenta ou por rota, que leia registro alheio.

A chamada vira uma execução comum no perfil chamado: chave, contexto, lease e checkpoints dele. Ela acontece na sessão que aquele par de agentes compartilha — uma por par, do lado de quem foi chamado, marcada com `peerProfileId` e invisível para quem chamou —, então colegas mantêm continuidade em vez de recomeçar a cada pedido. Quem chamou espera o run terminar e recebe a saída como texto; um colega que falha ou demora vira erro explícito, não silêncio. Os dois perfis registram o evento (`agent.call.sent` e `agent.call.received`), que é como o dono audita quem falou com quem.

Conversa entre agentes termina, porque cada volta custa dinheiro. O orçamento de profundidade viaja com a cadeia: o run criado por uma chamada guarda em `call` o que já foi gasto e a lista ordenada de perfis por onde a conversa passou, e quem é chamado herda esse gasto em vez de recomeçar do zero. Estourar o limite é erro claro. Só responde quem foi endereçado — a resposta volta para quem chamou e para mais ninguém — e um perfil que já falou na cadeia não é chamado de novo, então ninguém reabre o que encerrou e nenhum ciclo se forma. Grupos de canal com vários agentes e um protocolo público entre instalações ficam para depois; ambos devem entrar por cima desta porta, sem abrir outra.

## Limites de produto

- Sem interface macOS nesta etapa.
- Sem embeddings, busca semântica ou sumarização por outro LLM.
- Sem múltiplas organizações ou ACL por participante dentro do perfil.
- Sem sala de canal com vários agentes e sem protocolo público entre instalações.
- Sem garantia de replay exatamente uma vez de efeitos externos.
- Sem sandbox de execução de código ou instalador arbitrário de MCPs/skills.
- Sem contabilidade financeira por moeda; uso de tokens e limites são registrados.

Essas extensões devem usar os contratos públicos e preservar as fronteiras de autorização atuais.
