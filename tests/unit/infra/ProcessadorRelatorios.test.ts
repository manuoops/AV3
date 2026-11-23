import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { ResultadoAnalitico, TipoEquipamento, TipoResultadoAnalitico } from "@prisma/client";
import { ServicoAnaliseEficienciaPrisma } from "../../../src/analytics/ServicoAnaliseEficienciaPrisma";
import { ServicoAnaliseRentabilidadePrisma } from "../../../src/analytics/ServicoAnaliseRentabilidadePrisma";
import { ServicoAnaliseVidaUtilPrisma } from "../../../src/analytics/ServicoAnaliseVidaUtilPrisma";
import { DadosTarefaRelatorio } from "../../../src/queue/FilaRelatorios";
import { criarProcessadorRelatorios, ServicosProcessamentoRelatorios } from "../../../src/queue/ProcessadorRelatorios";
import { JobRelatorio } from "../../../src/queue/WorkerRelatorios";

describe("processador de tarefas de relatórios", () => {
  let diretorioSaida: string;

  beforeEach(async () => {
    diretorioSaida = await mkdtemp(join(tmpdir(), "greencode-processador-relatorios-"));
  });

  afterEach(async () => {
    await rm(diretorioSaida, { recursive: true, force: true });
  });

  function criarRelatorio(tipo: TipoResultadoAnalitico): ResultadoAnalitico {
    return {
      id: randomUUID(), tipo, geradoEm: new Date("2026-01-01T00:00:00.000Z"),
      tarefaId: null, periodoInicio: null, periodoFim: null, filtros: null, resultado: { registros: 2 }, usuarioId: null
    };
  }

  function criarJob(data: DadosTarefaRelatorio): JobRelatorio {
    return {
      id: randomUUID(), data, updateProgress: jest.fn().mockResolvedValue(undefined)
    } as unknown as JobRelatorio;
  }

  function criarServicos(relatorio: ResultadoAnalitico) {
    return {
      eficiencia: { gerar: jest.fn().mockResolvedValue(relatorio) },
      rentabilidade: { gerar: jest.fn().mockResolvedValue(relatorio) },
      vidaUtil: { gerar: jest.fn().mockResolvedValue(relatorio) }
    } as unknown as ServicosProcessamentoRelatorios;
  }

  it("calcula rentabilidade no escopo da organização e grava o JSON", async () => {
    const relatorio = criarRelatorio(TipoResultadoAnalitico.RENTABILIDADE_EQUIPAMENTO);
    const servicos = criarServicos(relatorio);
    const job = criarJob({
      tipo: TipoResultadoAnalitico.RENTABILIDADE_EQUIPAMENTO,
      organizacaoId: randomUUID(), apiKeyId: randomUUID(),
      periodo: { inicio: "2026-01-01T00:00:00.000Z", fim: "2026-01-31T23:59:59.999Z" }
    });

    const resultado = await criarProcessadorRelatorios(servicos, diretorioSaida)(job);

    expect(servicos.rentabilidade.gerar).toHaveBeenCalledWith(
      { inicio: new Date("2026-01-01T00:00:00.000Z"), fim: new Date("2026-01-31T23:59:59.999Z") },
      undefined,
      job.data.organizacaoId,
      job.id
    );
    expect(resultado).toMatchObject({ resultadoAnaliticoId: relatorio.id, tipo: relatorio.tipo, arquivo: `${job.id}.json` });
    const conteudo = JSON.parse(await readFile(join(diretorioSaida, resultado.arquivo), "utf8"));
    expect(conteudo).toMatchObject({ tarefaId: job.id, resultadoAnaliticoId: relatorio.id, resultado: { registros: 2 } });
    expect(job.updateProgress).toHaveBeenNthCalledWith(1, 10);
    expect(job.updateProgress).toHaveBeenNthCalledWith(3, 100);
  });

  it("processa eficiência usando período e período comparativo", async () => {
    const relatorio = criarRelatorio(TipoResultadoAnalitico.EFICIENCIA_OPERACIONAL);
    const servicos = criarServicos(relatorio);
    const periodo = { inicio: "2026-01-01T00:00:00.000Z", fim: "2026-01-31T23:59:59.999Z" };
    const periodoComparacao = { inicio: "2025-12-01T00:00:00.000Z", fim: "2025-12-31T23:59:59.999Z" };
    const job = criarJob({
      tipo: TipoResultadoAnalitico.EFICIENCIA_OPERACIONAL,
      organizacaoId: randomUUID(), apiKeyId: randomUUID(), periodo, periodoComparacao
    });

    await criarProcessadorRelatorios(servicos, diretorioSaida)(job);

    expect(servicos.eficiencia.gerar).toHaveBeenCalledWith(
      { inicio: new Date(periodo.inicio), fim: new Date(periodo.fim) },
      undefined,
      { inicio: new Date(periodoComparacao.inicio), fim: new Date(periodoComparacao.fim) },
      job.data.organizacaoId,
      job.id
    );
  });

  it("processa vida útil com o tipo de equipamento solicitado", async () => {
    const relatorio = criarRelatorio(TipoResultadoAnalitico.VIDA_UTIL_PREDITIVA);
    const servicos = criarServicos(relatorio);
    const job = criarJob({
      tipo: TipoResultadoAnalitico.VIDA_UTIL_PREDITIVA,
      organizacaoId: randomUUID(), apiKeyId: randomUUID(),
      tipoEquipamento: TipoEquipamento.NOTEBOOK
    });

    await criarProcessadorRelatorios(servicos, diretorioSaida)(job);

    expect(servicos.vidaUtil.gerar).toHaveBeenCalledWith(undefined, TipoEquipamento.NOTEBOOK, job.data.organizacaoId, job.id);
  });
});
