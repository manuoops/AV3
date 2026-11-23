import { Prisma } from "@prisma/client";
import { prisma } from "../PrismaClient";
import { PrismaExecutor } from "./PrismaExecutor";

export class RepositorioRecuperacaoEquipamentoPrisma {
  constructor(private readonly db: PrismaExecutor = prisma) {}

  public buscarPorEquipamento(equipamentoId: string) {
    return this.db.recuperacaoEquipamento.findFirst({ where: { equipamentoId }, orderBy: { avaliadoEm: "desc" } });
  }

  public salvar(
    equipamentoId: string,
    dados: Omit<Prisma.RecuperacaoEquipamentoUncheckedCreateInput, "equipamentoId">
  ) {
    return this.db.recuperacaoEquipamento.create({ data: { equipamentoId, ...dados } });
  }

  public listarPorPeriodo(inicio?: Date, fim?: Date, organizacaoId?: string) {
    const avaliadoEm = inicio || fim
      ? { ...(inicio ? { gte: inicio } : {}), ...(fim ? { lte: fim } : {}) }
      : undefined;
    return this.db.recuperacaoEquipamento.findMany({
      ...(avaliadoEm || organizacaoId ? { where: {
        ...(avaliadoEm ? { avaliadoEm } : {}),
        ...(organizacaoId ? { equipamento: { lote: { organizacaoId } } } : {})
      } } : {}),
      include: {
        equipamento: {
          select: { id: true, tipo: true, marca: true, modelo: true, estadoFisico: true }
        }
      },
      orderBy: { avaliadoEm: "asc" }
    });
  }

  public listarPorEquipamento(equipamentoId: string, skip = 0, take = 100) {
    return this.db.recuperacaoEquipamento.findMany({
      where: { equipamentoId }, skip, take, orderBy: { avaliadoEm: "desc" }
    });
  }
}
