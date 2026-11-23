import Fastify, { FastifyInstance } from "fastify";
import { Queue } from "bullmq";
import { Prisma } from "@prisma/client";
import { ambiente } from "../config/Ambiente";
import { prisma } from "../infra/PrismaClient";
import { executarTransacao } from "../infra/TransacaoPrisma";
import { PrismaExecutor } from "../infra/repositories/PrismaExecutor";
import { RepositorioUsuarioPrisma } from "../infra/repositories/RepositorioUsuarioPrisma";
import { RepositorioJournalPrisma } from "../infra/repositories/RepositorioJournalPrisma";
import { ServicoAutenticacaoPrisma } from "../services/ServicoAutenticacaoPrisma";
import { registrarAutenticacaoJwt } from "./AutenticacaoJwt";
import { registrarRotasAutenticacao } from "./controladores/ControladorAutenticacao";
import { registrarRotasOrganizacao } from "./controladores/ControladorOrganizacao";
import { registrarRotasContrato } from "./controladores/ControladorContrato";
import { registrarRotasLote } from "./controladores/ControladorLote";
import { registrarRotasEquipamento } from "./controladores/ControladorEquipamento";
import { registrarRotasRelatorio } from "./controladores/ControladorRelatorio";
import { ServicoOrganizacaoPrisma } from "../services/ServicoOrganizacaoPrisma";
import { ServicoContratoPrisma } from "../services/ServicoContratoPrisma";
import { ServicoLotePrisma } from "../services/ServicoLotePrisma";
import { ServicoEquipamentoPrisma } from "../services/ServicoEquipamentoPrisma";
import { ServicoRelatorioPrisma } from "../services/ServicoRelatorioPrisma";
import { ServicoAnaliseEficienciaPrisma } from "../analytics/ServicoAnaliseEficienciaPrisma";
import { ServicoAnaliseRentabilidadePrisma } from "../analytics/ServicoAnaliseRentabilidadePrisma";
import { ServicoAnaliseVidaUtilPrisma } from "../analytics/ServicoAnaliseVidaUtilPrisma";
import { RepositorioResultadoAnaliticoPrisma } from "../infra/repositories/RepositorioResultadoAnaliticoPrisma";
import { registrarRotasAnaliticas } from "./controladores/ControladorAnalitica";
import swagger from "@fastify/swagger";
import rateLimit from "@fastify/rate-limit";
import { OpenAPIV3 } from "openapi-types";
import { createHash } from "crypto";
import { ServicoChaveApiPrisma } from "../services/ServicoChaveApiPrisma";
import { registrarRotasChavesApi } from "./controladores/ControladorChaveApi";
import { registrarAutenticacaoApiKey } from "./AutenticacaoApiKey";
import { registrarRotasApiPublica } from "./controladores/ControladorApiPublica";
import { registrarDocumentacaoSwagger } from "./DocumentacaoSwagger";
import { criarFilaRelatorios, DadosTarefaRelatorio } from "../queue/FilaRelatorios";
import { registrarInterfaceWeb } from "./InterfaceWeb";

export interface OpcoesServidor {
  logger?: boolean;
  fastify?: FastifyInstance;
  database?: PrismaExecutor;
  transacionar?: <T>(operacao: (tx: Prisma.TransactionClient) => Promise<T>) => Promise<T>;
  filaRelatorios?: Queue<DadosTarefaRelatorio>;
}

