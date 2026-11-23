import { Queue } from "bullmq";
import { TipoResultadoAnalitico } from "@prisma/client";
import { obterConexaoRedis, NOME_FILA_ANALISES_AGENDADAS } from "./ConfiguracaoFila";

export interface DadosAnaliseAgendada {
  tipo: TipoResultadoAnalitico;
}

export const NOME_JOB_ANALISE_AGENDADA = "gerar-analise-agendada";

export function criarFilaAnalisesAgendadas(redisUrl?: string) {
  return new Queue<DadosAnaliseAgendada>(NOME_FILA_ANALISES_AGENDADAS, {
    connection: obterConexaoRedis(redisUrl),
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: "exponential", delay: 1_000 },
      removeOnComplete: false,
      removeOnFail: false
    }
  });
}
