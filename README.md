# GreenCode API

API para gestão de logística reversa de equipamentos eletrônicos, construída com Fastify, Prisma e PostgreSQL.

## Requisitos

- Node.js 20 ou superior
- PostgreSQL compatível com a URL do Prisma

## Configuração local

1. Instale as dependências: `npm install`.
2. Copie `.env.example` para `.env` (`Copy-Item .env.example .env` no PowerShell ou `cp .env.example .env` no Bash).
3. Crie um database e um usuário no PostgreSQL e substitua os marcadores de `DATABASE_URL` e `JWT_SECRET` por valores locais. Use um `JWT_SECRET` aleatório com pelo menos 32 bytes. Para usar o seed, defina também `SEED_ADMIN_PASSWORD` com pelo menos 12 bytes e sem texto de placeholder. Caracteres especiais na senha PostgreSQL devem ser codificados para uso em uma URL.
4. Gere o cliente e aplique as migrações:

   ```sh
   npm run db:generate
   npm run db:migrate
   ```

5. Crie o administrador e os registros demonstrativos:

   ```sh
   npm run db:seed
   ```

O seed cria o usuário `admin` somente se ele ainda não existir. A senha é definida em `SEED_ADMIN_PASSWORD`; executar o seed outra vez não troca a senha já cadastrada. Senhas curtas ou que ainda contenham marcadores como `replace_with` são recusadas. Também cria uma organização, seu contrato, três lotes em etapas diferentes e oito equipamentos com estados de rastreamento e condições físicas variados. O seed contém dados de demonstração e não roda quando `NODE_ENV=production`.

### Variáveis de ambiente

| Variável | Obrigatória | Uso |
| --- | --- | --- |
| `DATABASE_URL` | Sim | URL de conexão PostgreSQL usada por Prisma. |
| `JWT_SECRET` | Sim | Segredo aleatório com pelo menos 32 bytes para assinar tokens JWT. |
| `PORT` | Não | Porta HTTP; padrão `3000`. |
| `REDIS_URL` | Para filas e workers | URL Redis; por exemplo `redis://localhost:6379`. Sem ela, as filas ficam indisponíveis. |
| `SEED_ADMIN_PASSWORD` | Para executar o seed | Senha inicial do administrador; mínimo de 12 bytes. |
| `REPORTS_DIRECTORY` | Não | Diretório de saída/consulta dos JSONs de relatório; padrão `data/relatorios-analiticos`. API e worker de relatórios devem compartilhar o mesmo diretório. |

Não coloque valores reais de `.env` em commits. Use `.env.example` apenas como modelo com placeholders.

## Executar

### Primeiro acesso à plataforma

Depois de instalar as dependências e configurar `DATABASE_URL`, `JWT_SECRET` e `SEED_ADMIN_PASSWORD` no `.env`, confirme que o PostgreSQL está em execução. Na primeira configuração do banco, gere o cliente Prisma, aplique as migrations e crie a conta inicial:

```sh
npm run db:generate
npm run db:migrate
npm run db:seed
```

O seed cria a conta de administrador `admin`. Para entrar, use como senha o valor que você definiu em `SEED_ADMIN_PASSWORD` no `.env`. O seed não altera a senha de uma conta `admin` que já existe; se ele já foi executado antes, use a senha definida naquela primeira execução.

Inicie a aplicação:

```sh
npm run dev
```

Quando aparecer no terminal a mensagem de que o servidor está ouvindo na porta `3000` (ou na porta configurada em `PORT`), abra **http://localhost:3000/** no navegador e entre com `admin` e a senha do seed. O terminal fica ocupado enquanto o servidor estiver ativo; isso é esperado. Mantenha-o aberto durante o uso da plataforma e pressione `Ctrl+C` nele para encerrar o servidor. Se a porta `3000` já estiver em uso, encerre a outra instância ou configure outra porta em `PORT`.

O PostgreSQL é necessário para a aplicação. O Redis é usado pelas filas de relatórios e pelos workers; veja a seção correspondente abaixo para iniciá-lo quando for usar esses recursos.

Para compilar e iniciar:

```sh
npm run build
npm start
```

A API escuta em `0.0.0.0` na porta definida por `PORT` (padrão `3000`). A interface web fica na raiz `/`; após entrar com um usuário existente, ela apresenta as telas autorizadas pelo papel de acesso. Informações da API também ficam em `/api/info`, o estado de saúde em `/health` e o documento OpenAPI em `/openapi.json`.

### Interface web

A interface usa HTML, CSS e JavaScript nativos, sem framework ou dependência adicional. Ela oferece painel e telas para organizações, contratos, lotes, equipamentos, usuários, análises e chaves de API. As operações são enviadas à API existente; as regras de negócio e permissões continuam no servidor. A sessão JWT fica em `sessionStorage` e a interface é servida no mesmo origin da API.

## Workers e análises agendadas

O worker de relatórios solicitados pela API é iniciado com `npm run worker:relatorios`. O agendador/worker de análises automáticas é um processo separado e contínuo, iniciado com `npm run worker:analises-agendadas`; ambos precisam de `REDIS_URL` e `DATABASE_URL` configurados.

No Windows 10 ou superior, instale e inicie Docker Desktop com suporte a containers Linux. No Ubuntu, instale Docker Engine e o plugin Compose. Na raiz do projeto, inicie o Redis definido em `compose.yaml`:

```sh
docker compose up -d redis
docker compose ps
```

