# Matriz de operações por entidade

Este documento descreve as operações disponíveis na API interna e explica onde a exclusão lógica ou a preservação de histórico é necessária. As rotas internas usam JWT Bearer. API Keys só podem ser administradas por `ADMINISTRADOR`.

| Entidade | Criar | Listar / consultar | Editar | Excluir / encerrar | Política de dados |
| --- | --- | --- | --- | --- | --- |
| Organização | `POST /organizacoes` | `GET /organizacoes`, `GET /organizacoes/:id` | `PUT /organizacoes/:id`; campos cadastrais completos e `versao` | `DELETE /organizacoes/:id`; também existe `PATCH /organizacoes/:id/desativar` | Desativação lógica; o CNPJ e os relacionamentos históricos ficam preservados. |
| Usuário | `POST /auth/usuarios` | `GET /auth/usuarios`, `GET /auth/usuarios/:id` | `PUT /auth/usuarios/:id` altera nome e papel. A senha tem fluxo próprio em `PATCH /auth/senha`. | `DELETE /auth/usuarios/:id`; também existe `PATCH /auth/usuarios/:id/desativar` | Desativação lógica. Alterar papel ou desativar incrementa a versão e invalida JWTs anteriores. Apenas administradores gerenciam usuários; os demais só leem usuários criados por eles, e o hash nunca é retornado. |
| Contrato | `POST /contratos` | `GET /contratos`, opcionalmente filtrado por `organizacaoId`; `GET /contratos/:id` | `PUT /contratos/:id`; renovação também pode usar `PATCH /contratos/:organizacaoId/renovar` | `DELETE /contratos/:id` | Exclusão física com versão esperada e evento de exclusão preservado no Journal. |
| Lote | `POST /lotes` | `GET /lotes` com filtros opcionais; `GET /lotes/:id` | `PUT /lotes/:id` somente enquanto o lote está `RECEBIDO` | `DELETE /lotes/:id` somente se está `RECEBIDO` e sem equipamentos | Exclusão física restrita para proteger equipamentos relacionados e etapas operacionais já iniciadas. |
| Equipamento | `POST /equipamentos` | `GET /equipamentos`, `GET /equipamentos/:id`; histórico em `/equipamentos/:id/rastreabilidade` e `/equipamentos/:id/movimentacoes` | `PUT /equipamentos/:id` altera dados descritivos. Estado e rastreamento têm rotas próprias `PATCH`. | `DELETE /equipamentos/:id` registra baixa definitiva e exige justificativa | Não apaga a identidade, o código de barras, as movimentações nem avaliações; a baixa mantém rastreabilidade e relatórios. |
| API Key | `POST /auth/api-keys` | `GET /auth/api-keys`, `GET /auth/api-keys/:id` | `PUT /auth/api-keys/:id` altera nome, permissões e validade com `versao`, sem revelar o segredo | `DELETE /auth/api-keys/:id` revoga a chave | Revogação lógica; o segredo é mostrado apenas na criação e nunca pode ser recuperado. |
| Movimentação | `POST /equipamentos/:id/movimentacoes` | `GET /equipamentos/:id/movimentacoes` e rastreabilidade | Não permitido | Não permitido | Eventos append-only; corrigir significa registrar uma nova movimentação, mantendo a sequência original. |
| Avaliação de recuperação | `POST /analises/equipamentos/:id/recuperacao` | `GET /analises/equipamentos/:id/recuperacao` e relatório de rentabilidade | Não permitido | Não permitido | Cada avaliação é uma observação datada usada nas análises; uma correção deve ser uma nova avaliação. |
| Evento do Journal | Registrado pelos serviços nas alterações | `GET /journal?inicio=...&fim=...` (administrador ou auditoria) | Não permitido | Não permitido | Trilha de auditoria append-only; o endpoint não oferece mutações. |
| Resultado analítico | Criado pela execução da análise ou tarefa | `GET /analises`, `GET /analises/:id` | Não permitido | Não permitido | Snapshot calculado e preservado para consulta histórica. Retentativas de uma tarefa atualizam o mesmo snapshot idempotente. |

## Concorrência e regras

Operações de edição e exclusão das entidades principais recebem `versao`, a versão lida pelo cliente. Se outro usuário tiver gravado uma alteração, a API responde `409 Conflict`, evitando que uma versão antiga sobrescreva a nova. A API atualiza a versão ao salvar.

As permissões também variam por entidade: usuários e API Keys são administrados por `ADMINISTRADOR`; organização e contrato por `ADMINISTRADOR` ou `OPERADOR_CADASTRO`; lote e equipamento por `ADMINISTRADOR` ou `GESTOR_ALMOXARIFADO`. A consulta do Journal exige `ADMINISTRADOR` ou `AUDITORIA`.

As tabelas de sessão e credencial do diagrama anterior não existem no schema atual: a aplicação usa JWT stateless e armazena o hash da senha em `Usuario`. Portanto, não há CRUD separado de sessão ou credencial.
