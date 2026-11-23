import { PermissaoChaveApi, Prisma } from "@prisma/client";
import { prisma } from "../PrismaClient";
import { PrismaExecutor } from "./PrismaExecutor";

export class RepositorioChaveApiPrisma {
  constructor(private readonly db: PrismaExecutor = prisma) {}

  public buscarAtivaPorHash(hashChave: string, agora = new Date()) {
    return this.db.chaveApi.findFirst({
      where: {
        hashChave,
        revogadaEm: null,
        OR: [{ expiraEm: null }, { expiraEm: { gt: agora } }],
        organizacao: { ativo: true }
      },
      select: { id: true, organizacaoId: true, permissoes: true }
    });
  }

  public criar(dados: Prisma.ChaveApiUncheckedCreateInput) {
    return this.db.chaveApi.create({ data: dados });
  }

  public buscarPorId(id: string) {
    return this.db.chaveApi.findUnique({ where: { id } });
  }

  public atualizarAtiva(id: string, versaoEsperada: number, dados: Prisma.ChaveApiUncheckedUpdateInput) {
    return this.db.chaveApi.updateMany({ where: { id, revogadaEm: null, versao: versaoEsperada }, data: dados });
  }

  public listar() {
    return this.db.chaveApi.findMany({
      select: {
        id: true, nome: true, prefixo: true, permissoes: true, organizacaoId: true,
        criadaPorId: true, criadaEm: true, expiraEm: true, revogadaEm: true, ultimoUsoEm: true, versao: true
      },
      orderBy: { criadaEm: "desc" }
    });
  }

  public registrarUso(id: string, quando = new Date()) {
    return this.db.chaveApi.updateMany({
      where: { id, revogadaEm: null, OR: [{ expiraEm: null }, { expiraEm: { gt: quando } }] },
      data: { ultimoUsoEm: quando }
    });
  }

  public revogar(id: string, quando = new Date()) {
    return this.db.chaveApi.updateMany({
      where: { id, revogadaEm: null },
      data: { revogadaEm: quando }
    });
  }
}
