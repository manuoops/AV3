import { PapelUsuario, StatusRastreamento } from "@prisma/client";
import { FastifyInstance } from "fastify";
import { ServicoRelatorioPrisma } from "../../services/ServicoRelatorioPrisma";
import { criarOpcoesAutenticacaoRotas } from "./OpcoesAutenticacaoRotas";
import { RepositorioJournalPrisma } from "../../infra/repositories/RepositorioJournalPrisma";

export function registrarRotasRelatorio(
  app: FastifyInstance, relatorios: ServicoRelatorioPrisma,
  journal = new RepositorioJournalPrisma()
): void {
  const { autenticado } = criarOpcoesAutenticacaoRotas(app);

  app.get<{ Querystring: { status: StatusRastreamento } }>("/relatorios/status", { ...autenticado }, async (request) =>
    ({ relatorio: await relatorios.gerarRelatorioPorStatus(request.query.status) }));
  app.get<{ Querystring: { organizacaoId: string; inicio: string; fim: string } }>("/relatorios/organizacao", { ...autenticado }, async (request) =>
    ({ relatorio: await relatorios.gerarRelatorioPorOrganizacao(request.query.organizacaoId, { inicio: new Date(request.query.inicio), fim: new Date(request.query.fim) }) }));
  app.get<{ Querystring: { inicio: string; fim: string } }>("/relatorios/financeiro", { ...autenticado }, async (request) =>
    ({ relatorio: await relatorios.gerarRelatorioFinanceiro({ inicio: new Date(request.query.inicio), fim: new Date(request.query.fim) }) }));

  app.get<{ Querystring: { inicio: string; fim: string; skip?: string; take?: string } }>("/journal", {
    preHandler: [app.autenticar, app.exigirPapeis([PapelUsuario.ADMINISTRADOR, PapelUsuario.AUDITORIA])],
    schema: { querystring: { type: "object", required: ["inicio", "fim"], additionalProperties: false, properties: {
      inicio: { type: "string", format: "date-time" }, fim: { type: "string", format: "date-time" },
      skip: { type: "integer", minimum: 0 }, take: { type: "integer", minimum: 1, maximum: 500 }
    } } }
  }, async (request, reply) => {
    const inicio = new Date(request.query.inicio);
    const fim = new Date(request.query.fim);
    const skip = Number(request.query.skip ?? 0);
    const take = Number(request.query.take ?? 100);
    if (inicio > fim) return reply.code(400).send({ erro: "inicio nao pode ser posterior a fim." });
    if (!Number.isInteger(skip) || skip < 0 || !Number.isInteger(take) || take < 1 || take > 500) {
      return reply.code(400).send({ erro: "Paginacao invalida." });
    }
    return { registros: await journal.listarPorPeriodo(inicio, fim, skip, take) };
  });
}
