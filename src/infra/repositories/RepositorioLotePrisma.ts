import { Prisma, StatusLote } from "@prisma/client";
import { prisma } from "../PrismaClient";
import { PrismaExecutor } from "./PrismaExecutor";

export class RepositorioLotePrisma {
  constructor(private readonly db: PrismaExecutor = prisma) {}

  public criar(dados: Prisma.LoteUncheckedCreateInput) {
    return this.db.lote.create({ data: dados });
  }

  public buscarPorId(id: string) {
    return this.db.lote.findUnique({ where: { id }, include: { equipamentos: true } });
  }

  public buscarDatasEntradaPorIds(ids: string[], organizacaoId?: string) {
    return this.db.lote.findMany({
      where: { id: { in: ids }, ...(organizacaoId ? { organizacaoId } : {}) },
      select: { id: true, dataEntrada: true, organizacaoId: true }
    });
  }

  public listarPorPeriodo(dataInicio: Date, dataFim: Date, skip = 0, take = 100) {
    return this.db.lote.findMany({
      where: { dataEntrada: { gte: dataInicio, lte: dataFim } },
      skip,
      take,
      orderBy: { dataEntrada: "asc" },
      include: { equipamentos: true }
    });
  }

  public listar(filtros: {
    organizacaoId?: string; dataInicio?: Date; dataFim?: Date; statusProcessamento?: StatusLote;
    skip?: number; take?: number;
  } = {}) {
    return this.db.lote.findMany({
      where: {
        ...(filtros.organizacaoId ? { organizacaoId: filtros.organizacaoId } : {}),
        ...(filtros.statusProcessamento ? { statusProcessamento: filtros.statusProcessamento } : {}),
        ...(filtros.dataInicio || filtros.dataFim ? { dataEntrada: {
          ...(filtros.dataInicio ? { gte: filtros.dataInicio } : {}),
          ...(filtros.dataFim ? { lte: filtros.dataFim } : {})
        } } : {})
      },
      skip: filtros.skip ?? 0,
      take: filtros.take ?? 100,
      orderBy: { dataEntrada: "desc" },
      include: { equipamentos: true }
    });
  }

  public listarPorOrganizacaoEPeriodo(organizacaoId: string, dataInicio: Date, dataFim: Date, skip = 0, take = 100) {
    return this.db.lote.findMany({
      where: { organizacaoId, dataEntrada: { gte: dataInicio, lte: dataFim } },
      skip,
      take,
      orderBy: { dataEntrada: "asc" },
      include: { equipamentos: true }
    });
  }

  public atualizarSeVersao(id: string, versaoEsperada: number, dados: Prisma.LoteUncheckedUpdateInput) {
    return this.db.lote.updateMany({ where: { id, versao: versaoEsperada }, data: dados });
  }

  public excluirSeVersao(id: string, versaoEsperada: number) {
    return this.db.lote.deleteMany({ where: { id, versao: versaoEsperada } });
  }
}
