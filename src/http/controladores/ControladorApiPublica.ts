import { FastifyInstance } from "fastify";
import { randomUUID } from "crypto";
import { access, readFile } from "node:fs/promises";
import { Job, Queue } from "bullmq";
import { PermissaoChaveApi, TipoEquipamento, TipoResultadoAnalitico } from "@prisma/client";
import { DadosTarefaRelatorio, NOME_JOB_RELATORIO_ANALITICO } from "../../queue/FilaRelatorios";
import { obterCaminhoArquivoRelatorio } from "../../queue/ArmazenamentoRelatorios";
import { ServicoEquipamentoPrisma } from "../../services/ServicoEquipamentoPrisma";
import { ServicoLotePrisma } from "../../services/ServicoLotePrisma";
import { HooksApiKey } from "../AutenticacaoApiKey";

interface PeriodoJson {
  inicio: string;
  fim: string;
}

const rateLimitPublico = { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } };

export interface ServicosApiPublica {
  equipamentos: ServicoEquipamentoPrisma;
  lotes: ServicoLotePrisma;
  filaRelatorios: Queue<DadosTarefaRelatorio> | undefined;
}

export function mapearEstadoTarefaRelatorio(estado: string): string {
  switch (estado) {
    case "waiting":
    case "delayed":
    case "paused":
    case "waiting-children":
      return "AGUARDANDO";
    case "active":
      return "EM_PROCESSAMENTO";
    case "completed":
      return "CONCLUIDA";
    case "failed":
      return "FALHOU";
    default:
      return "DESCONHECIDO";
  }
}

async function obterJob( fila: Queue<DadosTarefaRelatorio>, tarefaId: string): Promise<Job<DadosTarefaRelatorio> | undefined> {
  return fila.getJob(tarefaId);
}