O container publica Redis somente em `127.0.0.1:6379` e mantém os dados em um volume Docker. Para pará-lo: `docker compose down`. Não é necessário executar a API dentro do container Redis.

Ao iniciar, o worker registra no BullMQ (Redis) três agendamentos idempotentes:

- Eficiência operacional: no dia 1 de cada mês, às 02:00, calcula o mês-calendário anterior completo.
- Rentabilidade por equipamento: toda segunda-feira, às 02:10.
- Vida útil preditiva: toda segunda-feira, às 02:20.

Os horários usam `America/Sao_Paulo`. Os três cálculos são globais, abrangendo os dados disponíveis de todas as organizações. Resultados ficam em `resultados_analiticos`; jobs concluídos e falhos ficam retidos no Redis para consulta operacional. Falhas são registradas no log do worker e retentadas até três vezes com espera exponencial. Mantenha o processo do worker ativo para consumir as execuções.

## Rotas principais

As rotas internas de negócio exigem JWT Bearer, obtido em `POST /auth/login`. As rotas `/api/v1/public` usam API Key.

| Recurso | Rotas |
| --- | --- |
| Autenticação e usuários | `/auth/login`, `/auth/me`, `/auth/usuarios`, `/auth/usuarios/:id`, `/auth/senha` |
| Organizações | `/organizacoes` e `/organizacoes/:id` |
| Contratos | `/contratos`, `/contratos/:id`, `/contratos/:organizacaoId/renovar` |
| Lotes | `/lotes`, `/lotes/:id`, `/lotes/:id/processar-triagem`, `/lotes/:id/relatorio-triagem` |
| Equipamentos | `/equipamentos`, `/equipamentos/:id`, `/equipamentos/:id/rastreabilidade`, `/equipamentos/:id/status`, `/equipamentos/:id/estado`, `/equipamentos/:id/movimentacoes` |
| API Keys | `/auth/api-keys`, `/auth/api-keys/:id` |
| Histórico e relatórios | `/journal`, `/analises`, `/analises/equipamentos/:id/recuperacao`, `/relatorios/status`, `/relatorios/organizacao`, `/relatorios/financeiro` |

Somente `ADMINISTRADOR` pode criar, editar ou desativar usuários. O administrador pode listar todos; os outros papéis veem apenas usuários cadastrados por eles. Os papéis `ADMINISTRADOR` e `OPERADOR_CADASTRO` podem gerenciar organizações e contratos. `ADMINISTRADOR` e `GESTOR_ALMOXARIFADO` podem gerenciar lotes e equipamentos. A rota `/journal` fica restrita a `ADMINISTRADOR` e `AUDITORIA`.

As edições e exclusões de organizações, contratos, lotes, equipamentos, usuários e API Keys exigem a versão atual do registro. Se ele tiver mudado desde a leitura, a API responde `409 Conflict`. Organização e usuário são desativados logicamente; equipamento recebe baixa definitiva para preservar sua rastreabilidade. Um lote só pode ser excluído quando ainda está recebido e não tem equipamentos. Contratos podem ser excluídos, com o evento preservado no Journal.

Movimentações, Journal, avaliações de recuperação e resultados analíticos são registros históricos: podem ser criados e consultados, mas não editados nem apagados. Uma nova avaliação de recuperação registra uma observação posterior em vez de alterar a anterior. Consulte [CRUD-ENTIDADES.md](CRUD-ENTIDADES.md) para a matriz completa de operações e regras.

## Organização do código

- `src/http/Servidor.ts` configura a aplicação, o tratamento de erros e as dependências dos serviços.
- `src/http/controladores/` registra as rotas HTTP separadas por recurso e encaminha as operações aos serviços.
- `src/services/` contém regras de negócio; `src/infra/repositories/` implementa o acesso ao PostgreSQL com Prisma.
- `src/http/AutenticacaoJwt.ts` configura o JWT e os hooks de autenticação; as rotas de login e usuários ficam no controlador de autenticação.

## Banco de dados

- `npm run db:migrate`: cria/aplica migrações de desenvolvimento.
- `npm run db:deploy`: aplica migrações existentes em ambiente de implantação.
- `npm run db:status`: mostra o estado das migrações.

Em desenvolvimento, `npm run db:migrate` cria/aplica uma migration e gera o cliente Prisma conforme necessário. Em um ambiente já preparado ou implantação, gere o cliente (`npm run db:generate`) e aplique as migrations versionadas (`npm run db:deploy`). Configure `DATABASE_URL` antes desses comandos. Não substitua as migrations executando SQL manualmente.

As regras `CHECK` e os gatilhos PostgreSQL estão versionados em `prisma/migrations`. Não aplique `prisma/regras-de-negocio.sql` manualmente depois que as migrações já tiverem sido aplicadas.

## Testes

```sh
npm test -- --runInBand
npm run test:journey
npm run lint
npm run build
```

Os testes de integração usam o PostgreSQL indicado por `DATABASE_URL`. A jornada da API usa uma transação revertida para não deixar os dados de teste no banco.

## Relatório técnico da AV3

Consulte [RELATORIO-TECNICO-AV3.md](RELATORIO-TECNICO-AV3.md) para a arquitetura analítica, API pública, autenticação por API Key, limites, filas, workers, armazenamento e caminhos de evolução.

## Dados legados

A CLI e a persistência em arquivos JSON foram removidas. O diretório `data/` existente não é lido nem migrado automaticamente. Preserve-o até exportar manualmente qualquer dado local que ainda seja necessário.
