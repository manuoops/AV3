import { FastifyInstance } from "fastify";
import { ServicoContratoPrisma } from "../../services/ServicoContratoPrisma";
import { criarOpcoesAutenticacaoRotas } from "./OpcoesAutenticacaoRotas";

export function registrarRotasContrato(app: FastifyInstance, contratos: ServicoContratoPrisma): void {
  const { autenticado, gestorOrganizacao } = criarOpcoesAutenticacaoRotas(app);

  app.post<{ Body: { organizacaoId: string; dataVencimento: string; clausulas: string[]; valorMensal: number; renovacaoAutomatica?: boolean } }>("/contratos", { ...gestorOrganizacao }, async (request, reply) =>
    reply.code(201).send(await contratos.cadastrarContrato({ ...request.body, dataVencimento: new Date(request.body.dataVencimento), renovacaoAutomatica: request.body.renovacaoAutomatica ?? false }, request.user.usuario)));
  app.get<{ Querystring: { organizacaoId?: string; skip?: string; take?: string } }>("/contratos", {
    ...autenticado,
    schema: { querystring: { type: "object", additionalProperties: false, properties: {
      organizacaoId: { type: "string", format: "uuid" }, skip: { type: "integer", minimum: 0 }, take: { type: "integer", minimum: 1, maximum: 500 }
    } } }
  }, async (request) =>
    contratos.listarContratos(request.query.organizacaoId, Number(request.query.skip ?? 0), Number(request.query.take ?? 100)));
  app.get<{ Params: { id: string } }>("/contratos/:id", {
    ...autenticado,
    schema: { params: { type: "object", required: ["id"], properties: { id: { type: "string", format: "uuid" } } } }
  }, async (request) => {
    const contrato = await contratos.buscarContrato(request.params.id);
    if (!contrato) throw new Error(`Contrato '${request.params.id}' nao encontrado.`);
    return contrato;
  });
  app.put<{ Params: { id: string }; Body: { dataVencimento: string; clausulas: string[]; valorMensal: number; renovacaoAutomatica: boolean; versao: number } }>("/contratos/:id", {
    ...gestorOrganizacao,
    schema: {
      params: { type: "object", required: ["id"], properties: { id: { type: "string", format: "uuid" } } },
      body: { type: "object", required: ["dataVencimento", "clausulas", "valorMensal", "renovacaoAutomatica", "versao"], additionalProperties: false, properties: {
        dataVencimento: { type: "string", format: "date-time" }, clausulas: { type: "array", items: { type: "string", minLength: 1 } },
        valorMensal: { type: "number", exclusiveMinimum: 0 }, renovacaoAutomatica: { type: "boolean" }, versao: { type: "integer", minimum: 1 }
      } }
    }
  }, async (request) => contratos.atualizarContrato(request.params.id, {
    dataVencimento: new Date(request.body.dataVencimento), clausulas: request.body.clausulas,
    valorMensal: request.body.valorMensal, renovacaoAutomatica: request.body.renovacaoAutomatica
  }, request.body.versao, request.user.usuario));
  app.delete<{ Params: { id: string }; Body: { versao: number } }>("/contratos/:id", {
    ...gestorOrganizacao,
    schema: {
      params: { type: "object", required: ["id"], properties: { id: { type: "string", format: "uuid" } } },
      body: { type: "object", required: ["versao"], additionalProperties: false, properties: { versao: { type: "integer", minimum: 1 } } }
    }
  }, async (request) => contratos.excluirContrato(request.params.id, request.body.versao, request.user.usuario));
  app.patch<{ Params: { organizacaoId: string }; Body: { dataVencimento: string; versao: number } }>("/contratos/:organizacaoId/renovar", {
    ...gestorOrganizacao,
    schema: { body: { type: "object", required: ["dataVencimento", "versao"], additionalProperties: false, properties: {
      dataVencimento: { type: "string", format: "date-time" }, versao: { type: "integer", minimum: 1 }
    } } }
  }, async (request) => contratos.renovarContrato(
    request.params.organizacaoId,
    new Date(request.body.dataVencimento),
    request.body.versao,
    request.user.usuario
  ));
}