const openApi = {
  openapi: "3.0.3",
  info: { title: "GreenCode API", version: "1.0.0", description: "API de logística reversa de equipamentos eletrônicos." },
  servers: [{ url: "/" }],
  components: { securitySchemes: {
    bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
    apiKeyAuth: { type: "apiKey", in: "header", name: "x-api-key", description: "Chave emitida para um parceiro e apresentada no cabecalho x-api-key." }
  } },
  paths: {
    "/health": { get: { summary: "Verifica disponibilidade", responses: { "200": { description: "Servidor ativo" } } } },
    "/organizacoes": { get: { security: [{ bearerAuth: [] }], summary: "Lista organizacoes ativas", responses: { "200": { description: "Organizacoes" } } }, post: { security: [{ bearerAuth: [] }], summary: "Cadastra organizacao", responses: { "201": { description: "Organizacao criada" } } } },
    "/organizacoes/{id}": {
      get: { security: [{ bearerAuth: [] }], summary: "Consulta organizacao", responses: { "200": { description: "Organizacao" }, "404": { description: "Nao encontrada" } } },
      put: { security: [{ bearerAuth: [] }], summary: "Atualiza dados da organizacao com controle de versao", responses: { "200": { description: "Organizacao atualizada" }, "409": { description: "Conflito de versao ou CNPJ duplicado" } } },
      delete: { security: [{ bearerAuth: [] }], summary: "Desativa a organizacao sem apagar seu historico", responses: { "200": { description: "Organizacao desativada" }, "409": { description: "Conflito de versao" } } }
    },
    "/organizacoes/{id}/endereco": { patch: { security: [{ bearerAuth: [] }], summary: "Altera endereco", responses: { "200": { description: "Endereco alterado" } } } },
    "/organizacoes/{id}/desativar": { patch: { security: [{ bearerAuth: [] }], summary: "Desativa organizacao", responses: { "200": { description: "Organizacao desativada" } } } },
    "/contratos": { get: { security: [{ bearerAuth: [] }], summary: "Lista contratos, opcionalmente filtrados por organizacao", responses: { "200": { description: "Contratos" } } }, post: { security: [{ bearerAuth: [] }], summary: "Cadastra contrato", responses: { "201": { description: "Contrato criado" } } } },
    "/contratos/{id}": {
      get: { security: [{ bearerAuth: [] }], summary: "Consulta contrato por ID", responses: { "200": { description: "Contrato" }, "404": { description: "Nao encontrado" } } },
      put: { security: [{ bearerAuth: [] }], summary: "Atualiza as condicoes do contrato", responses: { "200": { description: "Contrato atualizado" }, "409": { description: "Conflito de versao" } } },
      delete: { security: [{ bearerAuth: [] }], summary: "Exclui contrato e registra a acao no Journal", responses: { "200": { description: "Contrato excluido" }, "409": { description: "Conflito de versao" } } }
    },
    "/contratos/{organizacaoId}/renovar": { patch: { security: [{ bearerAuth: [] }], summary: "Renova contrato", responses: { "200": { description: "Contrato renovado" } } } },
    "/lotes": { get: { security: [{ bearerAuth: [] }], summary: "Consulta lotes", responses: { "200": { description: "Lotes" } } }, post: { security: [{ bearerAuth: [] }], summary: "Cadastra lote", responses: { "201": { description: "Lote criado" } } } },
    "/lotes/{id}": {
      get: { security: [{ bearerAuth: [] }], summary: "Consulta lote", responses: { "200": { description: "Lote" } } },
      put: { security: [{ bearerAuth: [] }], summary: "Atualiza lote ainda recebido", responses: { "200": { description: "Lote atualizado" }, "409": { description: "Conflito de versao" } } },
      delete: { security: [{ bearerAuth: [] }], summary: "Exclui lote recebido sem equipamentos", responses: { "200": { description: "Lote excluido" }, "409": { description: "Lote possui equipamentos ou ja foi processado" } } }
    },
    "/lotes/{id}/processar-triagem": { post: { security: [{ bearerAuth: [] }], summary: "Processa triagem do lote", responses: { "200": { description: "Lote processado" } } } },
    "/lotes/{id}/relatorio-triagem": { get: { security: [{ bearerAuth: [] }], summary: "Gera relatorio de triagem", responses: { "200": { description: "Relatorio" } } } },
    "/equipamentos": { get: { security: [{ bearerAuth: [] }], summary: "Lista equipamentos com filtros e paginacao", responses: { "200": { description: "Equipamentos" } } }, post: { security: [{ bearerAuth: [] }], summary: "Cadastra equipamento", responses: { "201": { description: "Equipamento criado" } } } },
    "/equipamentos/{id}": {
      get: { security: [{ bearerAuth: [] }], summary: "Consulta equipamento", responses: { "200": { description: "Equipamento" } } },
      put: { security: [{ bearerAuth: [] }], summary: "Atualiza dados descritivos do equipamento", responses: { "200": { description: "Equipamento atualizado" }, "409": { description: "Conflito de versao" } } },
      delete: { security: [{ bearerAuth: [] }], summary: "Da baixa definitiva preservando rastreabilidade e historico", responses: { "200": { description: "Equipamento baixado" }, "409": { description: "Conflito de versao" } } }
    },
    "/equipamentos/{id}/rastreabilidade": { get: { security: [{ bearerAuth: [] }], summary: "Consulta rastreabilidade", responses: { "200": { description: "Historico" } } } },
    "/equipamentos/{id}/estado": { patch: { security: [{ bearerAuth: [] }], summary: "Atualiza estado fisico", responses: { "200": { description: "Equipamento atualizado" }, "409": { description: "Conflito de versao" } } } },
    "/equipamentos/{id}/status": { patch: { security: [{ bearerAuth: [] }], summary: "Atualiza status", responses: { "200": { description: "Equipamento atualizado" }, "409": { description: "Conflito de versao" } } } },
    "/equipamentos/{id}/movimentacoes": { get: { security: [{ bearerAuth: [] }], summary: "Lista historico imutavel de movimentacoes", responses: { "200": { description: "Movimentacoes" } } }, post: { security: [{ bearerAuth: [] }], summary: "Registra movimentacao", responses: { "201": { description: "Movimentacao criada" } } } },
    "/relatorios/status": { get: { security: [{ bearerAuth: [] }], summary: "Relatorio por status", responses: { "200": { description: "Relatorio" } } } },
    "/relatorios/organizacao": { get: { security: [{ bearerAuth: [] }], summary: "Relatorio por organizacao e periodo", responses: { "200": { description: "Relatorio" } } } },
    "/relatorios/financeiro": { get: { security: [{ bearerAuth: [] }], summary: "Relatorio financeiro", responses: { "200": { description: "Relatorio" } } } },
    "/journal": { get: { security: [{ bearerAuth: [] }], summary: "Consulta Journal imutavel (administrador ou auditoria)", responses: { "200": { description: "Eventos de auditoria" }, "403": { description: "Acesso negado" } } } },
    "/analises/eficiencia-operacional": { post: { security: [{ bearerAuth: [] }], summary: "Analisa tempo de triagem por periodo e operador", responses: { "201": { description: "Resultado analitico salvo" } } } },
    "/analises/rentabilidade": { post: { security: [{ bearerAuth: [] }], summary: "Analisa valores reais de recuperacao por perfil de equipamento", responses: { "201": { description: "Resultado analitico salvo" } } } },
    "/analises/equipamentos/{id}/recuperacao": {
      get: { security: [{ bearerAuth: [] }], summary: "Lista avaliacoes historicas de recuperacao do equipamento", responses: { "200": { description: "Avaliacoes" } } },
      post: { security: [{ bearerAuth: [] }], summary: "Registra uma avaliacao real de recuperacao do equipamento", responses: { "201": { description: "Valor salvo" }, "403": { description: "Acesso negado" } } }
    },
    "/analises/vida-util": { post: { security: [{ bearerAuth: [] }], summary: "Estima vida util a partir do historico de estado", responses: { "201": { description: "Resultado analitico salvo" } } } },
    "/analises": { get: { security: [{ bearerAuth: [] }], summary: "Lista resultados analiticos salvos", responses: { "200": { description: "Resultados" } } } },
    "/analises/{id}": { get: { security: [{ bearerAuth: [] }], summary: "Consulta resultado analitico salvo", responses: { "200": { description: "Resultado" }, "404": { description: "Nao encontrado" } } } },
    "/auth/api-keys": {
      get: { security: [{ bearerAuth: [] }], summary: "Lista API Keys sem revelar o segredo", responses: { "200": { description: "Chaves" } } },
      post: { security: [{ bearerAuth: [] }], summary: "Cria API Key para uma organizacao", responses: { "201": { description: "Chave criada; o segredo e mostrado uma vez" } } }
    },
    "/auth/api-keys/{id}": {
      get: { security: [{ bearerAuth: [] }], summary: "Consulta API Key sem revelar o segredo", responses: { "200": { description: "Chave" }, "404": { description: "Chave nao encontrada" } } },
      put: { security: [{ bearerAuth: [] }], summary: "Atualiza nome, permissoes e validade de API Key ativa usando versao otimista", responses: { "200": { description: "Chave atualizada" }, "404": { description: "Chave ausente ou revogada" }, "409": { description: "Conflito de versao" } } },
      delete: { security: [{ bearerAuth: [] }], summary: "Revoga API Key", responses: { "200": { description: "Chave revogada" }, "404": { description: "Chave ausente ou ja revogada" } } }
    },
    "/api/v1/public/equipamentos/{id}/rastreabilidade": { get: {
      tags: ["API publica v1"], security: [{ apiKeyAuth: [] }], summary: "Consulta rastreabilidade dos equipamentos da organizacao da chave",
      parameters: [{ in: "path", name: "id", required: true, schema: { type: "string", format: "uuid" } }],
      responses: {
        "200": { description: "Dados de rastreabilidade", content: { "application/json": { example: { dados: { equipamento: { id: "uuid", codigoBarrasInterno: "NTB-000001", estadoFisico: "BOM_ESTADO", movimentacoes: [] }, lote: { id: "uuid", dataEntrada: "2026-01-01T12:00:00.000Z", statusProcessamento: "EM_TRIAGEM" } } } } } },
        "401": { description: "Chave ausente, invalida, expirada ou revogada", content: { "application/json": { example: { erro: "API Key ausente, invalida, expirada ou revogada." } } } },
        "403": { description: "Permissao ausente", content: { "application/json": { example: { erro: "A API Key nao possui permissao para esta operacao." } } } },
        "404": { description: "Equipamento nao encontrado para esta organizacao", content: { "application/json": { example: { erro: "Equipamento nao encontrado." } } } },
        "429": { description: "Limite de requisicoes excedido", content: { "application/json": { example: { statusCode: 429, error: "Too Many Requests", message: "Rate limit exceeded" } } } }
      }
    } },
    "/api/v1/public/lotes": {
      get: { tags: ["API publica v1"], security: [{ apiKeyAuth: [] }], summary: "Lista lotes da organizacao vinculada a chave",
        parameters: [
          { in: "query", name: "inicio", required: true, schema: { type: "string", format: "date-time" } },
          { in: "query", name: "fim", required: true, schema: { type: "string", format: "date-time" } },
          { in: "query", name: "skip", schema: { type: "integer", minimum: 0 } },
          { in: "query", name: "take", schema: { type: "integer", minimum: 1, maximum: 500 } }
        ], responses: {
          "200": { description: "Lotes encontrados", content: { "application/json": { example: { dados: [{ id: "uuid", organizacaoId: "uuid", notaFiscal: "NF-2026-001", statusProcessamento: "RECEBIDO" }] } } } },
          "400": { description: "Parametros invalidos", content: { "application/json": { example: { erro: "dataInicio nao pode ser posterior a dataFim." } } } },
          "401": { description: "Chave invalida", content: { "application/json": { example: { erro: "API Key ausente, invalida, expirada ou revogada." } } } },
          "403": { description: "Permissao ausente", content: { "application/json": { example: { erro: "A API Key nao possui permissao para esta operacao." } } } },
          "429": { description: "Limite excedido", content: { "application/json": { example: { statusCode: 429, error: "Too Many Requests", message: "Rate limit exceeded" } } } }
        }
      },
      post: { tags: ["API publica v1"], security: [{ apiKeyAuth: [] }], summary: "Submete novo lote para a organizacao da chave",
        requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["notaFiscal", "transportadora"], properties: { dataEntrada: { type: "string", format: "date-time" }, notaFiscal: { type: "string" }, transportadora: { type: "string" }, observacoes: { type: "string" } } }, example: { notaFiscal: "NF-2026-001", transportadora: "Parceiro Logistico" } } } },
        responses: {
          "201": { description: "Lote criado", content: { "application/json": { example: { dados: { id: "uuid", organizacaoId: "uuid", notaFiscal: "NF-2026-001", statusProcessamento: "RECEBIDO" } } } } },
          "400": { description: "Dados invalidos", content: { "application/json": { example: { erro: "notaFiscal e obrigatoria." } } } },
          "401": { description: "Chave invalida", content: { "application/json": { example: { erro: "API Key ausente, invalida, expirada ou revogada." } } } },
          "403": { description: "Permissao de escrita ausente", content: { "application/json": { example: { erro: "A API Key nao possui permissao para esta operacao." } } } },
          "429": { description: "Limite excedido", content: { "application/json": { example: { statusCode: 429, error: "Too Many Requests", message: "Rate limit exceeded" } } } }
        }
      }
    },
    "/api/v1/public/lotes/{id}": { get: { tags: ["API publica v1"], security: [{ apiKeyAuth: [] }], summary: "Consulta lote da organizacao vinculada a chave",
      parameters: [{ in: "path", name: "id", required: true, schema: { type: "string", format: "uuid" } }],
      responses: {
        "200": { description: "Lote encontrado", content: { "application/json": { example: { dados: { id: "uuid", organizacaoId: "uuid", notaFiscal: "NF-2026-001", statusProcessamento: "RECEBIDO" } } } } },
        "401": { description: "Chave invalida", content: { "application/json": { example: { erro: "API Key ausente, invalida, expirada ou revogada." } } } },
        "403": { description: "Permissao ausente", content: { "application/json": { example: { erro: "A API Key nao possui permissao para esta operacao." } } } },
        "404": { description: "Lote nao encontrado para esta organizacao", content: { "application/json": { example: { erro: "Lote nao encontrado." } } } },
        "429": { description: "Limite excedido", content: { "application/json": { example: { statusCode: 429, error: "Too Many Requests", message: "Rate limit exceeded" } } } }
      }
    } },
    "/api/v1/public/relatorios/analiticos/{tarefaId}": { get: {
      tags: ["API publica v1"], security: [{ apiKeyAuth: [] }],
      summary: "Consulta estado da tarefa de relatorio da organizacao da chave",
      parameters: [{ in: "path", name: "tarefaId", required: true, schema: { type: "string", format: "uuid" } }],
      responses: {
        "200": { description: "Estado da tarefa", content: { "application/json": { example: { dados: { tarefaId: "uuid", status: "CONCLUIDA", progresso: 100, relatorioDisponivel: true, resultadoAnaliticoId: "uuid" } } } } },
        "401": { description: "Chave invalida" }, "403": { description: "Permissao ausente" },
        "404": { description: "Tarefa nao encontrada para esta organizacao" },
        "503": { description: "Fila indisponivel" }, "429": { description: "Limite de requisicoes excedido" }
      }
    } },
    "/api/v1/public/relatorios/analiticos/{tarefaId}/arquivo": { get: {
      tags: ["API publica v1"], security: [{ apiKeyAuth: [] }],
      summary: "Baixa o JSON de uma tarefa concluida da organizacao da chave",
      parameters: [{ in: "path", name: "tarefaId", required: true, schema: { type: "string", format: "uuid" } }],
      responses: {
        "200": { description: "Arquivo JSON do relatorio", content: { "application/json": {} } },
        "401": { description: "Chave invalida" }, "403": { description: "Permissao ausente" },
        "404": { description: "Tarefa ou arquivo nao encontrado" }, "409": { description: "Relatorio ainda em processamento" },
        "503": { description: "Fila indisponivel" }, "429": { description: "Limite de requisicoes excedido" }
      }
    } },
    "/api/v1/public/relatorios/analiticos": {
      post: {
        tags: ["API publica v1"],
        security: [{ apiKeyAuth: [] }],
        summary: "Solicita analise delimitada a organizacao da chave",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["tipo"],
                properties: {
                  tipo: { type: "string", enum: ["EFICIENCIA_OPERACIONAL", "RENTABILIDADE_EQUIPAMENTO", "VIDA_UTIL_PREDITIVA"] },
                  periodo: {
                    type: "object", required: ["inicio", "fim"],
                    properties: { inicio: { type: "string", format: "date-time" }, fim: { type: "string", format: "date-time" } }
                  },
                  periodoComparacao: {
                    type: "object", required: ["inicio", "fim"],
                    properties: { inicio: { type: "string", format: "date-time" }, fim: { type: "string", format: "date-time" } }
                  },
                  tipoEquipamento: { type: "string", enum: ["COMPUTADOR_MESA", "NOTEBOOK", "MONITOR", "IMPRESSORA", "SERVIDOR", "ROTEADOR", "CABO_ESTRUTURADO", "FONTE_ALIMENTACAO"] }
                }
              },
              example: { tipo: "EFICIENCIA_OPERACIONAL", periodo: { inicio: "2026-01-01T00:00:00.000Z", fim: "2026-01-31T23:59:59.999Z" } }
            }
          }
        },
        responses: {
          "202": { description: "Tarefa aceita para processamento", content: { "application/json": { example: { dados: { tarefaId: "uuid", status: "AGUARDANDO" } } } } },
          "400": { description: "Parametros invalidos", content: { "application/json": { example: { erro: "periodo e obrigatorio para eficiencia operacional." } } } },
          "401": { description: "Chave invalida", content: { "application/json": { example: { erro: "API Key ausente, invalida, expirada ou revogada." } } } },
          "403": { description: "Permissao ausente", content: { "application/json": { example: { erro: "A API Key nao possui permissao para esta operacao." } } } },
          "503": { description: "Fila indisponivel", content: { "application/json": { example: { erro: "Nao foi possivel enfileirar o relatorio. Tente novamente mais tarde." } } } },
          "429": { description: "Limite excedido", content: { "application/json": { example: { statusCode: 429, error: "Too Many Requests", message: "Rate limit exceeded" } } } }
        }
      }
    },
    "/auth/login": { post: { summary: "Autentica usuário e retorna JWT", responses: { "200": { description: "Token emitido" }, "401": { description: "Credenciais inválidas" } } } },
    "/auth/me": { get: { security: [{ bearerAuth: [] }], summary: "Retorna usuário autenticado", responses: { "200": { description: "Usuário autenticado" }, "401": { description: "Token inválido" } } } },
    "/auth/usuarios": { get: { security: [{ bearerAuth: [] }], summary: "Lista usuários permitidos ao solicitante", responses: { "200": { description: "Lista de usuários" } } }, post: { security: [{ bearerAuth: [] }], summary: "Cadastra usuário (somente administrador)", responses: { "201": { description: "Usuário criado" }, "400": { description: "Dados inválidos" }, "403": { description: "Acesso negado" } } } },
    "/auth/usuarios/{id}": {
      get: { security: [{ bearerAuth: [] }], summary: "Consulta usuário conforme o escopo do solicitante", responses: { "200": { description: "Usuário sem dados de senha" }, "404": { description: "Usuário ausente ou fora do escopo" } } },
      put: { security: [{ bearerAuth: [] }], summary: "Atualiza nome e papel do usuário (administrador)", responses: { "200": { description: "Usuário atualizado" }, "403": { description: "Acesso negado" }, "409": { description: "Conflito de versão" } } },
      delete: { security: [{ bearerAuth: [] }], summary: "Desativa usuário e revoga suas sessões (administrador)", responses: { "200": { description: "Usuário desativado" }, "403": { description: "Acesso negado" }, "404": { description: "Usuário não encontrado" } } }
    },
    "/auth/usuarios/{id}/desativar": { patch: { security: [{ bearerAuth: [] }], summary: "Desativa usuário (administrador)", responses: { "200": { description: "Usuário desativado" }, "403": { description: "Acesso negado" } } } },
    "/auth/senha": { patch: { security: [{ bearerAuth: [] }], summary: "Altera senha do usuário autenticado", responses: { "204": { description: "Senha alterada" }, "401": { description: "Senha atual inválida" } } } }
  }
} as const;

