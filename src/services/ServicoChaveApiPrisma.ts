import { createHash, randomBytes } from "crypto";
import { PermissaoChaveApi, Prisma } from "@prisma/client";
import { executarTransacao } from "../infra/TransacaoPrisma";
import { prisma } from "../infra/PrismaClient";
import { PrismaExecutor } from "../infra/repositories/PrismaExecutor";
import { RepositorioChaveApiPrisma } from "../infra/repositories/RepositorioChaveApiPrisma";
import { RepositorioJournalPrisma } from "../infra/repositories/RepositorioJournalPrisma";
import { RepositorioOrganizacaoPrisma } from "../infra/repositories/RepositorioOrganizacaoPrisma";
import { ErroConflitoVersao, validarVersaoEsperada } from "./ErrosServico";

type Transacionador = <T>(operacao: (tx: Prisma.TransactionClient) => Promise<T>) => Promise<T>;

export interface DadosNovaChaveApi {
  nome: string;
  organizacaoId: string;
  permissoes: PermissaoChaveApi[];
  expiraEm?: Date;
  criadaPorId: string;
}

export interface DadosAtualizacaoChaveApi {
  nome: string;
  permissoes: PermissaoChaveApi[];
  expiraEm?: Date | null;
}

export function calcularHashChaveApi(chave: string): string {
  return createHash("sha256").update(chave, "utf8").digest("hex");
}

export class ServicoChaveApiPrisma {
  constructor(
    private readonly transacionar: Transacionador = executarTransacao,
    private readonly db: PrismaExecutor = prisma
  ) {}

  public async criar(dados: DadosNovaChaveApi) {
    const nome = dados.nome.trim();
    if (nome.length < 3 || nome.length > 80) throw new Error("O nome da chave deve ter entre 3 e 80 caracteres.");
    if (!dados.organizacaoId.trim()) throw new Error("organizacaoId e obrigatorio.");
    if (!dados.criadaPorId.trim()) throw new Error("criadaPorId e obrigatorio.");
    if (!dados.permissoes.length || new Set(dados.permissoes).size !== dados.permissoes.length) {
      throw new Error("Informe ao menos uma permissao e nao repita permissoes.");
    }
    if (dados.expiraEm && (!Number.isFinite(dados.expiraEm.getTime()) || dados.expiraEm <= new Date())) {
      throw new Error("expiraEm deve ser uma data futura valida.");
    }

    const chave = `gcp_live_${randomBytes(32).toString("base64url")}`;
    const hashChave = calcularHashChaveApi(chave);
    const prefixo = chave.slice(0, 20);

    const criado = await this.transacionar(async (tx) => {
      const organizacao = await new RepositorioOrganizacaoPrisma(tx).buscarPorId(dados.organizacaoId);
      if (!organizacao || !organizacao.ativo) throw new Error("Organizacao nao encontrada ou inativa.");

      const registro = await new RepositorioChaveApiPrisma(tx).criar({
        nome,
        prefixo,
        hashChave,
        permissoes: dados.permissoes,
        organizacaoId: dados.organizacaoId,
        criadaPorId: dados.criadaPorId,
        ...(dados.expiraEm ? { expiraEm: dados.expiraEm } : {})
      });
      await new RepositorioJournalPrisma(tx).registrar({
        operacao: "CRIAR_CHAVE_API",
        entidade: "ChaveApi",
        dadosDepois: {
          id: registro.id,
          nome: registro.nome,
          prefixo: registro.prefixo,
          organizacaoId: registro.organizacaoId,
          permissoes: registro.permissoes
        },
        usuarioResponsavel: dados.criadaPorId
      });
      return {
        id: registro.id,
        nome: registro.nome,
        prefixo: registro.prefixo,
        organizacaoId: registro.organizacaoId,
        permissoes: registro.permissoes,
        criadaEm: registro.criadaEm,
        expiraEm: registro.expiraEm,
        versao: registro.versao
      };
    });

    return { ...criado, chave };
  }

  public listar() {
    return new RepositorioChaveApiPrisma(this.db).listar();
  }

