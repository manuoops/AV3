import { Queue } from "bullmq";
import { TipoResultadoAnalitico } from "@prisma/client";
import { DadosAnaliseAgendada, NOME_JOB_ANALISE_AGENDADA } from "./FilaAnalisesAgendadas";

export const FUSO_HORARIO_AGENDAMENTO = "America/Sao_Paulo";
export const AGENDAMENTOS_ANALITICOS = [
  {
    id: "analise-eficiencia-mensal",
    tipo: TipoResultadoAnalitico.EFICIENCIA_OPERACIONAL,
    pattern: "0 2 1 * *"
  },
  {
    id: "analise-rentabilidade-semanal",
    tipo: TipoResultadoAnalitico.RENTABILIDADE_EQUIPAMENTO,
    pattern: "10 2 * * 1"
  },
  {
    id: "analise-vida-util-semanal",
    tipo: TipoResultadoAnalitico.VIDA_UTIL_PREDITIVA,
    pattern: "20 2 * * 1"
  }
] as const;

type FilaComAgendador = Pick<Queue<DadosAnaliseAgendada>, "upsertJobScheduler">;

/** Cria ou atualiza os agendamentos. Os IDs fixos tornam a inicialização repetível. */
export async function registrarAgendamentosAnaliticos(fila: FilaComAgendador): Promise<void> {
  for (const agendamento of AGENDAMENTOS_ANALITICOS) {
    await fila.upsertJobScheduler(
      agendamento.id,
      { pattern: agendamento.pattern, tz: FUSO_HORARIO_AGENDAMENTO },
      {
        name: NOME_JOB_ANALISE_AGENDADA,
        data: { tipo: agendamento.tipo },
        opts: {
          attempts: 3,
          backoff: { type: "exponential", delay: 1_000 },
          removeOnComplete: false,
          removeOnFail: false
        }
      }
    );
  }
}
