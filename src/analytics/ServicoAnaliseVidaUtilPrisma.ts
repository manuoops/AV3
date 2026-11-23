import { EstadoFisico, Prisma, TipoEquipamento, TipoResultadoAnalitico } from "@prisma/client";
import { prisma } from "../infra/PrismaClient";
import { PrismaExecutor } from "../infra/repositories/PrismaExecutor";
import { RepositorioEquipamentoPrisma } from "../infra/repositories/RepositorioEquipamentoPrisma";
import { RepositorioJournalPrisma } from "../infra/repositories/RepositorioJournalPrisma";
import { RepositorioResultadoAnaliticoPrisma } from "../infra/repositories/RepositorioResultadoAnaliticoPrisma";
import { calcularMedia, calcularRegressaoLinear, PontoRegressaoLinear } from "./Estatistica";

const ORDEM_ESTADO: Record<EstadoFisico, number> = {
  NOVO: 0,
  BOM_ESTADO: 1,
  USADO_LEVE: 2,
  USADO_MODERADO: 3,
  DANIFICADO_LEVE: 4,
  DANIFICADO_GRAVE: 5,
  INSERVIVEL: 6
};

const ESTADO_POR_VALOR = Object.fromEntries(
  Object.entries(ORDEM_ESTADO).map(([estado, valor]) => [valor, estado])
) as Record<number, EstadoFisico>;

interface ObservacaoEstado extends PontoRegressaoLinear {
  observadoEm: Date;
  estadoFisico: EstadoFisico;
}

interface PrevisaoEquipamento {
  equipamentoId: string;
  tipo: TipoEquipamento;
  marca: string;
  modelo: string;
  estadoAtual: EstadoFisico;
  observacoesHistoricas: number;
  situacao: "PREVISAO" | "JA_INSERVIVEL" | "DADOS_INSUFICIENTES" | "TENDENCIA_NAO_DETERIORACAO";
  inclinacaoEstadoPorDia: number | null;
  diasEstimadosAteInservivel: number | null;
  dataEstimadaInservivel: string | null;
}

function extrairCampoTexto(dados: Prisma.JsonValue | null, campo: string): string | null {
  if (!dados || typeof dados !== "object" || Array.isArray(dados)) return null;
  const valor = dados[campo];
  return typeof valor === "string" ? valor : null;
}

function arredondar(valor: number, casas = 2): number {
  return Number(valor.toFixed(casas));
}

export class ServicoAnaliseVidaUtilPrisma {
  constructor(private readonly db: PrismaExecutor = prisma) {}

