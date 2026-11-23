import { FastifyInstance } from "fastify";
import { PapelUsuario, PermissaoChaveApi } from "@prisma/client";
import { ServicoChaveApiPrisma } from "../../services/ServicoChaveApiPrisma";

export function registrarRotasChavesApi(app: FastifyInstance, servico: ServicoChaveApiPrisma): void {
  const administrador = {
    preHandler: [app.autenticar, app.exigirPapeis([PapelUsuario.ADMINISTRADOR])]
  };

  app.post<{
    Body: { nome: string; organizacaoId: string; permissoes: PermissaoChaveApi[]; expiraEm?: string };
  }>("/auth/api-keys", {
    ...administrador,
    schema: {
      body: {
        type: "object",
        required: ["nome", "organizacaoId", "permissoes"],
        additionalProperties: false,
        properties: {
          nome: { type: "string", minLength: 3, maxLength: 80 },
          organizacaoId: { type: "string", format: "uuid" },
          permissoes: {
            type: "array", minItems: 1, uniqueItems: true,
            items: { type: "string", enum: Object.values(PermissaoChaveApi) }
          },
          expiraEm: { type: "string", format: "date-time" }
        }
      }
    }
  }, async (request, reply) => {
    const criada = await servico.criar({
      nome: request.body.nome,
      organizacaoId: request.body.organizacaoId,
      permissoes: request.body.permissoes,
      ...(request.body.expiraEm ? { expiraEm: new Date(request.body.expiraEm) } : {}),
      criadaPorId: request.user.sub
    });
    return reply.header("Cache-Control", "no-store").code(201).send(criada);
  });

  app.get("/auth/api-keys", administrador, async () => ({ chaves: await servico.listar() }));

  app.get<{ Params: { id: string } }>("/auth/api-keys/:id", {
    ...administrador,
    schema: { params: { type: "object", required: ["id"], properties: { id: { type: "string", format: "uuid" } } } }
  }, async (request, reply) => {
    const chave = await servico.buscarPorId(request.params.id);
    if (!chave) return reply.code(404).send({ erro: "Chave nao encontrada." });
    return reply.header("Cache-Control", "no-store").send(chave);
  });

  app.put<{ Params: { id: string }; Body: { nome: string; permissoes: PermissaoChaveApi[]; expiraEm: string | null; versao: number } }>("/auth/api-keys/:id", {
    ...administrador,
    schema: {
      params: { type: "object", required: ["id"], properties: { id: { type: "string", format: "uuid" } } },
      body: { type: "object", required: ["nome", "permissoes", "expiraEm", "versao"], additionalProperties: false, properties: {
        nome: { type: "string", minLength: 3, maxLength: 80 },
        permissoes: { type: "array", minItems: 1, uniqueItems: true, items: { type: "string", enum: Object.values(PermissaoChaveApi) } },
        expiraEm: { anyOf: [{ type: "string", format: "date-time" }, { type: "null" }] }, versao: { type: "integer", minimum: 1 }
      } }
    }
  }, async (request) => servico.atualizar(request.params.id, {
    nome: request.body.nome, permissoes: request.body.permissoes,
    expiraEm: request.body.expiraEm ? new Date(request.body.expiraEm) : null
  }, request.body.versao, request.user.sub));

  app.delete<{ Params: { id: string } }>("/auth/api-keys/:id", {
    ...administrador,
    schema: {
      params: {
        type: "object", required: ["id"], additionalProperties: false,
        properties: { id: { type: "string", format: "uuid" } }
      }
    }
  }, async (request) => servico.revogar(request.params.id, request.user.usuario));
}
