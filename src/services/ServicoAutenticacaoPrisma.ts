import { PapelUsuario, Prisma } from "@prisma/client";
import { RepositorioUsuarioPrisma } from "../infra/repositories/RepositorioUsuarioPrisma";
import { RepositorioJournalPrisma } from "../infra/repositories/RepositorioJournalPrisma";
import { HashSenhaScrypt } from "../security/HashSenhaScrypt";
import { ErroConflitoVersao, ErroPapelUsuarioNaoPermitido, validarVersaoEsperada } from "./ErrosServico";

const TAMANHO_MINIMO_SENHA = 12;
const TAMANHO_MINIMO_USUARIO = 3;
const TAMANHO_MAXIMO_USUARIO = 50;

export type UsuarioPublico = Pick<
  Prisma.UsuarioGetPayload<Record<string, never>>,
  "id" | "usuario" | "papel" | "ativo" | "ultimoAcesso" | "criadoEm" | "versao"
>;

function semHashSenha(usuario: Awaited<ReturnType<RepositorioUsuarioPrisma["buscarPorId"]>>): UsuarioPublico | null {
  if (!usuario) return null;
  const { hashSenha: _hashSenha, ...dadosPublicos } = usuario;
  return dadosPublicos;
}

export class ServicoAutenticacaoPrisma {
  constructor(
    private readonly repositorio: RepositorioUsuarioPrisma = new RepositorioUsuarioPrisma(),
    private readonly journal?: RepositorioJournalPrisma,
    private readonly transacionar?: <T>(operacao: (tx: Prisma.TransactionClient) => Promise<T>) => Promise<T>
  ) {}

  private executarEscrita<T>(operacao: (
    repositorio: RepositorioUsuarioPrisma, journal?: RepositorioJournalPrisma
  ) => Promise<T>): Promise<T> {
    if (this.transacionar) {
      return this.transacionar((tx) => operacao(
        new RepositorioUsuarioPrisma(tx), new RepositorioJournalPrisma(tx)
      ));
    }
    return operacao(this.repositorio, this.journal);
  }

  public async autenticar(usuario: string, senha: string): Promise<UsuarioPublico | null> {
    if (!usuario.trim() || !senha) return null;

    const encontrado = await this.repositorio.buscarPorNome(usuario.trim());
    if (!encontrado || !encontrado.ativo) return null;
    if (!(await HashSenhaScrypt.verificar(senha, encontrado.hashSenha))) return null;

    const ultimoAcesso = new Date();
    const acessoRegistrado = await this.repositorio.registrarAcesso(encontrado.id, encontrado.versao, ultimoAcesso);
    if (!acessoRegistrado) return null;
    return semHashSenha({ ...encontrado, ultimoAcesso });
  }

  public async cadastrarUsuario(
    usuario: string,
    senha: string,
    papel: PapelUsuario,
    criadoPorId?: string
  ): Promise<UsuarioPublico> {
    const nomeNormalizado = usuario.trim();
    this.validarNomeUsuario(nomeNormalizado);
    this.validarSenha(senha);

    try {
      const hashSenha = await HashSenhaScrypt.gerar(senha);
      const criado = await this.executarEscrita(async (repositorio, journal) => {
        if (criadoPorId) {
          const criador = await repositorio.buscarPorId(criadoPorId);
          if (!criador?.ativo) throw new Error("O usuario responsavel pelo cadastro nao esta ativo.");
          if (criador.papel !== PapelUsuario.ADMINISTRADOR) throw new ErroPapelUsuarioNaoPermitido();
        }
        const novo = await repositorio.criar({
          usuario: nomeNormalizado,
          hashSenha,
          papel,
          ...(criadoPorId ? { criadoPor: { connect: { id: criadoPorId } } } : {})
        });
        await journal?.registrar({
          operacao: "CRIAR_USUARIO", entidade: "Usuario",
          dadosDepois: { id: novo.id, usuario: novo.usuario, papel: novo.papel, criadoPorId: novo.criadoPorId },
          usuarioResponsavel: criadoPorId ?? "provisionamento"
        });
        return novo;
      });
      return semHashSenha(criado)!;
    } catch (erro) {
      if (erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === "P2002") {
        throw new Error("Já existe um usuário com esse nome.");
      }
      throw erro;
    }
  }

  public async listarUsuarios(criadoPorId?: string): Promise<UsuarioPublico[]> {
    const usuarios = await this.repositorio.listar(criadoPorId);
    return usuarios.map((usuario) => semHashSenha(usuario)!);
  }

  public async buscarUsuario(id: string, criadoPorId?: string): Promise<UsuarioPublico | null> {
    const usuario = await this.repositorio.buscarPorId(id);
    if (!usuario || (criadoPorId && usuario.criadoPorId !== criadoPorId)) return null;
    return semHashSenha(usuario);
  }

