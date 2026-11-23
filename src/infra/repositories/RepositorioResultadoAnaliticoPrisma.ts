import { Prisma, TipoResultadoAnalitico } from "@prisma/client";
import { prisma } from "../PrismaClient";
import { PrismaExecutor } from "./PrismaExecutor";

export class RepositorioResultadoAnaliticoPrisma {
  constructor(private readonly db: PrismaExecutor = prisma) {}

  public criar(dados: Prisma.ResultadoAnaliticoUncheckedCreateInput) {
    return this.db.resultadoAnalitico.create({ data: dados });
  }

  public criarOuAtualizarParaTarefa(tarefaId: string, dados: Prisma.ResultadoAnaliticoUncheckedCreateInput) {
    return this.db.resultadoAnalitico.upsert({
      where: { tarefaId },
      create: { ...dados, tarefaId },
      update: dados
    });
  }

  public salvar(dados: Prisma.ResultadoAnaliticoUncheckedCreateInput, tarefaId?: string) {
    return tarefaId ? this.criarOuAtualizarParaTarefa(tarefaId, dados) : this.criar(dados);
  }

  public buscarPorId(id: string) {
    return this.db.resultadoAnalitico.findUnique({ where: { id } });
  }

  public listar(tipo?: TipoResultadoAnalitico, skip = 0, take = 50) {
    return this.db.resultadoAnalitico.findMany({
      ...(tipo ? { where: { tipo } } : {}),
      skip,
      take,
      orderBy: { geradoEm: "desc" }
    });
  }
}
