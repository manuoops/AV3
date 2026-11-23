import { Prisma, TipoResultadoAnalitico } from "@prisma/client";
import { executarTransacao } from "../infra/TransacaoPrisma";
import { prisma } from "../infra/PrismaClient";
import { PrismaExecutor } from "../infra/repositories/PrismaExecutor";
import { RepositorioEquipamentoPrisma } from "../infra/repositories/RepositorioEquipamentoPrisma";
import { RepositorioJournalPrisma } from "../infra/repositories/RepositorioJournalPrisma";
import { RepositorioRecuperacaoEquipamentoPrisma } from "../infra/repositories/RepositorioRecuperacaoEquipamentoPrisma";
import { RepositorioResultadoAnaliticoPrisma } from "../infra/repositories/RepositorioResultadoAnaliticoPrisma";
import { calcularMedia } from "./Estatistica";
import { PeriodoAnalise } from "./ServicoAnaliseEficienciaPrisma";

type Transacionador = <T>(operacao: (tx: Prisma.TransactionClient) => Promise<T>) => Promise<T>;

function arredondar(valor: number): number {
  return Number(valor.toFixed(2));
}

function validarPeriodo(periodo?: PeriodoAnalise): void {
  if (!periodo) return;
  if (!Number.isFinite(periodo.inicio.getTime()) || !Number.isFinite(periodo.fim.getTime())) {
    throw new Error("O periodo da analise contem uma data invalida.");
  }
  if (periodo.inicio.getTime() > periodo.fim.getTime()) {
    throw new Error("O inicio do periodo nao pode ser posterior ao fim.");
  }
}

function agruparMedia<T>(
  itens: readonly T[],
  chave: (item: T) => string,
  valor: (item: T) => number
): Array<{ grupo: string; amostras: number; valorMedio: number }> {
  const grupos = new Map<string, number[]>();
  for (const item of itens) {
    const nome = chave(item);
    const valores = grupos.get(nome) ?? [];
    valores.push(valor(item));
    grupos.set(nome, valores);
  }
  return [...grupos.entries()].map(([grupo, valores]) => ({
    grupo,
    amostras: valores.length,
    valorMedio: arredondar(calcularMedia(valores) ?? 0)
  })).sort((a, b) => b.valorMedio - a.valorMedio);
}

export class ServicoAnaliseRentabilidadePrisma {
  constructor(
    private readonly transacionar: Transacionador = executarTransacao,
    private readonly db: PrismaExecutor = prisma
  ) {}

  public async listarValoresRecuperados(equipamentoId: string, skip = 0, take = 100) {
    if (!Number.isInteger(skip) || skip < 0 || !Number.isInteger(take) || take < 1 || take > 500) {
      throw new Error("Paginacao invalida: skip deve ser >= 0 e take deve estar entre 1 e 500.");
    }
    if (!await new RepositorioEquipamentoPrisma(this.db).buscarPorId(equipamentoId)) {
      throw new Error(`Equipamento '${equipamentoId}' nao encontrado.`);
    }
    return new RepositorioRecuperacaoEquipamentoPrisma(this.db).listarPorEquipamento(equipamentoId, skip, take);
  }

  public async registrarValorRecuperado(
    equipamentoId: string,
    valorRecuperado: number,
    usuarioResponsavel: string,
    observacao = ""
  ) {
    if (!equipamentoId.trim()) throw new Error("equipamentoId e obrigatorio.");
    if (!Number.isFinite(valorRecuperado) || valorRecuperado < 0) {
      throw new Error("valorRecuperado deve ser um numero finito maior ou igual a zero.");
    }
    if (!usuarioResponsavel.trim()) throw new Error("usuarioResponsavel e obrigatorio.");

    return this.transacionar(async (tx) => {
      const equipamento = await new RepositorioEquipamentoPrisma(tx).buscarPorId(equipamentoId);
      if (!equipamento) throw new Error(`Equipamento '${equipamentoId}' nao encontrado.`);

      const recuperacoes = new RepositorioRecuperacaoEquipamentoPrisma(tx);
      const antes = await recuperacoes.buscarPorEquipamento(equipamentoId);
      const valor = new Prisma.Decimal(valorRecuperado.toFixed(2));
      const salvo = await recuperacoes.salvar(equipamentoId, {
        valorRecuperado: valor,
        estadoFisico: equipamento.estadoFisico,
        avaliadoEm: new Date(),
        registradoPor: usuarioResponsavel.trim(),
        observacao: observacao.trim()
      });
      await new RepositorioJournalPrisma(tx).registrar({
        operacao: "REGISTRAR_VALOR_RECUPERACAO",
        entidade: "Equipamento",
        dadosAntes: antes ? {
          equipamentoId,
          valorRecuperado: antes.valorRecuperado.toString(),
          avaliadoEm: antes.avaliadoEm.toISOString()
        } : {},
        dadosDepois: {
          equipamentoId,
          valorRecuperado: salvo.valorRecuperado.toString(),
          avaliadoEm: salvo.avaliadoEm.toISOString()
        },
        usuarioResponsavel: usuarioResponsavel.trim()
      });
      return salvo;
    });
  }