  public async atualizarUsuario(
    id: string, dados: { usuario: string; papel: PapelUsuario }, versaoEsperada: number, usuarioResponsavel = "sistema"
  ): Promise<UsuarioPublico> {
    validarVersaoEsperada(versaoEsperada);
    const nomeNormalizado = dados.usuario.trim();
    this.validarNomeUsuario(nomeNormalizado);
    if (!Object.values(PapelUsuario).includes(dados.papel)) throw new Error("Papel de usuario invalido.");

    const atualizado = await this.executarEscrita(async (repositorio, journal) => {
      const atual = await repositorio.buscarPorId(id);
      if (!atual) throw new Error("Usuário não encontrado.");
      if (atual.versao !== versaoEsperada) throw new ErroConflitoVersao();
      const nomeExistente = await repositorio.buscarPorNome(nomeNormalizado);
      if (nomeExistente && nomeExistente.id !== id) throw new Error("Já existe um usuário com esse nome.");
      const alteracao = await repositorio.atualizarSeVersao(id, versaoEsperada, {
        usuario: nomeNormalizado, papel: dados.papel, versao: { increment: 1 }
      });
      if (alteracao.count === 0) throw new ErroConflitoVersao();
      const novo = await repositorio.buscarPorId(id);
      if (!novo) throw new Error("Usuário não encontrado.");
      await journal?.registrar({
        operacao: "ATUALIZAR_USUARIO", entidade: "Usuario",
        dadosAntes: { id, usuario: atual.usuario, papel: atual.papel },
        dadosDepois: { id, usuario: novo.usuario, papel: novo.papel, versao: novo.versao },
        usuarioResponsavel
      });
      return novo;
    });
    return semHashSenha(atualizado)!;
  }

  public async desativarUsuario(id: string, versaoEsperada: number, usuarioResponsavel = "sistema"): Promise<UsuarioPublico> {
    validarVersaoEsperada(versaoEsperada);
    const desativado = await this.executarEscrita(async (repositorio, journal) => {
      const usuario = await repositorio.buscarPorId(id);
      if (!usuario) throw new Error("Usuário não encontrado.");
      if (usuario.versao !== versaoEsperada) throw new ErroConflitoVersao();
      if (!usuario.ativo) return usuario;
      const resultado = await repositorio.atualizarSeVersao(id, versaoEsperada, {
        ativo: false, versao: { increment: 1 }
      });
      if (resultado.count === 0) throw new ErroConflitoVersao();
      const novo = await repositorio.buscarPorId(id);
      if (!novo) throw new Error("Usuário não encontrado.");
      await journal?.registrar({
        operacao: "DESATIVAR_USUARIO", entidade: "Usuario",
        dadosAntes: { id, ativo: usuario.ativo, versao: usuario.versao },
        dadosDepois: { id, ativo: novo.ativo, versao: novo.versao },
        usuarioResponsavel
      });
      return novo;
    });
    return semHashSenha(desativado)!;
  }

  public async alterarSenha(id: string, versaoEsperada: number, senhaAtual: string, senhaNova: string): Promise<boolean> {
    validarVersaoEsperada(versaoEsperada);
    const usuario = await this.repositorio.buscarPorId(id);
    if (!usuario || !usuario.ativo || !(await HashSenhaScrypt.verificar(senhaAtual, usuario.hashSenha))) {
      return false;
    }

    if (usuario.versao !== versaoEsperada) throw new ErroConflitoVersao();
    this.validarSenha(senhaNova);
    const hashSenha = await HashSenhaScrypt.gerar(senhaNova);
    return this.executarEscrita(async (repositorio, journal) => {
      const atual = await repositorio.buscarPorId(id);
      if (!atual || !atual.ativo) return false;
      if (atual.versao !== versaoEsperada) throw new ErroConflitoVersao();
      const resultado = await repositorio.atualizarSeVersao(id, versaoEsperada, {
        hashSenha, versao: { increment: 1 }
      });
      if (resultado.count === 0) throw new ErroConflitoVersao();
      await journal?.registrar({
        operacao: "ALTERAR_SENHA_USUARIO", entidade: "Usuario",
        dadosAntes: { id, versao: atual.versao }, dadosDepois: { id, versao: atual.versao + 1 },
        usuarioResponsavel: id
      });
      return true;
    });
  }

  private validarNomeUsuario(usuario: string): void {
    if (usuario.length < TAMANHO_MINIMO_USUARIO || usuario.length > TAMANHO_MAXIMO_USUARIO) {
      throw new Error(`O nome de usuário deve ter entre ${TAMANHO_MINIMO_USUARIO} e ${TAMANHO_MAXIMO_USUARIO} caracteres.`);
    }
  }

  private validarSenha(senha: string): void {
    if (Buffer.byteLength(senha, "utf8") < TAMANHO_MINIMO_SENHA) {
      throw new Error(`A senha deve ter pelo menos ${TAMANHO_MINIMO_SENHA} bytes.`);
    }
  }
}
