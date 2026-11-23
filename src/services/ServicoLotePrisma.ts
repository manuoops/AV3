import { Prisma, StatusLote, StatusRastreamento } from "@prisma/client";
import { ValidadorDataEntrada } from "../validators/ValidadorDataEntrada";
import { executarTransacao } from "../infra/TransacaoPrisma";
import { prisma } from "../infra/PrismaClient";
import { RepositorioJournalPrisma } from "../infra/repositories/RepositorioJournalPrisma";
import { RepositorioEquipamentoPrisma } from "../infra/repositories/RepositorioEquipamentoPrisma";
import { RepositorioLotePrisma } from "../infra/repositories/RepositorioLotePrisma";
import { RepositorioOrganizacaoPrisma } from "../infra/repositories/RepositorioOrganizacaoPrisma";
import { PrismaExecutor } from "../infra/repositories/PrismaExecutor";
import { ErroConflitoVersao, ErroEstadoRecurso, validarVersaoEsperada } from "./ErrosServico";

type Transacionador = <T>(operacao: (tx: Prisma.TransactionClient) => Promise<T>) => Promise<T>;

export interface DadosNovoLote {
  dataEntrada: Date;
  organizacaoId: string;
  notaFiscal: string;
  transportadora: string;
  observacoes?: string;
}

const ORDEM_STATUS_RASTREAMENTO: Record<StatusRastreamento, number> = {
  AGUARDANDO_TRIAGEM: 0,
  EM_TRIAGEM: 1,
  AGUARDANDO_DESMONTE: 2,
  EM_DESMONTE: 3,
  PECAS_REAPROVEITADAS: 4,
  MATERIAL_RECICLAVEL: 4,
  DESCARTE_SEGURO: 4,
  BAIXA_DEFINITIVA: 5
};

export class ServicoLotePrisma {
  constructor(
    private readonly transacionar: Transacionador = executarTransacao,
    private readonly db: PrismaExecutor = prisma
  ) {}

  public async criarLote(dados: DadosNovoLote, usuarioResponsavel: string) {
    if (!(dados.dataEntrada instanceof Date) || !Number.isFinite(dados.dataEntrada.getTime())) {
      throw new Error("dataEntrada deve ser uma data valida.");
    }
    const validadorData = new ValidadorDataEntrada();
    if (!validadorData.validar(dados.dataEntrada)) {
      throw new Error(validadorData.obterMensagemErro());
    }
    const notaFiscal = dados.notaFiscal.trim();
    const transportadora = dados.transportadora.trim();
    if (!dados.organizacaoId.trim()) throw new Error("organizacaoId e obrigatorio.");
    if (!notaFiscal) throw new Error("notaFiscal e obrigatoria.");
    if (!transportadora) throw new Error("transportadora e obrigatoria.");

    return this.transacionar(async (tx) => {
      const organizacao = await new RepositorioOrganizacaoPrisma(tx).buscarPorId(dados.organizacaoId);
      if (!organizacao || !organizacao.ativo) {
        throw new Error(`Organizacao '${dados.organizacaoId}' nao encontrada ou inativa.`);
      }

      const lote = await new RepositorioLotePrisma(tx).criar({
        dataEntrada: dados.dataEntrada,
        organizacaoId: dados.organizacaoId,
        notaFiscal,
        transportadora,
        observacoes: dados.observacoes?.trim() ?? ""
      });
      await new RepositorioJournalPrisma(tx).registrar({
        operacao: "CRIAR_LOTE",
        entidade: "Lote",
        dadosDepois: {
          id: lote.id,
          organizacaoId: lote.organizacaoId,
          notaFiscal: lote.notaFiscal,
          dataEntrada: lote.dataEntrada.toISOString()
        },
        usuarioResponsavel
      });
      return lote;
    });
  }

  public buscarLote(id: string) {
    return new RepositorioLotePrisma(this.db).buscarPorId(id);
  }

