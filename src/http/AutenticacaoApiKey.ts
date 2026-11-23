import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { PermissaoChaveApi } from "@prisma/client";
import { ServicoChaveApiPrisma } from "../services/ServicoChaveApiPrisma";

export interface ContextoChaveApi {
  id: string;
  organizacaoId: string;
  permissoes: PermissaoChaveApi[];
}

type HookApiKey = (request: FastifyRequest, reply: FastifyReply) => Promise<void>;

declare module "fastify" {
  interface FastifyRequest {
    contextoChaveApi: ContextoChaveApi | null;
  }
}

export interface HooksApiKey {
  autenticar: HookApiKey;
  exigirPermissao: (permissao: PermissaoChaveApi) => HookApiKey;
}

export function registrarAutenticacaoApiKey(
  app: FastifyInstance,
  servico: ServicoChaveApiPrisma
): HooksApiKey {
  app.decorateRequest("contextoChaveApi", null);

  const autenticar: HookApiKey = async (request, reply) => {
    const cabecalho = request.headers["x-api-key"];
    const chave = typeof cabecalho === "string" ? cabecalho : undefined;
    const contexto = await servico.autenticar(chave);
    if (!contexto) {
      await reply.code(401).send({ erro: "API Key ausente, invalida, expirada ou revogada." });
      return;
    }
    request.contextoChaveApi = contexto;
  };

  return {
    autenticar,
    exigirPermissao: (permissao) => async (request, reply) => {
      if (!request.contextoChaveApi) {
        await reply.code(401).send({ erro: "API Key necessaria." });
        return;
      }
      if (!request.contextoChaveApi.permissoes.includes(permissao)) {
        await reply.code(403).send({ erro: "A API Key nao possui permissao para esta operacao." });
      }
    }
  };
}
