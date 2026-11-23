import { FastifyInstance } from "fastify";
import { TipoEquipamento, TipoResultadoAnalitico } from "@prisma/client";
import { ServicoAnaliseEficienciaPrisma } from "../../analytics/ServicoAnaliseEficienciaPrisma";
import { ServicoAnaliseRentabilidadePrisma } from "../../analytics/ServicoAnaliseRentabilidadePrisma";
import { ServicoAnaliseVidaUtilPrisma } from "../../analytics/ServicoAnaliseVidaUtilPrisma";
import { RepositorioResultadoAnaliticoPrisma } from "../../infra/repositories/RepositorioResultadoAnaliticoPrisma";
import { criarOpcoesAutenticacaoRotas } from "./OpcoesAutenticacaoRotas";

interface CorpoPeriodo {
  inicio: string;
  fim: string;
}

function converterPeriodo(periodo?: CorpoPeriodo) {
  if (!periodo) return undefined;
  return { inicio: new Date(periodo.inicio), fim: new Date(periodo.fim) };
}

export interface ServicosAnaliticos {
  eficiencia: ServicoAnaliseEficienciaPrisma;
  rentabilidade: ServicoAnaliseRentabilidadePrisma;
  vidaUtil: ServicoAnaliseVidaUtilPrisma;
  resultados: RepositorioResultadoAnaliticoPrisma;
}

export function registrarRotasAnaliticas(app: FastifyInstance, servicos: ServicosAnaliticos): void {
  const { autenticado, gestorAlmoxarifado } = criarOpcoesAutenticacaoRotas(app);

  app.post<{ Body: { periodo: CorpoPeriodo; periodoComparacao?: CorpoPeriodo } }>(
    "/analises/eficiencia-operacional", { ...autenticado }, async (request, reply) => {
      const periodo = converterPeriodo(request.body.periodo);
      if (!periodo) return reply.code(400).send({ erro: "periodo e obrigatorio." });
      return reply.code(201).send(await servicos.eficiencia.gerar(
        periodo, request.user.sub, converterPeriodo(request.body.periodoComparacao)
      ));
    }
  );

  app.post<{ Body: { periodo?: CorpoPeriodo } }>("/analises/rentabilidade", { ...autenticado }, async (request, reply) =>
    reply.code(201).send(await servicos.rentabilidade.gerar(
      converterPeriodo(request.body?.periodo), request.user.sub
    )));

  app.post<{ Params: { id: string }; Body: { valorRecuperado: number; observacao?: string } }>(
    "/analises/equipamentos/:id/recuperacao", { ...gestorAlmoxarifado }, async (request, reply) =>
      reply.code(201).send(await servicos.rentabilidade.registrarValorRecuperado(
        request.params.id, request.body.valorRecuperado, request.user.usuario, request.body.observacao
      ))
  );

  app.get<{ Params: { id: string }; Querystring: { skip?: string; take?: string } }>(
    "/analises/equipamentos/:id/recuperacao", { ...autenticado }, async (request) => ({
      recuperacoes: await servicos.rentabilidade.listarValoresRecuperados(
        request.params.id, Number(request.query.skip ?? 0), Number(request.query.take ?? 100)
      )
    })
  );

  app.post<{ Body: { tipo?: TipoEquipamento } }>("/analises/vida-util", { ...autenticado }, async (request, reply) =>
    reply.code(201).send(await servicos.vidaUtil.gerar(request.user.sub, request.body?.tipo)));

  app.get<{ Querystring: { tipo?: TipoResultadoAnalitico; pagina?: string; limite?: string } }>(
    "/analises", { ...autenticado }, async (request, reply) => {
      const pagina = Number(request.query.pagina ?? 1);
      const limite = Number(request.query.limite ?? 50);
      if (!Number.isInteger(pagina) || pagina < 1 || !Number.isInteger(limite) || limite < 1 || limite > 100) {
        return reply.code(400).send({ erro: "pagina deve ser positiva e limite deve estar entre 1 e 100." });
      }
      return { resultados: await servicos.resultados.listar(request.query.tipo, (pagina - 1) * limite, limite) };
    }
  );

  app.get<{ Params: { id: string } }>("/analises/:id", { ...autenticado }, async (request) => {
    const resultado = await servicos.resultados.buscarPorId(request.params.id);
    if (!resultado) throw new Error(`Analise '${request.params.id}' nao encontrada.`);
    return resultado;
  });
}
