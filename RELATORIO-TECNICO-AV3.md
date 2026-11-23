# Relatório técnico — GreenCode API (AV3)

## 1. Objetivo e visão da arquitetura

A GreenCode API apoia a logística reversa de equipamentos eletrônicos. A aplicação usa Node.js e TypeScript, Fastify para HTTP, Prisma para acesso ao PostgreSQL e BullMQ com Redis para tarefas em segundo plano. O código separa as rotas HTTP, regras de negócio, persistência e processamento assíncrono:

- `src/http/` configura Fastify, autenticação, documentação e controladores.
- `src/analytics/` contém cálculos analíticos e seus serviços de aplicação.
- `src/services/` contém as regras de negócio das entidades da AV2 e das chaves de API.
- `src/infra/repositories/` implementa consultas e gravações com Prisma.
- `src/queue/` configura filas, workers, agendamentos e arquivos de relatórios.

Os controladores recebem e validam as requisições, aplicam hooks de autenticação/autorização e chamam serviços. Os serviços executam as regras; repositórios concentram o acesso a dados. As operações que precisam manter alterações e Journal consistentes usam transação PostgreSQL.

## 2. Biblioteca e métodos estatísticos

O projeto não adiciona uma biblioteca estatística externa. `src/analytics/Estatistica.ts` implementa média aritmética e regressão linear simples com operações numéricas do TypeScript/JavaScript. Essa escolha mantém poucas dependências e torna explícitos os cálculos usados nesta avaliação. As funções recusam valores não finitos; a regressão exige pelo menos dois pontos e retorna ausência de resultado quando todos os valores de `x` são iguais.

Essa implementação é pequena e suficiente para os indicadores descritos abaixo. Ela não oferece testes estatísticos, intervalos de confiança ou modelos avançados; as previsões devem ser interpretadas com as limitações indicadas em cada resultado.

## 3. As três análises

### Eficiência operacional

`ServicoAnaliseEficienciaPrisma` procura no Journal eventos `CONCLUIR_TRIAGEM_LOTE` dentro do período solicitado, cruza o lote com sua data de entrada e calcula o tempo entre entrada e conclusão em horas. O resultado apresenta média geral, distribuição por operador, operadores acima da média, até cinco maiores durações e registros ignorados. Pode comparar dois períodos e informar diferença média e variação percentual. Quando não há dados, a média é `null` e o resultado indica `semDados`.

### Rentabilidade por equipamento

`ServicoAnaliseRentabilidadePrisma` usa avaliações manuais registradas para cada equipamento. A avaliação guarda valor recuperado, estado físico observado, data, responsável e observação; o registro também gera um evento no Journal dentro da mesma transação. A análise agrupa médias por tipo, estado físico e marca/modelo/estado, apresenta até dez maiores valores e calcula estimativas somente para equipamentos sem valor real cujo perfil (tipo, marca, modelo e estado) possua amostra real. Cada estimativa informa a quantidade de amostras. O sistema não infere valores quando não há perfil comparável.

### Vida útil preditiva

`ServicoAnaliseVidaUtilPrisma` ordena os estados físicos em uma escala ordinal de `NOVO` a `INSERVIVEL` e usa observações históricas do Journal por equipamento. Com pelo menos duas observações e tendência positiva, a regressão linear estima quantos dias faltariam até o estado inservível. Equipamentos já inservíveis, com dados insuficientes ou sem tendência de deterioração recebem situações distintas, sem previsão artificial. O resultado também resume previsões por tipo de equipamento. A escala supõe intervalos iguais entre estados e os eventos antigos podem não conter histórico suficiente; a estimativa é indicativa, não uma garantia de vida útil.

## 4. Persistência dos resultados analíticos

O modelo Prisma `ResultadoAnalitico`, mapeado para `resultados_analiticos`, guarda UUID, tipo da análise, data de geração, período opcional, filtros JSON, resultado JSON, usuário opcional e `tarefaId` opcional. `tarefaId` é único: quando a mesma tarefa BullMQ é repetida, o serviço atualiza o registro associado em vez de criar duplicatas. Índices por tipo/data e usuário/data apoiam consultas históricas.

Os valores de recuperação são armazenados separadamente em `recuperacoes_equipamentos`, relacionados ao equipamento e indexados por equipamento/data. O histórico de estado e de operações usado pelas análises vem da tabela `journal`.

## 5. API pública

As rotas públicas têm prefixo `/api/v1/public` e recebem credencial no cabeçalho `x-api-key`. Hoje oferecem:

- Consulta de rastreabilidade de equipamento, delimitada à organização da chave.
- Listagem paginada de lotes da organização em um período, consulta de lote e envio de lote.
- Solicitação de relatório analítico, consulta do status da tarefa e download do JSON concluído.

A solicitação do relatório responde `202 Accepted` com o identificador da tarefa. A consulta de status verifica a fila e só informa o relatório disponível quando o arquivo existe. O download só é permitido após conclusão e o acesso também confere a organização proprietária da chave. A fila ausente retorna `503`; tentar baixar antes da conclusão retorna `409`.

## 6. Autenticação e escopo de API Key

Uma API Key contém 32 bytes aleatórios codificados em Base64 URL-safe e tem prefixo `gcp_live_`. No momento da criação, o segredo completo é mostrado uma única vez. O banco guarda o prefixo e o SHA-256 do segredo, com restrição de unicidade; a chave original não é persistida. Na autenticação, o serviço valida o formato, calcula o hash e procura uma chave ativa, não expirada nem revogada. A chave é apresentada por `x-api-key`.