export async function criarServidor(opcoes: OpcoesServidor = {}): Promise<FastifyInstance> {
  const app = opcoes.fastify ?? Fastify({ logger: opcoes.logger ?? false, bodyLimit: 1024 * 1024 });
  const filaRelatorios = opcoes.filaRelatorios ?? (ambiente.redisUrl ? criarFilaRelatorios(ambiente.redisUrl) : undefined);
  if (filaRelatorios && !opcoes.filaRelatorios) {
    app.addHook("onClose", async () => filaRelatorios.close());
  }
  const database = opcoes.database ?? prisma;
  const transacionar = opcoes.transacionar ?? executarTransacao;
  await app.register(swagger, {
    mode: "static",
    specification: { document: openApi as unknown as OpenAPIV3.Document }
  });
  await app.register(rateLimit, {
    global: false,
    keyGenerator: (request) => {
      const cabecalho = request.headers["x-api-key"];
      return typeof cabecalho === "string"
        ? createHash("sha256").update(cabecalho, "utf8").digest("hex")
        : request.ip;
    }
  });
  const journal = new RepositorioJournalPrisma(database);
  const autenticacao = new ServicoAutenticacaoPrisma(new RepositorioUsuarioPrisma(database), journal, transacionar);
  const servicoChaves = new ServicoChaveApiPrisma(transacionar, database);
  const hooksApiKey = registrarAutenticacaoApiKey(app, servicoChaves);
  await registrarAutenticacaoJwt(app, { repositorio: new RepositorioUsuarioPrisma(database) });
  registrarRotasAutenticacao(app, autenticacao);
  registrarRotasChavesApi(app, servicoChaves);

  app.get("/health", async () => ({ status: "ok" }));
  registrarDocumentacaoSwagger(app, openApi);
  registrarInterfaceWeb(app);
  app.get("/api/info", async () => ({ nome: "GreenCode API", documentacao: "/openapi.json", saude: "/health" }));

  app.setNotFoundHandler((_request, reply) => reply.code(404).send({ erro: "Rota nao encontrada." }));
  app.setErrorHandler((erro, _request, reply) => {
    const statusCode = (erro as Error & { statusCode?: number }).statusCode;
    if (statusCode && statusCode >= 400 && statusCode < 500) {
      return reply.code(statusCode).send({ erro: erro instanceof Error ? erro.message : "Requisicao invalida." });
    }
    if ((erro as { validation?: unknown }).validation) {
      return reply.code(400).send({ erro: "Requisicao invalida.", detalhes: (erro as Error).message });
    }
    if (erro instanceof Prisma.PrismaClientKnownRequestError) {
      if (erro.code === "P2002") return reply.code(409).send({ erro: "Registro duplicado." });
      if (erro.code === "P2025") return reply.code(404).send({ erro: "Registro nao encontrado." });
      if (erro.code === "P2003" || erro.code === "P2014") return reply.code(400).send({ erro: "Relacionamento invalido." });
    }
    if (erro instanceof Error) {
      if (/ja existe|j.+ existe|ja possui|j.+ possui|conflito de vers/i.test(erro.message)) {
        return reply.code(409).send({ erro: erro.message });
      }
      if (/nao encontrado|não encontrado|nao encontrada|não encontrada/i.test(erro.message)) {
        return reply.code(404).send({ erro: erro.message });
      }
      if (/obrigat|inval|deve |nao pode|não pode|posterior|futura|positivo|vazio|vazia|necessaria|necessaria|somente|possui/i.test(erro.message)) {
        return reply.code(400).send({ erro: erro.message });
      }
    }
    app.log.error(erro);
    return reply.code(500).send({ erro: "Erro interno do servidor." });
  });

  const organizacoes = new ServicoOrganizacaoPrisma(transacionar, database);
  const contratos = new ServicoContratoPrisma(transacionar, database);
  const lotes = new ServicoLotePrisma(transacionar, database);
  const equipamentos = new ServicoEquipamentoPrisma(transacionar, database);
  const relatorios = new ServicoRelatorioPrisma(database);

  registrarRotasOrganizacao(app, organizacoes);
  registrarRotasContrato(app, contratos);
  registrarRotasLote(app, lotes);
  registrarRotasEquipamento(app, equipamentos);
  registrarRotasRelatorio(app, relatorios, journal);
  registrarRotasAnaliticas(app, {
    eficiencia: new ServicoAnaliseEficienciaPrisma(database),
    rentabilidade: new ServicoAnaliseRentabilidadePrisma(transacionar, database),
    vidaUtil: new ServicoAnaliseVidaUtilPrisma(database),
    resultados: new RepositorioResultadoAnaliticoPrisma(database)
  });
  registrarRotasApiPublica(app, hooksApiKey, {
    equipamentos,
    lotes,
    filaRelatorios
  });

  return app;
}

export async function iniciarServidor(): Promise<FastifyInstance> {
  const app = await criarServidor({ logger: true });
  try {
    await app.listen({ port: ambiente.porta, host: "0.0.0.0" });
    app.log.info(`GreenCode API ouvindo na porta ${ambiente.porta}`);
    return app;
  } catch (erro) {
    await app.close();
    await prisma.$disconnect();
    throw erro;
  }
}
