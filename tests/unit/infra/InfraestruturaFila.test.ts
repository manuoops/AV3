import { obterConexaoRedis, NOME_FILA_RELATORIOS } from "../../../src/queue/ConfiguracaoFila";

describe("infraestrutura da fila de relatórios", () => {
  it("usa um nome estável para a fila", () => {
    expect(NOME_FILA_RELATORIOS).toBe("relatorios-analiticos");
  });

  it("configura Redis para permitir as tentativas exigidas pelo BullMQ", () => {
    expect(obterConexaoRedis("redis://localhost:6379")).toEqual({
      url: "redis://localhost:6379",
      maxRetriesPerRequest: null
    });
  });

  it("falha com mensagem clara se a URL do Redis não estiver configurada", () => {
    expect(() => obterConexaoRedis("")).toThrow("Configure REDIS_URL");
  });
});