Cada chave pertence a uma organização e recebe permissões explícitas (`RASTREAR_EQUIPAMENTO`, `LER_LOTES`, `ESCREVER_LOTES` e `GERAR_RELATORIOS_ANALITICOS`). Os hooks verificam primeiro a credencial e depois a permissão da rota. Consultas e tarefas usam a organização vinculada à chave, evitando que o parceiro escolha livremente outro escopo. A gestão das chaves é feita pelas rotas internas autenticadas por JWT; listagens não revelam o hash nem o segredo.

## 7. Limite de requisições

As rotas públicas aplicam `@fastify/rate-limit` com limite de 60 requisições por minuto. A chave de contagem é o SHA-256 do valor `x-api-key`, evitando usar o segredo diretamente como identificador de rate limit; sem esse cabeçalho, o plugin usa o IP da requisição. O limite é configurado por rota pública.

Na configuração atual não foi conectado um armazenamento compartilhado ao plugin. Portanto, os contadores ficam no processo da aplicação: instâncias diferentes não compartilham o limite, e reiniciar o processo reinicia os contadores. Uma implantação com várias réplicas deve adotar um armazenamento distribuído para aplicar um limite comum.

## 8. Documentação e versionamento

O OpenAPI 3.0.3 declara a API como versão `1.0.0`, documenta esquemas de segurança Bearer JWT e API Key e descreve rotas e respostas. O documento estático fica em `/openapi.json` e `/docs/json`; o Swagger UI fica em `/docs/`. As rotas de integração para parceiros usam o prefixo `/api/v1/public`; as rotas internas existentes permanecem sem esse prefixo nesta implementação. Mudanças incompatíveis nas rotas de parceiros devem ser publicadas em um novo prefixo de versão.

## 9. Processamento assíncrono

O endpoint público publica uma tarefa na fila BullMQ `relatorios-analiticos`, atribuindo um UUID ao job. O worker de relatórios é um processo independente iniciado por `npm run worker:relatorios`. Ele valida o escopo da organização, chama o serviço analítico solicitado, grava o resultado no PostgreSQL, atualiza o progresso e grava um JSON no diretório configurado por `REPORTS_DIRECTORY` (padrão `data/relatorios-analiticos`). A API consulta o estado BullMQ e serve esse arquivo somente para a organização dona da chave e depois da conclusão.

As análises automáticas usam uma segunda fila, `analises-agendadas`, e um processo iniciado por `npm run worker:analises-agendadas`. Os horários registrados no Redis são: eficiência operacional no primeiro dia do mês às 02:00, rentabilidade às segundas-feiras às 02:10 e vida útil às segundas às 02:20, em `America/Sao_Paulo`. A eficiência usa o mês completo anterior; os cálculos agendados abrangem os dados globais disponíveis.

## 10. Tentativas e tratamento de falhas

As duas filas configuram até três tentativas por tarefa, com espera exponencial iniciada em um segundo. Os jobs concluídos e falhos são mantidos no Redis (`removeOnComplete: false` e `removeOnFail: false`), permitindo consultar estado e investigar falhas. Os workers registram identificador, tipo, tentativa e erro/resultado nos logs. Falhas continuam sendo propagadas pelo processador para que BullMQ aplique a política de retry. A retenção não tem limpeza automática configurada nesta versão.

O resultado analítico associado ao UUID do job é idempotente no banco. Para o arquivo, o worker grava primeiro um arquivo temporário exclusivo e depois renomeia para o nome final; uma repetição bem-sucedida substitui o mesmo caminho da tarefa.

## 11. Filas e processos workers

API, PostgreSQL e Redis são dependências configuradas por ambiente. Os workers são processos separados da API e podem ser executados em terminais/processos próprios. O worker de relatórios consome `relatorios-analiticos`; o worker analítico consome `analises-agendadas` com concorrência 1. IDs fixos tornam o registro dos agendamentos repetível. Redis guarda fila, estado, tentativas e agendamentos; o PostgreSQL guarda os resultados duráveis; os arquivos JSON ficam no disco local configurado.

## 12. Armazenamento e limitações operacionais

Os resultados estruturados são persistidos no PostgreSQL e os downloads são servidos de arquivos JSON locais. Redis não é o arquivo definitivo dos resultados; é a infraestrutura operacional das filas e dos estados de tarefa. O diretório local facilita a execução acadêmica em uma única máquina, mas exige espaço em disco, política de cópia/backup e compartilhamento de volume se API e workers executarem em máquinas diferentes. Esta versão não implementa armazenamento de objetos externo nem limpeza automática de arquivos e jobs retidos.

## 13. Evolução para centenas ou milhares de parceiros

O isolamento atual por organização na API Key é uma base para integração multiempresa, mas a configuração atual é voltada a uma instância/sistema acadêmico. Para crescer, a implantação pode:

1. Executar múltiplas instâncias da API atrás de um balanceador e manter autenticação/stateless nas instâncias.
2. Mover o rate limit para um armazenamento compartilhado e centralizar emissão, rotação, expiração e auditoria de chaves.
3. Escalar workers de relatórios horizontalmente, definindo concorrência e limites por parceiro para evitar que um cliente monopolize recursos.
4. Trocar arquivos locais por armazenamento de objetos compartilhado, com links temporários autorizados, política de retenção e criptografia.
5. Dimensionar PostgreSQL com pool de conexões, índices observados por métricas, paginação e, se o volume justificar, particionamento/arquivamento de históricos.
6. Adicionar métricas, rastreamento distribuído, alertas, quotas por parceiro e monitoramento de idade/fila de jobs.

Esses pontos são caminhos de evolução, não recursos implementados nesta entrega. As prioridades dependem de métricas reais de volume, latência, custo e requisitos de retenção.