export function registrarRotasApiPublica(
  app: FastifyInstance,
  hooks: HooksApiKey,
  servicos: ServicosApiPublica
): void {
  app.get<{ Params: { id: string } }>("/api/v1/public/equipamentos/:id/rastreabilidade", {
    ...rateLimitPublico,
    preHandler: [hooks.autenticar, hooks.exigirPermissao(PermissaoChaveApi.RASTREAR_EQUIPAMENTO)],
    schema: {
      params: {
        type: "object", required: ["id"], additionalProperties: false,
        properties: { id: { type: "string", format: "uuid" } }
      }
    }
  }, async (request) => {
    const historico = await servicos.equipamentos.rastrearEquipamento(request.params.id);
    if (historico.lote.organizacaoId !== request.contextoChaveApi!.organizacaoId) {
      throw new Error(`Equipamento '${request.params.id}' nao encontrado.`);
    }
    return {
      dados: {
        equipamento: historico.equipamento,
        lote: {
          id: historico.lote.id,
          dataEntrada: historico.lote.dataEntrada,
          statusProcessamento: historico.lote.statusProcessamento
        }
      }
    };
  });

  app.get<{ Querystring: { inicio: string; fim: string; skip?: string; take?: string } }>("/api/v1/public/lotes", {
    ...rateLimitPublico,
    preHandler: [hooks.autenticar, hooks.exigirPermissao(PermissaoChaveApi.LER_LOTES)],
    schema: {
      querystring: {
        type: "object", required: ["inicio", "fim"], additionalProperties: false,
        properties: {
          inicio: { type: "string", format: "date-time" }, fim: { type: "string", format: "date-time" },
          skip: { type: "string", pattern: "^[0-9]+$" }, take: { type: "string", pattern: "^[0-9]+$" }
        }
      }
    }
  }, async (request) => ({
    dados: await servicos.lotes.consultarLotesDaOrganizacao(
      request.contextoChaveApi!.organizacaoId,
      new Date(request.query.inicio), new Date(request.query.fim),
      Number(request.query.skip ?? 0), Number(request.query.take ?? 100)
    )
  }));

  app.get<{ Params: { id: string } }>("/api/v1/public/lotes/:id", {
    ...rateLimitPublico,
    preHandler: [hooks.autenticar, hooks.exigirPermissao(PermissaoChaveApi.LER_LOTES)],
    schema: {
      params: {
        type: "object", required: ["id"], additionalProperties: false,
        properties: { id: { type: "string", format: "uuid" } }
      }
    }
  }, async (request) => {
    const lote = await servicos.lotes.buscarLote(request.params.id);
    if (!lote || lote.organizacaoId !== request.contextoChaveApi!.organizacaoId) {
      throw new Error(`Lote '${request.params.id}' nao encontrado.`);
    }
    return { dados: lote };
  });

  app.post<{ Body: { dataEntrada?: string; notaFiscal: string; transportadora: string; observacoes?: string } }>(
    "/api/v1/public/lotes", {
      ...rateLimitPublico,
      preHandler: [hooks.autenticar, hooks.exigirPermissao(PermissaoChaveApi.ESCREVER_LOTES)],
      schema: {
        body: {
          type: "object", required: ["notaFiscal", "transportadora"], additionalProperties: false,
          properties: {
            dataEntrada: { type: "string", format: "date-time" },
            notaFiscal: { type: "string", minLength: 1, maxLength: 100 },
            transportadora: { type: "string", minLength: 1, maxLength: 120 },
            observacoes: { type: "string", maxLength: 1000 }
          }
        }
      }
    }, async (request, reply) => {
      const lote = await servicos.lotes.criarLote({
        ...request.body,
        dataEntrada: request.body.dataEntrada ? new Date(request.body.dataEntrada) : new Date(),
        organizacaoId: request.contextoChaveApi!.organizacaoId
      }, `api-key:${request.contextoChaveApi!.id}`);
      return reply.code(201).send({ dados: lote });
    }
  );

  app.post<{
    Body: {
      tipo: TipoResultadoAnalitico;
      periodo?: PeriodoJson;
      periodoComparacao?: PeriodoJson;
      tipoEquipamento?: TipoEquipamento;
    };
  }>("/api/v1/public/relatorios/analiticos", {
    ...rateLimitPublico,
    preHandler: [hooks.autenticar, hooks.exigirPermissao(PermissaoChaveApi.GERAR_RELATORIOS_ANALITICOS)],
    schema: {
      body: {
        type: "object", required: ["tipo"], additionalProperties: false,
        properties: {
          tipo: { type: "string", enum: Object.values(TipoResultadoAnalitico) },
          periodo: {
            type: "object", required: ["inicio", "fim"], additionalProperties: false,
            properties: { inicio: { type: "string", format: "date-time" }, fim: { type: "string", format: "date-time" } }
          },
          periodoComparacao: {
            type: "object", required: ["inicio", "fim"], additionalProperties: false,
            properties: { inicio: { type: "string", format: "date-time" }, fim: { type: "string", format: "date-time" } }
          },
          tipoEquipamento: { type: "string", enum: Object.values(TipoEquipamento) }
        }
      }
    }
  }, async (request, reply) => {
    if (request.body.tipo === TipoResultadoAnalitico.EFICIENCIA_OPERACIONAL && !request.body.periodo) {
      return reply.code(400).send({ erro: "periodo e obrigatorio para eficiencia operacional." });
    }

    if (!servicos.filaRelatorios) {
      return reply.code(503).send({ erro: "Fila de relatorios indisponivel. Configure REDIS_URL." });
    }

    const contexto = request.contextoChaveApi!;
    const tarefaId = randomUUID();
    const dados: DadosTarefaRelatorio = {
      tipo: request.body.tipo,
      organizacaoId: contexto.organizacaoId,
      apiKeyId: contexto.id,
      ...(request.body.periodo ? { periodo: request.body.periodo } : {}),
      ...(request.body.periodoComparacao ? { periodoComparacao: request.body.periodoComparacao } : {}),
      ...(request.body.tipoEquipamento ? { tipoEquipamento: request.body.tipoEquipamento } : {})
    };

    try {
      const tarefa = await servicos.filaRelatorios.add(NOME_JOB_RELATORIO_ANALITICO, dados, { jobId: tarefaId });
      return reply.code(202).send({
        dados: { tarefaId: tarefa.id, status: "AGUARDANDO" }
      });
    } catch (erro) {
      request.log.error({ err: erro }, "Falha ao publicar tarefa de relatorio na fila.");
      return reply.code(503).send({ erro: "Nao foi possivel enfileirar o relatorio. Tente novamente mais tarde." });
    }
  });

  app.get<{ Params: { tarefaId: string } }>("/api/v1/public/relatorios/analiticos/:tarefaId", {
    ...rateLimitPublico,
    preHandler: [hooks.autenticar, hooks.exigirPermissao(PermissaoChaveApi.GERAR_RELATORIOS_ANALITICOS)],
    schema: {
      params: {
        type: "object", required: ["tarefaId"], additionalProperties: false,
        properties: { tarefaId: { type: "string", format: "uuid" } }
      }
    }
  }, async (request, reply) => {
    const fila = servicos.filaRelatorios;
    if (!fila) return reply.code(503).send({ erro: "Fila de relatorios indisponivel. Configure REDIS_URL." });

    let job: Job<DadosTarefaRelatorio> | undefined;
    try {
      job = await obterJob(fila, request.params.tarefaId);
    } catch (erro) {
      request.log.error({ err: erro }, "Falha ao consultar estado da tarefa de relatorio.");
      return reply.code(503).send({ erro: "Nao foi possivel consultar a tarefa agora." });
    }

    if (!job || job.data.organizacaoId !== request.contextoChaveApi!.organizacaoId) {
      return reply.code(404).send({ erro: "Tarefa de relatorio nao encontrada." });
    }

    try {
      const estado = await job.getState();
      const retorno = job.returnvalue as { resultadoAnaliticoId?: unknown } | null;
      let relatorioDisponivel = false;
      if (estado === "completed") {
        try {
          await access(obterCaminhoArquivoRelatorio(request.params.tarefaId));
          relatorioDisponivel = true;
        } catch (erro) {
          if ((erro as NodeJS.ErrnoException).code !== "ENOENT") throw erro;
        }
      }
      return reply.send({
        dados: {
          tarefaId: job.id,
          status: mapearEstadoTarefaRelatorio(estado),
          progresso: job.progress,
          criadaEm: new Date(job.timestamp).toISOString(),
          ...(job.processedOn ? { iniciadaEm: new Date(job.processedOn).toISOString() } : {}),
          ...(job.finishedOn ? { finalizadaEm: new Date(job.finishedOn).toISOString() } : {}),
          ...(estado === "completed" ? {
            relatorioDisponivel,
            ...(typeof retorno?.resultadoAnaliticoId === "string"
              ? { resultadoAnaliticoId: retorno.resultadoAnaliticoId }
              : {})
          } : {}),
          ...(estado === "failed" ? { erro: "A tarefa falhou durante o processamento." } : {})
        }
      });
    } catch (erro) {
      request.log.error({ err: erro }, "Falha ao obter estado atualizado da tarefa.");
      return reply.code(503).send({ erro: "Nao foi possivel consultar a tarefa agora." });
    }
  });

  app.get<{ Params: { tarefaId: string } }>("/api/v1/public/relatorios/analiticos/:tarefaId/arquivo", {
    ...rateLimitPublico,
    preHandler: [hooks.autenticar, hooks.exigirPermissao(PermissaoChaveApi.GERAR_RELATORIOS_ANALITICOS)],
    schema: {
      params: {
        type: "object", required: ["tarefaId"], additionalProperties: false,
        properties: { tarefaId: { type: "string", format: "uuid" } }
      }
    }
  }, async (request, reply) => {
    const fila = servicos.filaRelatorios;
    if (!fila) return reply.code(503).send({ erro: "Fila de relatorios indisponivel. Configure REDIS_URL." });

    let job: Job<DadosTarefaRelatorio> | undefined;
    try {
      job = await obterJob(fila, request.params.tarefaId);
    } catch (erro) {
      request.log.error({ err: erro }, "Falha ao consultar tarefa para download de relatorio.");
      return reply.code(503).send({ erro: "Nao foi possivel consultar a tarefa agora." });
    }

    if (!job || job.data.organizacaoId !== request.contextoChaveApi!.organizacaoId) {
      return reply.code(404).send({ erro: "Tarefa de relatorio nao encontrada." });
    }

    try {
      const estado = await job.getState();
      if (estado !== "completed") {
        return reply.code(409).send({ erro: "O relatorio ainda nao esta disponivel para download." });
      }

      const arquivo = await readFile(obterCaminhoArquivoRelatorio(request.params.tarefaId), "utf8");
      return reply
        .type("application/json; charset=utf-8")
        .header("content-disposition", `attachment; filename="${request.params.tarefaId}.json"`)
        .send(arquivo);
    } catch (erro) {
      if ((erro as NodeJS.ErrnoException).code === "ENOENT") {
        return reply.code(404).send({ erro: "Arquivo do relatorio nao encontrado." });
      }
      request.log.error({ err: erro }, "Falha ao recuperar arquivo de relatorio.");
      return reply.code(500).send({ erro: "Nao foi possivel recuperar o arquivo do relatorio." });
    }
  });
}