  public async gerar(periodo: PeriodoAnalise | undefined, usuarioId?: string, organizacaoId?: string, tarefaId?: string) {
    validarPeriodo(periodo);
    const valores = await new RepositorioRecuperacaoEquipamentoPrisma(this.db)
      .listarPorPeriodo(periodo?.inicio, periodo?.fim, organizacaoId);
    const valoresNumericos = valores.map((registro) => ({
      equipamentoId: registro.equipamentoId,
      valor: registro.valorRecuperado.toNumber(),
      tipo: registro.equipamento.tipo,
      estadoFisico: registro.estadoFisico,
      marca: registro.equipamento.marca,
      modelo: registro.equipamento.modelo,
      avaliadoEm: registro.avaliadoEm.toISOString()
    }));

    const porTipo = agruparMedia(valoresNumericos, (item) => item.tipo, (item) => item.valor);
    const porEstadoFisico = agruparMedia(valoresNumericos, (item) => item.estadoFisico, (item) => item.valor);
    const porMarcaModeloEstado = agruparMedia(
      valoresNumericos,
      (item) => `${item.marca} ${item.modelo} | ${item.estadoFisico}`,
      (item) => item.valor
    );

    const todosEquipamentos = await new RepositorioEquipamentoPrisma(this.db)
      .listarParaAnalise(undefined, organizacaoId);
    const equipamentosComValor = new Set(valores.map(({ equipamentoId }) => equipamentoId));
    const valoresPorPerfil = new Map<string, number[]>();
    for (const item of valoresNumericos) {
      const chave = this.chavePerfil(item.tipo, item.marca, item.modelo, item.estadoFisico);
      const lista = valoresPorPerfil.get(chave) ?? [];
      lista.push(item.valor);
      valoresPorPerfil.set(chave, lista);
    }

    const estimativas = todosEquipamentos
      .filter((equipamento) => !equipamentosComValor.has(equipamento.id))
      .flatMap((equipamento) => {
        const amostras = valoresPorPerfil.get(this.chavePerfil(
          equipamento.tipo, equipamento.marca, equipamento.modelo, equipamento.estadoFisico
        ));
        const media = amostras ? calcularMedia(amostras) : null;
        if (!amostras || media === null) return [];
        return [{
          equipamentoId: equipamento.id,
          tipo: equipamento.tipo,
          marca: equipamento.marca,
          modelo: equipamento.modelo,
          estadoFisico: equipamento.estadoFisico,
          valorEstimado: arredondar(media),
          equipamentosComparaveisComValorReal: amostras.length
        }];
      })
      .sort((a, b) => b.valorEstimado - a.valorEstimado);

    const periodoSerializado = periodo
      ? { inicio: periodo.inicio.toISOString(), fim: periodo.fim.toISOString() }
      : null;
    const resultado = {
      periodo: periodoSerializado,
      equipamentosComValorReal: valores.length,
      valorMedioRecuperado: calcularMedia(valoresNumericos.map(({ valor }) => valor)),
      porTipo,
      porEstadoFisico,
      porMarcaModeloEstado,
      maioresValoresObservados: [...valoresNumericos]
        .sort((a, b) => b.valor - a.valor)
        .slice(0, 10),
      estimativasPorPerfilComparavel: estimativas,
      semDados: valoresNumericos.length === 0,
      limitacoes: [
        "Somente valores reais registrados por equipamento entram nas medias.",
        "Uma estimativa so e apresentada quando existe ao menos um equipamento do mesmo tipo, marca, modelo e estado fisico com valor real registrado.",
        "A quantidade de amostras acompanha cada estimativa para deixar visivel a base usada."
      ]
    };

    return new RepositorioResultadoAnaliticoPrisma(this.db).salvar({
      tipo: TipoResultadoAnalitico.RENTABILIDADE_EQUIPAMENTO,
      ...(periodo ? { periodoInicio: periodo.inicio, periodoFim: periodo.fim } : {}),
      filtros: { periodo: periodoSerializado },
      resultado: resultado as Prisma.InputJsonValue,
      ...(usuarioId ? { usuarioId } : {})
    }, tarefaId);
  }

  private chavePerfil(tipo: string, marca: string, modelo: string, estadoFisico: string): string {
    return [tipo, marca.trim().toLocaleLowerCase(), modelo.trim().toLocaleLowerCase(), estadoFisico].join("|");
  }
}
