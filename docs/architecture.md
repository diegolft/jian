# Arquitetura do Gateway

```text
Clientes / canais -> API e contratos -> serviços -> PostgreSQL
                                              -> fila -> runtime -> provider / MCP
```

`apps/gateway` contém o produto executável. `packages/contracts` define entradas, saídas públicas, permissões e identificadores estáveis de operações. `packages/sdk` depende somente do contrato HTTP gerado. Cada produto mantém seus testes e build; Biome, pnpm e hooks são compartilhados na raiz.

O Gateway mantém perfil, revisões, sessões, mensagens, memórias e execuções. Os serviços `Credentials`, `Coordination` e `Channels` isolam cofre/autorização, histórico/artefatos/reservas e transporte externo. A montagem HTTP não deve conter regras de provider ou manipular ciphertexts. `http/security.ts` centraliza autenticação e erros públicos; `http/events.ts` controla as conexões de eventos. Em `runtime`, descoberta MCP e tratamento de resultados ficam separados da execução do agente.

Os canais implementam `Channel` e são selecionados por um registro de adaptadores. O serviço comum controla acesso e entregas duráveis; cada adaptador traduz somente seu protocolo. Veja [Canais](channels.md).

PostgreSQL armazena registros tipados em JSONB e eventos duráveis. Índices cobrem perfil/tipo/ordem, filtros JSONB e pesquisa textual de conteúdo/chave. A paginação de histórico usa um cursor de registro e sequência monotônica, sem OFFSET. Transações curtas usam advisory locks por perfil; nenhuma chamada de IA deve acontecer dentro delas.

Migrações versionadas rodam em transação, com lock global. A versão inicial pode adotar instalações anteriores; schemas mais novos que o binário impedem a inicialização. Perfis e snapshots legados recebem defaults de identidade/orçamento ao serem lidos. Revisões históricas preservam sua versão.

O dispatcher envia runs persistidos para pg-boss; a claim transacional impede que workers concorrentes executem o mesmo run. Lease e heartbeat detectam workers perdidos. Checkpoints registram início de ferramentas e resultado de etapas. Resultados grandes usam referências para artefatos; resultados pequenos são persistidos com limite e redação de segredos conhecidos.

O contexto é composto em cada etapa. Instruções/identidade e catálogos pequenos formam a parte estável. Memórias relevantes, atividade de outras sessões e histórico recente formam a parte dinâmica. O orçamento também conta schemas ativos e resultados de ferramentas. Ao reduzir histórico, pares de chamada/resultado de ferramenta são mantidos juntos. Cada bloco é tokenizado uma vez por preparação; os cortes subtraem o custo já calculado. Se o turno obrigatório não couber, a execução falha antes de chamar o modelo.

As memórias são explícitas, versionadas e compartilhadas pelo perfil; não há aprendizado de pesos ou consciência literal. Comunicação entre sessões usa uma caixa de mensagens consultável. O agente escolhe consultar histórico, checkpoints, artefatos e outras atividades por ferramentas.

## Limites de produto

- Sem interface macOS nesta etapa.
- Sem embeddings, busca semântica ou sumarização por outro LLM.
- Sem múltiplas organizações ou ACL por participante dentro do perfil.
- Sem garantia de replay exatamente uma vez de efeitos externos.
- Sem sandbox de execução de código ou instalador arbitrário de MCPs/skills.
- Sem contabilidade financeira por moeda; uso de tokens e limites são registrados.

Essas extensões devem usar os contratos públicos e preservar as fronteiras de autorização atuais.
