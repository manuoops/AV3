import { FastifyInstance } from "fastify";
import { StatusLote } from "@prisma/client";
import { ServicoLotePrisma } from "../../services/ServicoLotePrisma";
import { criarOpcoesAutenticacaoRotas } from "./OpcoesAutenticacaoRotas";

export function registrarRotasLote(app: FastifyInstance, lotes: ServicoLotePrisma): void {
  const { autenticado, gestorAlmoxarifado } = criarOpcoesAutenticacaoRotas(app);

  app.post<{ Body: { dataEntrada?: string; organizacaoId: string; notaFiscal: string; transportadora: string; observacoes?: string } }>("/lotes", { ...gestorAlmoxarifado }, async (request, reply) =>
    reply.code(201).send(await lotes.criarLote({ ...request.body, dataEntrada: request.body.dataEntrada ? new Date(request.body.dataEntrada) : new Date() }, request.user.usuario)));
  app.get<{ Querystring: { inicio?: string; fim?: string; organizacaoId?: string; statusProcessamento?: StatusLote; skip?: string; take?: string } }>("/lotes", {
    ...autenticado,
    schema: { querystring: { type: "object", additionalProperties: false, properties: {
      inicio: { type: "string", format: "date-time" }, fim: { type: "string", format: "date-time" },
      organizacaoId: { type: "string", format: "uuid" }, statusProcessamento: { type: "string", enum: Object.values(StatusLote) },
      skip: { type: "integer", minimum: 0 }, take: { type: "integer", minimum: 1, maximum: 500 }
    } } }
  }, async (request) =>
    lotes.listarLotes({
      ...(request.query.inicio ? { dataInicio: new Date(request.query.inicio) } : {}),
      ...(request.query.fim ? { dataFim: new Date(request.query.fim) } : {}),
      ...(request.query.organizacaoId ? { organizacaoId: request.query.organizacaoId } : {}),
      ...(request.query.statusProcessamento ? { statusProcessamento: request.query.statusProcessamento } : {}),
      skip: Number(request.query.skip ?? 0), take: Number(request.query.take ?? 100)
    }));
  app.get<{ Params: { id: string } }>("/lotes/:id", { ...autenticado }, async (request) => {
    const lote = await lotes.buscarLote(request.params.id);
    if (!lote) throw new Error(`Lote '${request.params.id}' nao encontrado.`);
    return lote;
  });
  app.put<{ Params: { id: string }; Body: { dataEntrada: string; notaFiscal: string; transportadora: string; observacoes?: string; versao: number } }>("/lotes/:id", {
    ...gestorAlmoxarifado,
    schema: {
      params: { type: "object", required: ["id"], properties: { id: { type: "string", format: "uuid" } } },
      body: { type: "object", required: ["dataEntrada", "notaFiscal", "transportadora", "versao"], additionalProperties: false, properties: {
        dataEntrada: { type: "string", format: "date-time" }, notaFiscal: { type: "string", minLength: 1 },
        transportadora: { type: "string", minLength: 1 }, observacoes: { type: "string" }, versao: { type: "integer", minimum: 1 }
      } }
    }
  }, async (request) => lotes.atualizarLote(request.params.id, {
    dataEntrada: new Date(request.body.dataEntrada), notaFiscal: request.body.notaFiscal,
    transportadora: request.body.transportadora,
    ...(request.body.observacoes !== undefined ? { observacoes: request.body.observacoes } : {})
  }, request.body.versao, request.user.usuario));
  app.delete<{ Params: { id: string }; Body: { versao: number } }>("/lotes/:id", {
    ...gestorAlmoxarifado,
    schema: {
      params: { type: "object", required: ["id"], properties: { id: { type: "string", format: "uuid" } } },
      body: { type: "object", required: ["versao"], additionalProperties: false, properties: { versao: { type: "integer", minimum: 1 } } }
    }
  }, async (request) => lotes.excluirLote(request.params.id, request.body.versao, request.user.usuario));
  app.post<{ Params: { id: string }; Body: { versao: number } }>("/lotes/:id/processar-triagem", {
    ...gestorAlmoxarifado,
    schema: { body: { type: "object", required: ["versao"], additionalProperties: false, properties: {
      versao: { type: "integer", minimum: 1 }
    } } }
  }, async (request) => lotes.processarTriagem(request.params.id, request.body.versao, request.user.usuario));
  app.get<{ Params: { id: string } }>("/lotes/:id/relatorio-triagem", { ...autenticado }, async (request) =>
    ({ relatorio: await lotes.gerarRelatorioTriagem(request.params.id) }));
}
