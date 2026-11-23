import { Queue } from "bullmq";
import { TipoEquipamento, TipoResultadoAnalitico } from "@prisma/client";
import { obterConexaoRedis, NOME_FILA_RELATORIOS } from "./ConfiguracaoFila";

export interface PeriodoTarefaRelatorio {
  inicio: string;
  fim: string;
}

export interface DadosTarefaRelatorio {
  tipo: TipoResultadoAnalitico;
  organizacaoId: string;
  apiKeyId: string;
  periodo?: PeriodoTarefaRelatorio;
  periodoComparacao?: PeriodoTarefaRelatorio;
  tipoEquipamento?: TipoEquipamento;
}

export const NOME_JOB_RELATORIO_ANALITICO = "gerar-relatorio-analitico";

export function criarFilaRelatorios(redisUrl?: string) {
  return new Queue<DadosTarefaRelatorio>(NOME_FILA_RELATORIOS, {
    connection: obterConexaoRedis(redisUrl),
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: "exponential", delay: 1_000 },
      removeOnComplete: false,
      removeOnFail: false
    }
  });
}
