import { join, resolve } from "node:path";

export function obterDiretorioRelatorios(diretorio?: string): string {
  return resolve(diretorio?.trim() || process.env.REPORTS_DIRECTORY?.trim() || join("data", "relatorios-analiticos"));
}

export function obterCaminhoArquivoRelatorio(tarefaId: string, diretorio?: string): string {
  if (!/^[0-9a-f-]{36}$/i.test(tarefaId)) {
    throw new Error("O identificador da tarefa nao e um UUID valido.");
  }

  return join(obterDiretorioRelatorios(diretorio), `${tarefaId}.json`);
}
