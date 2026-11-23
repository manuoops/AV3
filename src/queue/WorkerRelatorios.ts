import { Job, Processor, Worker } from "bullmq";
import { obterConexaoRedis, NOME_FILA_RELATORIOS } from "./ConfiguracaoFila";
import { DadosTarefaRelatorio } from "./FilaRelatorios";

/** Cria o worker BullMQ usado pelo processador de relatórios. */
export function criarWorkerRelatorios(
  processador: Processor<DadosTarefaRelatorio>,
  redisUrl?: string
) {
  return new Worker<DadosTarefaRelatorio>(NOME_FILA_RELATORIOS, processador, {
    connection: obterConexaoRedis(redisUrl)
  });
}

export type JobRelatorio = Job<DadosTarefaRelatorio>;
