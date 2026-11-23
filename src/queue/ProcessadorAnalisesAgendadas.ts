import { createHash } from "node:crypto";
import {
  ServicoAnaliseEficienciaPrisma,
  PeriodoAnalise
} from "../analytics/ServicoAnaliseEficienciaPrisma";
import { ServicoAnaliseRentabilidadePrisma } from "../analytics/ServicoAnaliseRentabilidadePrisma";
import { ServicoAnaliseVidaUtilPrisma } from "../analytics/ServicoAnaliseVidaUtilPrisma";
import { DadosAnaliseAgendada } from "./FilaAnalisesAgendadas";
import type { JobAnaliseAgendada } from "./WorkerAnalisesAgendadas";
import { FUSO_HORARIO_AGENDAMENTO } from "./AgendadorAnalises";

export interface ServicosAnaliseAgendada {
  eficiencia: Pick<ServicoAnaliseEficienciaPrisma, "gerar">;
  rentabilidade: Pick<ServicoAnaliseRentabilidadePrisma, "gerar">;
  vidaUtil: Pick<ServicoAnaliseVidaUtilPrisma, "gerar">;
}

export interface ResultadoAnaliseAgendada {
  tarefaId: string;
  resultadoAnaliticoId: string;
  tipo: DadosAnaliseAgendada["tipo"];
}

function criarServicosPadrao(): ServicosAnaliseAgendada {
  return {
    eficiencia: new ServicoAnaliseEficienciaPrisma(),
    rentabilidade: new ServicoAnaliseRentabilidadePrisma(),
    vidaUtil: new ServicoAnaliseVidaUtilPrisma()
  };
}

/** Cria um UUID estável por job do BullMQ: as tentativas do mesmo job fazem upsert. */
export function criarIdempotencyKeyAgendada(jobId: string): string {
  const bytes = createHash("sha256").update(`greencode:analise-agendada:${jobId}`).digest().subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function partesNoFuso(data: Date): { ano: number; mes: number; dia: number } {
  const partes = new Intl.DateTimeFormat("en-US", {
    timeZone: FUSO_HORARIO_AGENDAMENTO,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(data);
  const valor = (tipo: string) => Number(partes.find((parte) => parte.type === tipo)?.value);
  return { ano: valor("year"), mes: valor("month"), dia: valor("day") };
}

function converterDataLocalParaUtc(ano: number, mes: number, dia: number): Date {
  const alvoComoUtc = Date.UTC(ano, mes - 1, dia);
  let estimativaUtc = alvoComoUtc;
  const formatador = new Intl.DateTimeFormat("en-US", {
    timeZone: FUSO_HORARIO_AGENDAMENTO,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23"
  });

  for (let iteracao = 0; iteracao < 4; iteracao += 1) {
    const partes = formatador.formatToParts(new Date(estimativaUtc));
    const valor = (tipo: string) => Number(partes.find((parte) => parte.type === tipo)?.value);
    const localRepresentadoComoUtc = Date.UTC(
      valor("year"), valor("month") - 1, valor("day"), valor("hour"), valor("minute"), valor("second")
    );
    const diferenca = alvoComoUtc - localRepresentadoComoUtc;
    estimativaUtc += diferenca;
    if (diferenca === 0) break;
  }
  return new Date(estimativaUtc);
}

/** Usa o mês-calendário anterior completo no fuso configurado, não uma janela móvel de 30 dias. */
export function obterPeriodoMesAnterior(dataExecucao: Date): PeriodoAnalise {
  if (!Number.isFinite(dataExecucao.getTime())) throw new Error("A data de execucao da analise e invalida.");
  const { ano, mes } = partesNoFuso(dataExecucao);
  const inicioMesAtual = converterDataLocalParaUtc(ano, mes, 1);
  const inicioMesAnterior = mes === 1
    ? converterDataLocalParaUtc(ano - 1, 12, 1)
    : converterDataLocalParaUtc(ano, mes - 1, 1);
  return { inicio: inicioMesAnterior, fim: new Date(inicioMesAtual.getTime() - 1) };
}

export function criarProcessadorAnalisesAgendadas(servicos: ServicosAnaliseAgendada = criarServicosPadrao()) {
  return async (job: JobAnaliseAgendada): Promise<ResultadoAnaliseAgendada> => {
    if (!job.id) throw new Error("O job agendado precisa de um ID BullMQ.");
    const tarefaId = criarIdempotencyKeyAgendada(job.id);
    await job.updateProgress(10);

    let resultadoAnaliticoId: string;
    switch (job.data.tipo) {
      case "EFICIENCIA_OPERACIONAL": {
        const periodo = obterPeriodoMesAnterior(new Date(job.timestamp));
        const resultado = await servicos.eficiencia.gerar(periodo, undefined, undefined, undefined, tarefaId);
        resultadoAnaliticoId = resultado.id;
        break;
      }
      case "RENTABILIDADE_EQUIPAMENTO": {
        const resultado = await servicos.rentabilidade.gerar(undefined, undefined, undefined, tarefaId);
        resultadoAnaliticoId = resultado.id;
        break;
      }
      case "VIDA_UTIL_PREDITIVA": {
        const resultado = await servicos.vidaUtil.gerar(undefined, undefined, undefined, tarefaId);
        resultadoAnaliticoId = resultado.id;
        break;
      }
      default:
        throw new Error("Tipo de analise agendada invalido.");
    }

    await job.updateProgress(100);
    return { tarefaId, resultadoAnaliticoId, tipo: job.data.tipo };
  };
}