  public async consultarLotePorPeriodo(dataInicio: Date, dataFim: Date, skip = 0, take = 100) {
    if (!Number.isFinite(dataInicio.getTime()) || !Number.isFinite(dataFim.getTime())) {
      throw new Error("O periodo informado contem uma data invalida.");
    }
    if (dataInicio.getTime() > dataFim.getTime()) {
      throw new Error("dataInicio nao pode ser posterior a dataFim.");
    }
    if (!Number.isInteger(skip) || skip < 0 || !Number.isInteger(take) || take < 1 || take > 500) {
      throw new Error("Paginacao invalida: skip deve ser >= 0 e take deve estar entre 1 e 500.");
    }
    return new RepositorioLotePrisma(this.db).listarPorPeriodo(dataInicio, dataFim, skip, take);
  }

  public async consultarLotesDaOrganizacao(
    organizacaoId: string,
    dataInicio: Date,
    dataFim: Date,
    skip = 0,
    take = 100
  ) {
    if (!organizacaoId.trim()) throw new Error("organizacaoId e obrigatorio.");
    if (!Number.isFinite(dataInicio.getTime()) || !Number.isFinite(dataFim.getTime())) {
      throw new Error("O periodo informado contem uma data invalida.");
    }
    if (dataInicio.getTime() > dataFim.getTime()) {
      throw new Error("dataInicio nao pode ser posterior a dataFim.");
    }
    if (!Number.isInteger(skip) || skip < 0 || !Number.isInteger(take) || take < 1 || take > 500) {
      throw new Error("Paginacao invalida: skip deve ser >= 0 e take deve estar entre 1 e 500.");
    }
    return new RepositorioLotePrisma(this.db).listarPorOrganizacaoEPeriodo(
      organizacaoId, dataInicio, dataFim, skip, take
    );
  }

  public listarLotes(filtros: {
    organizacaoId?: string; dataInicio?: Date; dataFim?: Date; statusProcessamento?: StatusLote;
    skip?: number; take?: number;
  } = {}) {
    if (filtros.dataInicio && !Number.isFinite(filtros.dataInicio.getTime())) throw new Error("dataInicio invalida.");
    if (filtros.dataFim && !Number.isFinite(filtros.dataFim.getTime())) throw new Error("dataFim invalida.");
    if (filtros.dataInicio && filtros.dataFim && filtros.dataInicio > filtros.dataFim) {
      throw new Error("dataInicio nao pode ser posterior a dataFim.");
    }
    const skip = filtros.skip ?? 0;
    const take = filtros.take ?? 100;
    if (!Number.isInteger(skip) || skip < 0 || !Number.isInteger(take) || take < 1 || take > 500) {
      throw new Error("Paginacao invalida: skip deve ser >= 0 e take deve estar entre 1 e 500.");
    }
    return new RepositorioLotePrisma(this.db).listar({ ...filtros, skip, take });
  }

