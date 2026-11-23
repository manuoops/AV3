import { ambiente } from "../config/Ambiente";

export const NOME_FILA_RELATORIOS = "relatorios-analiticos";
export const NOME_FILA_ANALISES_AGENDADAS = "analises-agendadas";

export function obterConexaoRedis(redisUrl = ambiente.redisUrl) {
  if (!redisUrl) {
    throw new Error("Configure REDIS_URL para iniciar as filas BullMQ.");
  }

  return { url: redisUrl, maxRetriesPerRequest: null } as const;
}
