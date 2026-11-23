import { PrismaExecutor } from "../../../src/infra/repositories/PrismaExecutor";
import { ServicoAnaliseEficienciaPrisma } from "../../../src/analytics/ServicoAnaliseEficienciaPrisma";
import { ServicoAnaliseVidaUtilPrisma } from "../../../src/analytics/ServicoAnaliseVidaUtilPrisma";
import { ServicoAnaliseRentabilidadePrisma } from "../../../src/analytics/ServicoAnaliseRentabilidadePrisma";

function criarBancoFalso(overrides: Record<string, unknown> = {}): PrismaExecutor {
  return {
    journalTransacao: { findMany: jest.fn().mockResolvedValue([]) },
    lote: { findMany: jest.fn().mockResolvedValue([]) },
    equipamento: { findMany: jest.fn().mockResolvedValue([]) },
    resultadoAnalitico: { create: jest.fn(async ({ data }) => ({ id: "analise-1", ...data })) },
    ...overrides
  } as unknown as PrismaExecutor;
}

describe("servicos de analise AV3", () => {
  it("calcula duracao da triagem e agrupa resultado por operador", async () => {
    const entrada = new Date("2026-01-01T00:00:00Z");
    const conclusao = new Date("2026-01-01T12:00:00Z");
    const db = criarBancoFalso({
      journalTransacao: {
        findMany: jest.fn().mockResolvedValue([{
          dadosDepois: { id: "lote-1" }, timestamp: conclusao, usuarioResponsavel: "ana"
        }])
      },
      lote: { findMany: jest.fn().mockResolvedValue([{ id: "lote-1", dataEntrada: entrada }]) }
    });

    const resultado = await new ServicoAnaliseEficienciaPrisma(db).gerar(
      { inicio: new Date("2026-01-01T00:00:00Z"), fim: new Date("2026-01-02T00:00:00Z") },
      "usuario-1"
    );

    expect(resultado.resultado).toMatchObject({
      lotesConcluidos: 1,
      duracaoMediaHoras: 12,
      porOperador: [{ operador: "ana", lotesConcluidos: 1, duracaoMediaHoras: 12 }]
    });
  });

  it("não inventa previsões quando o histórico tem menos de duas observações", async () => {
    const db = criarBancoFalso({
      equipamento: {
        findMany: jest.fn().mockResolvedValue([{
          id: "equip-1", tipo: "COMPUTADOR_MESA", marca: "Marca", modelo: "M1", estadoFisico: "BOM_ESTADO"
        }])
      },
      journalTransacao: {
        findMany: jest.fn().mockResolvedValue([{
          timestamp: new Date("2026-01-01T00:00:00Z"),
          dadosDepois: { id: "equip-1", estadoFisico: "BOM_ESTADO" }
        }])
      }
    });

    const resultado = await new ServicoAnaliseVidaUtilPrisma(db).gerar("usuario-1");

    expect(resultado.resultado).toMatchObject({
      semDados: true,
      previsoes: [{ equipamentoId: "equip-1", situacao: "DADOS_INSUFICIENTES", diasEstimadosAteInservivel: null }]
    });
  });

  it("persiste um valor manual e o estado observado no momento do registro", async () => {
    const createRecuperacao = jest.fn(async ({ data }) => ({ id: "valor-1", ...data }));
    const createJournal = jest.fn().mockResolvedValue({ id: "journal-1" });
    const tx = {
      equipamento: { findUnique: jest.fn().mockResolvedValue({ id: "equip-1", estadoFisico: "USADO_LEVE" }) },
      recuperacaoEquipamento: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: createRecuperacao
      },
      journalTransacao: { create: createJournal }
    } as unknown as PrismaExecutor;
    const transacionar = async <T>(operacao: (executor: PrismaExecutor) => Promise<T>) => operacao(tx);
    const servico = new ServicoAnaliseRentabilidadePrisma(transacionar, tx);

    const salvo = await servico.registrarValorRecuperado("equip-1", 125.5, "ana", "valor da triagem");

    expect(createRecuperacao).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        equipamentoId: "equip-1",
        valorRecuperado: expect.objectContaining({ s: 1 }),
        estadoFisico: "USADO_LEVE",
        registradoPor: "ana"
      })
    }));
    expect(createJournal).toHaveBeenCalledTimes(1);
    expect(salvo.estadoFisico).toBe("USADO_LEVE");
  });

  it("não aceita valores negativos de recuperação", async () => {
    const servico = new ServicoAnaliseRentabilidadePrisma();
    await expect(servico.registrarValorRecuperado("equip-1", -1, "ana"))
      .rejects.toThrow("maior ou igual a zero");
  });

  it("calcula médias com avaliações reais e só estima para perfil exatamente comparável", async () => {
    const salvarResultado = jest.fn(async ({ data }) => ({ id: "analise-2", ...data }));
    const db = criarBancoFalso({
      equipamento: {
        findMany: jest.fn().mockResolvedValue([
          { id: "equip-2", tipo: "COMPUTADOR_MESA", marca: "Marca A", modelo: "M1", estadoFisico: "BOM_ESTADO" },
          { id: "equip-3", tipo: "COMPUTADOR_MESA", marca: "Marca B", modelo: "M2", estadoFisico: "BOM_ESTADO" }
        ])
      },
      recuperacaoEquipamento: {
        findMany: jest.fn().mockResolvedValue([{
          equipamentoId: "equip-1",
          valorRecuperado: { toNumber: () => 100 },
          estadoFisico: "BOM_ESTADO",
          avaliadoEm: new Date("2026-01-01T00:00:00Z"),
          equipamento: {
            id: "equip-1", tipo: "COMPUTADOR_MESA", marca: "Marca A", modelo: "M1", estadoFisico: "USADO_LEVE"
          }
        }])
      },
      resultadoAnalitico: { create: salvarResultado }
    });

    const resultado = await new ServicoAnaliseRentabilidadePrisma(undefined, db).gerar(undefined, "usuario-1");
    const salvo = salvarResultado.mock.calls[0]?.[0].data;

    expect(resultado.id).toBe("analise-2");
    expect(salvo.resultado).toMatchObject({
      equipamentosComValorReal: 1,
      porTipo: [{ grupo: "COMPUTADOR_MESA", amostras: 1, valorMedio: 100 }],
      estimativasPorPerfilComparavel: [{ equipamentoId: "equip-2", valorEstimado: 100, equipamentosComparaveisComValorReal: 1 }]
    });
  });
});