  public async atualizarLote(
    id: string, dados: Pick<DadosNovoLote, "dataEntrada" | "notaFiscal" | "transportadora" | "observacoes">,
    versaoEsperada: number, usuarioResponsavel: string
  ) {
    validarVersaoEsperada(versaoEsperada);
    if (!(dados.dataEntrada instanceof Date) || !Number.isFinite(dados.dataEntrada.getTime())) {
      throw new Error("dataEntrada deve ser uma data valida.");
    }
    if (!new ValidadorDataEntrada().validar(dados.dataEntrada)) throw new Error(new ValidadorDataEntrada().obterMensagemErro());
    const notaFiscal = dados.notaFiscal.trim();
    const transportadora = dados.transportadora.trim();
    if (!notaFiscal || !transportadora) throw new Error("notaFiscal e transportadora sao obrigatorias.");

    return this.transacionar(async (tx) => {
      const lotes = new RepositorioLotePrisma(tx);
      const atual = await lotes.buscarPorId(id);
      if (!atual) throw new Error(`Lote '${id}' nao encontrado.`);
      if (atual.versao !== versaoEsperada) throw new ErroConflitoVersao();
      if (atual.statusProcessamento !== StatusLote.RECEBIDO) {
        throw new ErroEstadoRecurso("Somente lotes ainda recebidos podem ser editados.");
      }
      const atualizacao = await lotes.atualizarSeVersao(id, versaoEsperada, {
        dataEntrada: dados.dataEntrada, notaFiscal, transportadora,
        observacoes: dados.observacoes?.trim() ?? "", versao: { increment: 1 }
      });
      if (atualizacao.count === 0) throw new ErroConflitoVersao();
      const novo = await lotes.buscarPorId(id);
      if (!novo) throw new Error(`Lote '${id}' nao encontrado.`);
      await new RepositorioJournalPrisma(tx).registrar({
        operacao: "ATUALIZAR_LOTE", entidade: "Lote",
        dadosAntes: { id, dataEntrada: atual.dataEntrada.toISOString(), notaFiscal: atual.notaFiscal,
          transportadora: atual.transportadora, observacoes: atual.observacoes },
        dadosDepois: { id, dataEntrada: novo.dataEntrada.toISOString(), notaFiscal: novo.notaFiscal,
          transportadora: novo.transportadora, observacoes: novo.observacoes },
        usuarioResponsavel
      });
      return novo;
    });
  }

  public async excluirLote(id: string, versaoEsperada: number, usuarioResponsavel: string) {
    validarVersaoEsperada(versaoEsperada);
    return this.transacionar(async (tx) => {
      await tx.$queryRaw<Array<{ locked: boolean }>>`
        SELECT pg_advisory_xact_lock(hashtext(${`greencode:lote:${id}`})) IS NULL AS locked
      `;
      const lotes = new RepositorioLotePrisma(tx);
      const atual = await lotes.buscarPorId(id);
      if (!atual) throw new Error(`Lote '${id}' nao encontrado.`);
      if (atual.versao !== versaoEsperada) throw new ErroConflitoVersao();
      if (atual.statusProcessamento !== StatusLote.RECEBIDO) {
        throw new ErroEstadoRecurso("Somente lotes ainda recebidos podem ser excluidos.");
      }
      if (atual.equipamentos.length) throw new ErroEstadoRecurso("Nao e possivel excluir um lote que possui equipamentos.");
      const removido = await lotes.excluirSeVersao(id, versaoEsperada);
      if (removido.count === 0) throw new ErroConflitoVersao();
      await new RepositorioJournalPrisma(tx).registrar({
        operacao: "EXCLUIR_LOTE", entidade: "Lote",
        dadosAntes: { id, organizacaoId: atual.organizacaoId, notaFiscal: atual.notaFiscal },
        dadosDepois: { id, excluido: true }, usuarioResponsavel
      });
      return { id, excluido: true };
    });
  }

