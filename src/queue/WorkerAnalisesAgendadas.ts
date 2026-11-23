import { Job, Processor, Worker } from "bullmq";
import { obterConexaoRedis, NOME_FILA_ANALISES_AGENDADAS } from "./ConfiguracaoFila";
import { DadosAnaliseAgendada } from "./FilaAnalisesAgendadas";
import { ResultadoAnaliseAgendada } from "./ProcessadorAnalisesAgendadas";

export type JobAnaliseAgendada = Job<DadosAnaliseAgendada>;

export function criarWorkerAnalisesAgendadas(
  processador: Processor<DadosAnaliseAgendada, ResultadoAnaliseAgendada>,
  redisUrl?: string
) {
  return new Worker<DadosAnaliseAgendada, ResultadoAnaliseAgendada>(
    NOME_FILA_ANALISES_AGENDADAS,
    processador,
    { connection: obterConexaoRedis(redisUrl), concurrency: 1 }
  );
}
