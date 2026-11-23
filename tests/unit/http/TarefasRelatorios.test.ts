import { mapearEstadoTarefaRelatorio } from "../../../src/http/controladores/ControladorApiPublica";
import { obterCaminhoArquivoRelatorio } from "../../../src/queue/ArmazenamentoRelatorios";

describe("estados públicos das tarefas de relatório", () => {
  it.each([
    ["waiting", "AGUARDANDO"],
    ["delayed", "AGUARDANDO"],
    ["active", "EM_PROCESSAMENTO"],
    ["completed", "CONCLUIDA"],
    ["failed", "FALHOU"],
    ["unknown", "DESCONHECIDO"]
  ])("mapeia o estado BullMQ %s para %s", (estado, esperado) => {
    expect(mapearEstadoTarefaRelatorio(estado)).toBe(esperado);
  });

  it("aceita apenas UUIDs como nome de arquivo da tarefa", () => {
    expect(() => obterCaminhoArquivoRelatorio("../../segredo.json")).toThrow("UUID valido");
  });
});