  public async gerar(usuarioId?: string, tipo?: TipoEquipamento, organizacaoId?: string, tarefaId?: string) {
    const equipamentos = await new RepositorioEquipamentoPrisma(this.db).listarParaAnalise(tipo, organizacaoId);
    const idsPermitidos = new Set(equipamentos.map(({ id }) => id));
    const eventos = await new RepositorioJournalPrisma(this.db).listarHistoricoDeEstadoFisico();
    const porEquipamento = new Map<string, ObservacaoEstado[]>();
    let eventosSemObservacaoEstado = 0;

    for (const evento of eventos) {
      const equipamentoId = extrairCampoTexto(evento.dadosDepois, "id");
      const estado = extrairCampoTexto(evento.dadosDepois, "estadoFisico");
      if (equipamentoId && !idsPermitidos.has(equipamentoId)) continue;
      if (!equipamentoId || !estado || !Object.hasOwn(ORDEM_ESTADO, estado)) {
        eventosSemObservacaoEstado += 1;
        continue;
      }
      const observacoes = porEquipamento.get(equipamentoId) ?? [];
      observacoes.push({
        x: evento.timestamp.getTime(),
        y: ORDEM_ESTADO[estado as EstadoFisico],
        observadoEm: evento.timestamp,
        estadoFisico: estado as EstadoFisico
      });
      porEquipamento.set(equipamentoId, observacoes);
    }

    const previsoes: PrevisaoEquipamento[] = equipamentos.map((equipamento) => {
      const observacoes = porEquipamento.get(equipamento.id) ?? [];
      const estadoAtual = equipamento.estadoFisico;
      if (estadoAtual === EstadoFisico.INSERVIVEL) {
        return {
          equipamentoId: equipamento.id,
          tipo: equipamento.tipo,
          marca: equipamento.marca,
          modelo: equipamento.modelo,
          estadoAtual,
          observacoesHistoricas: observacoes.length,
          situacao: "JA_INSERVIVEL",
          inclinacaoEstadoPorDia: null,
          diasEstimadosAteInservivel: 0,
          dataEstimadaInservivel: null
        };
      }

      if (observacoes.length < 2) {
        return {
          equipamentoId: equipamento.id,
          tipo: equipamento.tipo,
          marca: equipamento.marca,
          modelo: equipamento.modelo,
          estadoAtual,
          observacoesHistoricas: observacoes.length,
          situacao: "DADOS_INSUFICIENTES",
          inclinacaoEstadoPorDia: null,
          diasEstimadosAteInservivel: null,
          dataEstimadaInservivel: null
        };
      }

      const inicio = observacoes[0]!.observadoEm.getTime();
      const pontos = observacoes.map((observacao) => ({
        x: (observacao.observadoEm.getTime() - inicio) / 86_400_000,
        y: observacao.y
      }));
      const regressao = calcularRegressaoLinear(pontos);
      if (!regressao || regressao.inclinacao <= 0) {
        return {
          equipamentoId: equipamento.id,
          tipo: equipamento.tipo,
          marca: equipamento.marca,
          modelo: equipamento.modelo,
          estadoAtual,
          observacoesHistoricas: observacoes.length,
          situacao: "TENDENCIA_NAO_DETERIORACAO",
          inclinacaoEstadoPorDia: regressao ? arredondar(regressao.inclinacao, 6) : null,
          diasEstimadosAteInservivel: null,
          dataEstimadaInservivel: null
        };
      }

      const diasEstimados = Math.max(0, (ORDEM_ESTADO.INSERVIVEL - ORDEM_ESTADO[estadoAtual]) / regressao.inclinacao);
      const dataEstimada = new Date(observacoes.at(-1)!.observadoEm.getTime() + diasEstimados * 86_400_000);
      return {
        equipamentoId: equipamento.id,
        tipo: equipamento.tipo,
        marca: equipamento.marca,
        modelo: equipamento.modelo,
        estadoAtual,
        observacoesHistoricas: observacoes.length,
        situacao: "PREVISAO",
        inclinacaoEstadoPorDia: arredondar(regressao.inclinacao, 6),
        diasEstimadosAteInservivel: arredondar(diasEstimados),
        dataEstimadaInservivel: dataEstimada.toISOString()
      };
    });

    const agrupamentos = new Map<TipoEquipamento, PrevisaoEquipamento[]>();
    for (const previsao of previsoes) {
      const grupo = agrupamentos.get(previsao.tipo) ?? [];
      grupo.push(previsao);
      agrupamentos.set(previsao.tipo, grupo);
    }
    const porTipo = [...agrupamentos.entries()].map(([tipoEquipamento, itens]) => {
      const previsoesValidas = itens.filter((item) => item.situacao === "PREVISAO");
      const mediaDias = calcularMedia(previsoesValidas
        .map((item) => item.diasEstimadosAteInservivel)
        .filter((valor): valor is number => valor !== null));
      return {
        tipo: tipoEquipamento,
        equipamentosAnalisados: itens.length,
        equipamentosComDadosInsuficientes: itens.filter((item) => item.situacao === "DADOS_INSUFICIENTES").length,
        equipamentosJaInserviveis: itens.filter((item) => item.situacao === "JA_INSERVIVEL").length,
        equipamentosComPrevisao: previsoesValidas.length,
        mediaDiasAteInservivel: mediaDias === null ? null : arredondar(mediaDias)
      };
    }).sort((a, b) => a.tipo.localeCompare(b.tipo));

    const resultado = {
      metodo: "Regressao linear simples do estado fisico ordinal ao longo do tempo, por equipamento.",
      escalaEstadoFisico: ORDEM_ESTADO,
      limitacoes: [
        "Os estados fisicos sao tratados como uma escala ordinal com intervalos iguais.",
        "A previsao usa somente alteracoes de estado registradas no Journal; historicos anteriores a este registro podem nao ter observacoes suficientes.",
        "Falhas tecnicas nao possuem um historico proprio no schema atual e nao entram no calculo.",
        "Uma regressao com poucas observacoes e indicativa, nao uma garantia de vida util real."
      ],
      eventosSemObservacaoEstado,
      semDados: equipamentos.length === 0 || previsoes.every((item) => item.situacao === "DADOS_INSUFICIENTES"),
      porTipo,
      previsoes
    };

    return new RepositorioResultadoAnaliticoPrisma(this.db).salvar({
      tipo: TipoResultadoAnalitico.VIDA_UTIL_PREDITIVA,
      filtros: tipo ? { tipoEquipamento: tipo } : {},
      resultado: resultado as unknown as Prisma.InputJsonValue,
      ...(usuarioId ? { usuarioId } : {})
    }, tarefaId);
  }
}
