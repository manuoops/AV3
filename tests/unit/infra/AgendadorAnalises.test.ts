import { TipoResultadoAnalitico } from "@prisma/client";
import {
  AGENDAMENTOS_ANALITICOS,
  FUSO_HORARIO_AGENDAMENTO,
  registrarAgendamentosAnaliticos
} from "../../../src/queue/AgendadorAnalises";
import { NOME_JOB_ANALISE_AGENDADA } from "../../../src/queue/FilaAnalisesAgendadas";

describe("agendamento recorrente de análises", () => {
  it("registra cada tipo com o calendário definido no fuso de São Paulo", async () => {
    const fila = { upsertJobScheduler: jest.fn().mockResolvedValue(undefined) };

    await registrarAgendamentosAnaliticos(fila as never);

    expect(fila.upsertJobScheduler).toHaveBeenCalledTimes(3);
    expect(fila.upsertJobScheduler).toHaveBeenNthCalledWith(1,
      "analise-eficiencia-mensal",
      { pattern: "0 2 1 * *", tz: FUSO_HORARIO_AGENDAMENTO },
      expect.objectContaining({ name: NOME_JOB_ANALISE_AGENDADA, data: { tipo: TipoResultadoAnalitico.EFICIENCIA_OPERACIONAL } })
    );
    expect(fila.upsertJobScheduler).toHaveBeenNthCalledWith(2,
      "analise-rentabilidade-semanal",
      { pattern: "10 2 * * 1", tz: FUSO_HORARIO_AGENDAMENTO },
      expect.objectContaining({ data: { tipo: TipoResultadoAnalitico.RENTABILIDADE_EQUIPAMENTO } })
    );
    expect(fila.upsertJobScheduler).toHaveBeenNthCalledWith(3,
      "analise-vida-util-semanal",
      { pattern: "20 2 * * 1", tz: FUSO_HORARIO_AGENDAMENTO },
      expect.objectContaining({ data: { tipo: TipoResultadoAnalitico.VIDA_UTIL_PREDITIVA } })
    );
    expect(AGENDAMENTOS_ANALITICOS).toHaveLength(3);
  });

  it("configura retentativas e mantém jobs para consulta", async () => {
    const fila = { upsertJobScheduler: jest.fn().mockResolvedValue(undefined) };
    await registrarAgendamentosAnaliticos(fila as never);
    const opcoes = fila.upsertJobScheduler.mock.calls[0]![2].opts;
    expect(opcoes).toMatchObject({
      attempts: 3,
      backoff: { type: "exponential", delay: 1_000 },
      removeOnComplete: false,
      removeOnFail: false
    });
  });
});
