import { randomUUID } from "node:crypto";
import { TipoResultadoAnalitico } from "@prisma/client";
import {
  criarIdempotencyKeyAgendada,
  criarProcessadorAnalisesAgendadas,
  obterPeriodoMesAnterior,
  ServicosAnaliseAgendada
} from "../../../src/queue/ProcessadorAnalisesAgendadas";
import { DadosAnaliseAgendada } from "../../../src/queue/FilaAnalisesAgendadas";
import { JobAnaliseAgendada } from "../../../src/queue/WorkerAnalisesAgendadas";

describe("processador de análises agendadas", () => {
  function criarServicos() {
    const resultado = { id: randomUUID() };
    const servicos = {
      eficiencia: { gerar: jest.fn().mockResolvedValue(resultado) },
      rentabilidade: { gerar: jest.fn().mockResolvedValue(resultado) },
      vidaUtil: { gerar: jest.fn().mockResolvedValue(resultado) }
    } as unknown as ServicosAnaliseAgendada;
    return { servicos, resultado };
  }

  function criarJob(tipo: TipoResultadoAnalitico, id = "repeat:agendamento:123") {
    return {
      id, data: { tipo } satisfies DadosAnaliseAgendada,
      timestamp: Date.parse("2026-11-01T05:00:00.000Z"),
      updateProgress: jest.fn().mockResolvedValue(undefined)
    } as unknown as JobAnaliseAgendada;
  }

  it("calcula o mês-calendário anterior no fuso de São Paulo", () => {
    expect(obterPeriodoMesAnterior(new Date("2026-11-01T05:00:00.000Z"))).toEqual({
      inicio: new Date("2026-10-01T03:00:00.000Z"),
      fim: new Date("2026-11-01T02:59:59.999Z")
    });
  });

  it("gera chave idempotente UUID estável para as tentativas do mesmo job", () => {
    const primeira = criarIdempotencyKeyAgendada("repeat:agendamento:123");
    expect(primeira).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    expect(criarIdempotencyKeyAgendada("repeat:agendamento:123")).toBe(primeira);
    expect(criarIdempotencyKeyAgendada("repeat:agendamento:124")).not.toBe(primeira);
  });

  it("executa as três categorias e associa resultado ao job para evitar duplicação em retry", async () => {
    const { servicos, resultado } = criarServicos();
    const processar = criarProcessadorAnalisesAgendadas(servicos);
    const jobEficiencia = criarJob(TipoResultadoAnalitico.EFICIENCIA_OPERACIONAL);
    const jobRentabilidade = criarJob(TipoResultadoAnalitico.RENTABILIDADE_EQUIPAMENTO);
    const jobVidaUtil = criarJob(TipoResultadoAnalitico.VIDA_UTIL_PREDITIVA);

    const eficiencia = await processar(jobEficiencia);
    const rentabilidade = await processar(jobRentabilidade);
    const vidaUtil = await processar(jobVidaUtil);

    expect(servicos.eficiencia.gerar).toHaveBeenCalledWith(
      { inicio: new Date("2026-10-01T03:00:00.000Z"), fim: new Date("2026-11-01T02:59:59.999Z") },
      undefined, undefined, undefined, criarIdempotencyKeyAgendada(jobEficiencia.id!)
    );
    expect(servicos.rentabilidade.gerar).toHaveBeenCalledWith(
      undefined, undefined, undefined, criarIdempotencyKeyAgendada(jobRentabilidade.id!)
    );
    expect(servicos.vidaUtil.gerar).toHaveBeenCalledWith(
      undefined, undefined, undefined, criarIdempotencyKeyAgendada(jobVidaUtil.id!)
    );
    expect(eficiencia).toMatchObject({ resultadoAnaliticoId: resultado.id, tipo: TipoResultadoAnalitico.EFICIENCIA_OPERACIONAL });
    expect(rentabilidade.tarefaId).toBe(criarIdempotencyKeyAgendada(jobRentabilidade.id!));
    expect(vidaUtil.tipo).toBe(TipoResultadoAnalitico.VIDA_UTIL_PREDITIVA);
    expect(jobEficiencia.updateProgress).toHaveBeenNthCalledWith(1, 10);
    expect(jobEficiencia.updateProgress).toHaveBeenNthCalledWith(2, 100);
  });

  it("deixa a exceção propagar para o retry do BullMQ", async () => {
    const { servicos } = criarServicos();
    const erro = new Error("falha simulada");
    (servicos.vidaUtil.gerar as jest.Mock).mockRejectedValue(erro);

    await expect(criarProcessadorAnalisesAgendadas(servicos)(criarJob(TipoResultadoAnalitico.VIDA_UTIL_PREDITIVA)))
      .rejects.toBe(erro);
  });
});
