import { EstadoFisico, StatusRastreamento, TipoEquipamento } from "@prisma/client";
import { FastifyInstance } from "fastify";
import { ServicoEquipamentoPrisma } from "../../services/ServicoEquipamentoPrisma";
import { criarOpcoesAutenticacaoRotas } from "./OpcoesAutenticacaoRotas";

export function registrarRotasEquipamento(app: FastifyInstance, equipamentos: ServicoEquipamentoPrisma): void {
  const { autenticado, gestorAlmoxarifado } = criarOpcoesAutenticacaoRotas(app);

  app.get<{ Querystring: { loteId?: string; statusRastreamento?: StatusRastreamento; tipo?: TipoEquipamento; skip?: string; take?: string } }>("/equipamentos", {
    ...autenticado,
    schema: { querystring: { type: "object", additionalProperties: false, properties: {
      loteId: { type: "string", format: "uuid" },
      statusRastreamento: { type: "string", enum: Object.values(StatusRastreamento) },
      tipo: { type: "string", enum: Object.values(TipoEquipamento) },
      skip: { type: "integer", minimum: 0 }, take: { type: "integer", minimum: 1, maximum: 500 }
    } } }
  }, async (request) =>
    equipamentos.listarEquipamentos({
      ...request.query,
      skip: Number(request.query.skip ?? 0), take: Number(request.query.take ?? 100)
    }));
  app.post<{ Body: { tipo: TipoEquipamento; marca: string; modelo: string; anoFabricacao: number; estadoFisico: EstadoFisico; pesoQuilogramas: number; loteId: string } }>("/equipamentos", { ...gestorAlmoxarifado }, async (request, reply) =>
    reply.code(201).send(await equipamentos.cadastrarEquipamento(request.body, request.user.usuario)));
  app.get<{ Params: { id: string } }>("/equipamentos/:id", { ...autenticado }, async (request) => {
    const equipamento = await equipamentos.buscarEquipamento(request.params.id);
    if (!equipamento) throw new Error(`Equipamento '${request.params.id}' nao encontrado.`);
    return equipamento;
  });
  app.put<{ Params: { id: string }; Body: { marca: string; modelo: string; anoFabricacao: number; pesoQuilogramas: number; versao: number } }>("/equipamentos/:id", {
    ...gestorAlmoxarifado,
    schema: {
      params: { type: "object", required: ["id"], properties: { id: { type: "string", format: "uuid" } } },
      body: { type: "object", required: ["marca", "modelo", "anoFabricacao", "pesoQuilogramas", "versao"], additionalProperties: false, properties: {
        marca: { type: "string", minLength: 1 }, modelo: { type: "string", minLength: 1 },
        anoFabricacao: { type: "integer", minimum: 1980 }, pesoQuilogramas: { type: "number", exclusiveMinimum: 0 },
        versao: { type: "integer", minimum: 1 }
      } }
    }
  }, async (request) => equipamentos.atualizarDadosEquipamento(request.params.id, request.body, request.body.versao, request.user.usuario));
  app.delete<{ Params: { id: string }; Body: { versao: number; justificativa: string } }>("/equipamentos/:id", {
    ...gestorAlmoxarifado,
    schema: {
      params: { type: "object", required: ["id"], properties: { id: { type: "string", format: "uuid" } } },
      body: { type: "object", required: ["versao", "justificativa"], additionalProperties: false, properties: {
        versao: { type: "integer", minimum: 1 }, justificativa: { type: "string", minLength: 1 }
      } }
    }
  }, async (request) => equipamentos.baixarEquipamento(request.params.id, request.body.versao, request.body.justificativa, request.user.usuario));
  app.get<{ Params: { id: string } }>("/equipamentos/:id/rastreabilidade", { ...autenticado }, async (request) =>
    equipamentos.rastrearEquipamento(request.params.id));
  app.get<{ Params: { id: string }; Querystring: { skip?: string; take?: string } }>("/equipamentos/:id/movimentacoes", { ...autenticado }, async (request) =>
    equipamentos.listarMovimentacoes(request.params.id, Number(request.query.skip ?? 0), Number(request.query.take ?? 100)));
  app.patch<{ Params: { id: string }; Body: { estadoFisico: EstadoFisico; versao: number; justificativa?: string } }>("/equipamentos/:id/estado", { ...gestorAlmoxarifado }, async (request) =>
    equipamentos.atualizarEstadoFisico(request.params.id, request.body.estadoFisico, request.body.versao, request.user.usuario, request.body.justificativa));
  app.patch<{ Params: { id: string }; Body: { statusRastreamento: StatusRastreamento; versao: number; justificativa: string } }>("/equipamentos/:id/status", { ...gestorAlmoxarifado }, async (request) =>
    equipamentos.atualizarStatusRastreamento(request.params.id, request.body.statusRastreamento, request.body.justificativa, request.body.versao, request.user.usuario));
  app.post<{ Params: { id: string }; Body: { destino: string; responsavel: string; versao: number; observacao?: string } }>("/equipamentos/:id/movimentacoes", { ...gestorAlmoxarifado }, async (request, reply) =>
    reply.code(201).send(await equipamentos.registrarMovimentacao(request.params.id, request.body.destino, request.body.responsavel, request.body.versao, request.user.usuario, request.body.observacao)));
}
