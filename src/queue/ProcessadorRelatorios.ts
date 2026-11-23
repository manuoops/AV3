import { mkdir, rename, unlink, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { ResultadoAnalitico } from "@prisma/client";
import { ServicoAnaliseEficienciaPrisma } from "../analytics/ServicoAnaliseEficienciaPrisma";
import { ServicoAnaliseRentabilidadePrisma } from "../analytics/ServicoAnaliseRentabilidadePrisma";
import { ServicoAnaliseVidaUtilPrisma } from "../analytics/ServicoAnaliseVidaUtilPrisma";
import { JobRelatorio } from "./WorkerRelatorios";
import { DadosTarefaRelatorio } from "./FilaRelatorios";
import { obterCaminhoArquivoRelatorio, obterDiretorioRelatorios } from "./ArmazenamentoRelatorios";

export interface ServicosProcessamentoRelatorios {
  eficiencia: Pick<ServicoAnaliseEficienciaPrisma, "gerar">;
  rentabilidade: Pick<ServicoAnaliseRentabilidadePrisma, "gerar">;
  vidaUtil: Pick<ServicoAnaliseVidaUtilPrisma, "gerar">;
}

export interface ResultadoProcessamentoRelatorio {
  resultadoAnaliticoId: string;
  arquivo: string;
  tipo: ResultadoAnalitico["tipo"];
}

function criarServicosPadrao(): ServicosProcessamentoRelatorios {
  return {
    eficiencia: new ServicoAnaliseEficienciaPrisma(),
    rentabilidade: new ServicoAnaliseRentabilidadePrisma(),
    vidaUtil: new ServicoAnaliseVidaUtilPrisma()
  };
}

function converterPeriodo(periodo?: DadosTarefaRelatorio["periodo"]) {
  if (!periodo) return undefined;
  return { inicio: new Date(periodo.inicio), fim: new Date(periodo.fim) };
}

export function criarProcessadorRelatorios(
  servicos: ServicosProcessamentoRelatorios = criarServicosPadrao(),
  diretorioSaida = process.env.REPORTS_DIRECTORY?.trim() || join("data", "relatorios-analiticos")
) {
  const caminhoSaida = obterDiretorioRelatorios(diretorioSaida);

  return async (job: JobRelatorio): Promise<ResultadoProcessamentoRelatorio> => {
    const { data } = job;
    if (!job.id || !/^[0-9a-f-]{36}$/i.test(job.id)) {
      throw new Error("A tarefa de relatorio precisa ter um ID UUID valido.");
    }
    if (!data.organizacaoId || !data.apiKeyId) {
      throw new Error("A tarefa de relatorio nao possui o escopo da API Key.");
    }

    await job.updateProgress(10);
    let relatorio: ResultadoAnalitico;
    switch (data.tipo) {
      case "EFICIENCIA_OPERACIONAL": {
        const periodo = converterPeriodo(data.periodo);
        if (!periodo) throw new Error("periodo e obrigatorio para eficiencia operacional.");
        relatorio = await servicos.eficiencia.gerar(
          periodo,
          undefined,
          converterPeriodo(data.periodoComparacao),
          data.organizacaoId,
          job.id
        );
        break;
      }
      case "RENTABILIDADE_EQUIPAMENTO":
        relatorio = await servicos.rentabilidade.gerar(
          converterPeriodo(data.periodo),
          undefined,
          data.organizacaoId,
          job.id
        );
        break;
      case "VIDA_UTIL_PREDITIVA":
        relatorio = await servicos.vidaUtil.gerar(undefined, data.tipoEquipamento, data.organizacaoId, job.id);
        break;
      default:
        throw new Error("tipo de relatorio analitico invalido.");
    }

    await job.updateProgress(80);
    await mkdir(caminhoSaida, { recursive: true });
    const arquivo = `${job.id}.json`;
    const caminhoFinal = obterCaminhoArquivoRelatorio(job.id, caminhoSaida);
    const caminhoTemporario = `${caminhoFinal}.tmp-${randomUUID()}`;
    const conteudo = {
      tarefaId: job.id,
      resultadoAnaliticoId: relatorio.id,
      tipo: relatorio.tipo,
      geradoEm: relatorio.geradoEm,
      periodoInicio: relatorio.periodoInicio,
      periodoFim: relatorio.periodoFim,
      filtros: relatorio.filtros,
      resultado: relatorio.resultado
    };

    try {
      await writeFile(caminhoTemporario, JSON.stringify(conteudo, null, 2), { encoding: "utf8", flag: "wx" });
      await rename(caminhoTemporario, caminhoFinal);
    } catch (erro) {
      await unlink(caminhoTemporario).catch(() => undefined);
      throw erro;
    }

    await job.updateProgress(100);
    return { resultadoAnaliticoId: relatorio.id, arquivo, tipo: relatorio.tipo };
  };
}
