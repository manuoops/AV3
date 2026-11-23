import { Prisma, TipoResultadoAnalitico } from "@prisma/client";
import { PrismaExecutor } from "../infra/repositories/PrismaExecutor";
import { RepositorioJournalPrisma } from "../infra/repositories/RepositorioJournalPrisma";
import { RepositorioLotePrisma } from "../infra/repositories/RepositorioLotePrisma";
import { RepositorioResultadoAnaliticoPrisma } from "../infra/repositories/RepositorioResultadoAnaliticoPrisma";
import { prisma } from "../infra/PrismaClient";
import { calcularMedia } from "./Estatistica";

export interface PeriodoAnalise {
  inicio: Date;
  fim: Date;
}

interface LoteConcluido {
  loteId: string;
  dataEntrada: string;
  concluidoEm: string;
  duracaoHoras: number;
  operador: string;
}

interface ResumoOperador {
  operador: string;
  lotesConcluidos: number;
  duracaoMediaHoras: number;
}

interface ResultadoPeriodoEficiencia {
  periodo: { inicio: string; fim: string };
  lotesConcluidos: number;
  duracaoMediaHoras: number | null;
  porOperador: ResumoOperador[];
  gargalosPorOperador: ResumoOperador[];
  maioresDuracoes: LoteConcluido[];
  lotes: LoteConcluido[];
  registrosIgnorados: number;
  semDados: boolean;
}

function arredondar(valor: number): number {
  return Number(valor.toFixed(2));
}

function extrairIdLote(dadosDepois: Prisma.JsonValue | null): string | null {
  if (!dadosDepois || typeof dadosDepois !== "object" || Array.isArray(dadosDepois)) return null;
  const id = dadosDepois.id;
  return typeof id === "string" ? id : null;
}

function validarPeriodo(periodo: PeriodoAnalise): void {
  if (!Number.isFinite(periodo.inicio.getTime()) || !Number.isFinite(periodo.fim.getTime())) {
    throw new Error("O periodo da analise contem uma data invalida.");
  }
  if (periodo.inicio.getTime() > periodo.fim.getTime()) {
    throw new Error("O inicio do periodo nao pode ser posterior ao fim.");
  }
}

export class ServicoAnaliseEficienciaPrisma {
  constructor(private readonly db: PrismaExecutor = prisma) {}

  public async gerar(
    periodo: PeriodoAnalise,
    usuarioId?: string,
    periodoComparacao?: PeriodoAnalise,
    organizacaoId?: string,
    tarefaId?: string
  ) {
    validarPeriodo(periodo);
    if (periodoComparacao) validarPeriodo(periodoComparacao);

    const atual = await this.analisarPeriodo(periodo, organizacaoId);
    let comparacao: {
      resultado: ResultadoPeriodoEficiencia;
      diferencaMediaHoras: number | null;
      variacaoPercentual: number | null;
    } | null = null;

    if (periodoComparacao) {
      const resultadoComparacao = await this.analisarPeriodo(periodoComparacao, organizacaoId);
      const mediaAtual = atual.duracaoMediaHoras;
      const mediaComparacao = resultadoComparacao.duracaoMediaHoras;
      comparacao = {
        resultado: resultadoComparacao,
        diferencaMediaHoras: mediaAtual !== null && mediaComparacao !== null
          ? arredondar(mediaAtual - mediaComparacao)
          : null,
        variacaoPercentual: mediaAtual !== null && mediaComparacao !== null && mediaComparacao !== 0
          ? arredondar(((mediaAtual - mediaComparacao) / mediaComparacao) * 100)
          : null
      };
    }

    const resultado = { ...atual, comparacao };
    return new RepositorioResultadoAnaliticoPrisma(this.db).salvar({
      tipo: TipoResultadoAnalitico.EFICIENCIA_OPERACIONAL,
      periodoInicio: periodo.inicio,
      periodoFim: periodo.fim,
      filtros: {
        periodoComparacao: periodoComparacao
          ? { inicio: periodoComparacao.inicio.toISOString(), fim: periodoComparacao.fim.toISOString() }
          : null
      },
      resultado: resultado as unknown as Prisma.InputJsonValue,
      ...(usuarioId ? { usuarioId } : {})
    }, tarefaId);
  }

  private async analisarPeriodo(periodo: PeriodoAnalise, organizacaoId?: string): Promise<ResultadoPeriodoEficiencia> {
    const eventos = await new RepositorioJournalPrisma(this.db).listarPorOperacaoNoPeriodo(
      "CONCLUIR_TRIAGEM_LOTE", periodo.inicio, periodo.fim
    );
    const ids = [...new Set(eventos
      .map((evento) => extrairIdLote(evento.dadosDepois))
      .filter((id): id is string => id !== null))];
    const lotes = await new RepositorioLotePrisma(this.db).buscarDatasEntradaPorIds(ids, organizacaoId);
    const datasEntrada = new Map(lotes.map((lote) => [lote.id, lote.dataEntrada]));
    const eventosDaOrganizacao = organizacaoId
      ? eventos.filter((evento) => {
        const id = extrairIdLote(evento.dadosDepois);
        return id !== null && datasEntrada.has(id);
      })
      : eventos;

    let registrosIgnorados = 0;
    const concluidos: LoteConcluido[] = [];
    const idsJaIncluidos = new Set<string>();
    for (const evento of eventosDaOrganizacao) {
      const loteId = extrairIdLote(evento.dadosDepois);
      if (!loteId) {
        registrosIgnorados += 1;
        continue;
      }
      if (idsJaIncluidos.has(loteId)) {
        registrosIgnorados += 1;
        continue;
      }
      const dataEntrada = datasEntrada.get(loteId);
      if (!dataEntrada || evento.timestamp.getTime() < dataEntrada.getTime()) {
        registrosIgnorados += 1;
        continue;
      }
      idsJaIncluidos.add(loteId);
      concluidos.push({
        loteId,
        dataEntrada: dataEntrada.toISOString(),
        concluidoEm: evento.timestamp.toISOString(),
        duracaoHoras: arredondar((evento.timestamp.getTime() - dataEntrada.getTime()) / 3_600_000),
        operador: evento.usuarioResponsavel
      });
    }

    const duracaoMediaHoras = calcularMedia(concluidos.map(({ duracaoHoras }) => duracaoHoras));
    const mediaGlobal = duracaoMediaHoras;
    const porOperador = new Map<string, number[]>();
    for (const lote of concluidos) {
      const duracoes = porOperador.get(lote.operador) ?? [];
      duracoes.push(lote.duracaoHoras);
      porOperador.set(lote.operador, duracoes);
    }
    const resumos = [...porOperador.entries()].map(([operador, duracoes]) => ({
      operador,
      lotesConcluidos: duracoes.length,
      duracaoMediaHoras: arredondar(calcularMedia(duracoes) ?? 0)
    })).sort((a, b) => b.duracaoMediaHoras - a.duracaoMediaHoras);

    return {
      periodo: { inicio: periodo.inicio.toISOString(), fim: periodo.fim.toISOString() },
      lotesConcluidos: concluidos.length,
      duracaoMediaHoras: duracaoMediaHoras === null ? null : arredondar(duracaoMediaHoras),
      porOperador: resumos,
      gargalosPorOperador: mediaGlobal === null
        ? []
        : resumos.filter(({ duracaoMediaHoras: media }) => media > mediaGlobal),
      maioresDuracoes: [...concluidos].sort((a, b) => b.duracaoHoras - a.duracaoHoras).slice(0, 5),
      lotes: concluidos,
      registrosIgnorados,
      semDados: concluidos.length === 0
    };
  }
}