  public async processarTriagem(loteId: string, versaoEsperada: number, usuarioResponsavel: string) {
    validarVersaoEsperada(versaoEsperada);
    return this.transacionar(async (tx) => {
      const lotes = new RepositorioLotePrisma(tx);
      const lote = await lotes.buscarPorId(loteId);
      if (!lote) throw new Error(`Lote '${loteId}' nao encontrado.`);
      if (lote.versao !== versaoEsperada) throw new ErroConflitoVersao();

      if (lote.statusProcessamento === StatusLote.RECEBIDO) {
        if (lote.equipamentos.length === 0) {
          throw new Error("Lote nao possui equipamentos cadastrados; nao e possivel iniciar a triagem.");
        }

        const resultadoLote = await lotes.atualizarSeVersao(loteId, versaoEsperada, {
          statusProcessamento: StatusLote.EM_TRIAGEM,
          versao: { increment: 1 }
        });
        if (resultadoLote.count === 0) throw new ErroConflitoVersao();

        const equipamentosRepo = new RepositorioEquipamentoPrisma(tx);
        let equipamentosAtualizados = 0;
        for (const equipamento of lote.equipamentos) {
          if (equipamento.statusRastreamento !== StatusRastreamento.AGUARDANDO_TRIAGEM) continue;
          const resultado = await equipamentosRepo.atualizarSeVersao(equipamento.id, equipamento.versao, {
            statusRastreamento: StatusRastreamento.EM_TRIAGEM,
            versao: { increment: 1 }
          });
          if (resultado.count === 0) throw new ErroConflitoVersao();
          equipamentosAtualizados += resultado.count;
        }
        const atualizado = await lotes.buscarPorId(loteId);
        if (!atualizado) throw new Error(`Lote '${loteId}' nao encontrado.`);
        await new RepositorioJournalPrisma(tx).registrar({
          operacao: "INICIAR_TRIAGEM_LOTE",
          entidade: "Lote",
          dadosAntes: { id: loteId, statusProcessamento: lote.statusProcessamento },
          dadosDepois: {
            id: loteId,
            statusProcessamento: atualizado.statusProcessamento,
            equipamentosAtualizados
          },
          usuarioResponsavel
        });
        return lotes.buscarPorId(loteId);
      }

      if (lote.statusProcessamento === StatusLote.EM_TRIAGEM) {
        const pendentes = lote.equipamentos.filter(
          (equipamento) => ORDEM_STATUS_RASTREAMENTO[equipamento.statusRastreamento] <=
            ORDEM_STATUS_RASTREAMENTO[StatusRastreamento.EM_TRIAGEM]
        );
        if (pendentes.length > 0) {
          throw new Error("Ainda ha equipamentos aguardando triagem individual neste lote.");
        }

        const resultado = await lotes.atualizarSeVersao(loteId, versaoEsperada, {
          statusProcessamento: StatusLote.TRIAGEM_CONCLUIDA,
          versao: { increment: 1 }
        });
        if (resultado.count === 0) throw new ErroConflitoVersao();
        const atualizado = await lotes.buscarPorId(loteId);
        if (!atualizado) throw new Error(`Lote '${loteId}' nao encontrado.`);
        await new RepositorioJournalPrisma(tx).registrar({
          operacao: "CONCLUIR_TRIAGEM_LOTE",
          entidade: "Lote",
          dadosAntes: { id: loteId, statusProcessamento: lote.statusProcessamento },
          dadosDepois: { id: loteId, statusProcessamento: atualizado.statusProcessamento },
          usuarioResponsavel
        });
        return lotes.buscarPorId(loteId);
      }

      throw new Error(
        `Lote esta em status '${lote.statusProcessamento}', que nao pode avancar por processarTriagem.`
      );
    });
  }

  public async gerarRelatorioTriagem(loteId: string): Promise<string> {
    const lote = await this.buscarLote(loteId);
    if (!lote) throw new Error(`Lote '${loteId}' nao encontrado.`);
    const pesoTotal = lote.equipamentos.reduce((total, equipamento) => total + equipamento.pesoQuilogramas, 0);
    return [
      `Relatorio de triagem do lote ${lote.id}`,
      `Nota fiscal: ${lote.notaFiscal}`,
      `Transportadora: ${lote.transportadora}`,
      `Data de entrada: ${lote.dataEntrada.toISOString().slice(0, 10)}`,
      `Status: ${lote.statusProcessamento}`,
      `Quantidade de equipamentos: ${lote.equipamentos.length}`,
      `Peso total: ${pesoTotal.toFixed(2)} kg`,
      `Observacoes: ${lote.observacoes || "(nenhuma)"}`
    ].join("\n");
  }

  public async validarLoteParaReceberEquipamento(loteId: string): Promise<void> {
    const lote = await this.buscarLote(loteId);
    if (!lote) throw new Error(`Lote '${loteId}' nao encontrado.`);
    if (lote.statusProcessamento === StatusLote.FINALIZADO) {
      throw new Error("Nao e possivel adicionar equipamento em um lote ja finalizado.");
    }
  }
}
