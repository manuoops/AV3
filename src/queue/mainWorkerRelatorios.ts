import { prisma } from "../infra/PrismaClient";
import { criarProcessadorRelatorios } from "./ProcessadorRelatorios";
import { criarWorkerRelatorios } from "./WorkerRelatorios";

async function main(): Promise<void> {
  const worker = criarWorkerRelatorios(criarProcessadorRelatorios());
  let encerrando = false;

  const encerrar = async (sinal: NodeJS.Signals) => {
    if (encerrando) return;
    encerrando = true;
    console.info(`Sinal ${sinal} recebido; encerrando worker de relatorios.`);
    try {
      await worker.close();
      await prisma.$disconnect();
      process.exitCode = 0;
    } catch (erro) {
      console.error("Falha ao encerrar worker de relatorios:", erro);
      process.exitCode = 1;
    }
  };

  process.once("SIGINT", encerrar);
  process.once("SIGTERM", encerrar);
  worker.on("completed", (job, resultado) => {
    console.info(`Tarefa de relatorio ${job.id} concluida. Arquivo: ${resultado.arquivo}`);
  });
  worker.on("failed", (job, erro) => {
    console.error(
      `Falha na tarefa de relatorio ${job?.id ?? "desconhecida"} ` +
      `(tentativa ${job?.attemptsMade ?? 0}/${job?.opts.attempts ?? 1}):`,
      erro
    );
  });
  worker.on("error", (erro) => console.error("Erro no worker de relatorios:", erro));

  await worker.waitUntilReady();
  console.info("Worker de relatorios conectado ao Redis e aguardando tarefas.");
}

main().catch(async (erro) => {
  console.error("Erro fatal ao iniciar worker de relatorios:", erro);
  await prisma.$disconnect();
  process.exitCode = 1;
});