  public async buscarPorId(id: string) {
    const registro = await new RepositorioChaveApiPrisma(this.db).buscarPorId(id);
    if (!registro) return null;
    const { hashChave: _hashChave, ...dadosPublicos } = registro;
    return dadosPublicos;
  }

  public async atualizar(id: string, dados: DadosAtualizacaoChaveApi, versaoEsperada: number, usuarioResponsavel: string) {
    validarVersaoEsperada(versaoEsperada);
    const nome = dados.nome.trim();
    if (nome.length < 3 || nome.length > 80) throw new Error("O nome da chave deve ter entre 3 e 80 caracteres.");
    if (!dados.permissoes.length || new Set(dados.permissoes).size !== dados.permissoes.length ||
      dados.permissoes.some((permissao) => !Object.values(PermissaoChaveApi).includes(permissao))) {
      throw new Error("Informe permissoes validas, sem repeticao.");
    }
    if (dados.expiraEm && (!Number.isFinite(dados.expiraEm.getTime()) || dados.expiraEm <= new Date())) {
      throw new Error("expiraEm deve ser uma data futura valida.");
    }
    return this.transacionar(async (tx) => {
      const repo = new RepositorioChaveApiPrisma(tx);
      const atual = await repo.buscarPorId(id);
      if (!atual || atual.revogadaEm) throw new Error("Chave nao encontrada ou ja revogada.");
      if (atual.versao !== versaoEsperada) throw new ErroConflitoVersao();
      const resultado = await repo.atualizarAtiva(id, versaoEsperada, {
        nome, permissoes: dados.permissoes,
        expiraEm: dados.expiraEm ?? null, versao: { increment: 1 }
      });
      if (resultado.count === 0) throw new ErroConflitoVersao();
      const atualizado = await repo.buscarPorId(id);
      if (!atualizado) throw new Error("Chave nao encontrada ou ja revogada.");
      await new RepositorioJournalPrisma(tx).registrar({
        operacao: "ATUALIZAR_CHAVE_API", entidade: "ChaveApi",
        dadosAntes: { id, nome: atual.nome, permissoes: atual.permissoes, expiraEm: atual.expiraEm?.toISOString() ?? null },
        dadosDepois: { id, nome: atualizado.nome, permissoes: atualizado.permissoes, expiraEm: atualizado.expiraEm?.toISOString() ?? null },
        usuarioResponsavel
      });
      return {
        id: atualizado.id, nome: atualizado.nome, prefixo: atualizado.prefixo,
        permissoes: atualizado.permissoes, organizacaoId: atualizado.organizacaoId,
        criadaEm: atualizado.criadaEm, expiraEm: atualizado.expiraEm, revogadaEm: atualizado.revogadaEm, versao: atualizado.versao
      };
    });
  }

  public async revogar(id: string, usuarioResponsavel: string) {
    if (!id.trim()) throw new Error("id da chave e obrigatorio.");
    return this.transacionar(async (tx) => {
      const repo = new RepositorioChaveApiPrisma(tx);
      const resultado = await repo.revogar(id);
      if (resultado.count === 0) throw new Error("Chave nao encontrada ou ja revogada.");
      await new RepositorioJournalPrisma(tx).registrar({
        operacao: "REVOGAR_CHAVE_API",
        entidade: "ChaveApi",
        dadosDepois: { id },
        usuarioResponsavel
      });
      return { id, revogada: true };
    });
  }

  public async autenticar(chave?: string) {
    if (!chave || chave.length > 100 || !/^gcp_live_[A-Za-z0-9_-]{40,60}$/.test(chave)) return null;
    const hash = calcularHashChaveApi(chave);
    const repo = new RepositorioChaveApiPrisma(this.db);
    const registro = await repo.buscarAtivaPorHash(hash);
    if (!registro) return null;
    const atualizacao = await repo.registrarUso(registro.id);
    if (atualizacao.count !== 1) return null;
    return {
      id: registro.id,
      organizacaoId: registro.organizacaoId,
      permissoes: registro.permissoes
    };
  }
}
