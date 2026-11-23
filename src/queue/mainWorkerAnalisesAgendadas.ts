import { prisma } from "../infra/PrismaClient";
import { registrarAgendamentosAnaliticos } from "./AgendadorAnalises";
import { criarFilaAnalisesAgendadas } from "./FilaAnalisesAgendadas";
import { criarProcessadorAnalisesAgendadas } from "./ProcessadorAnalisesAgendadas";
import { criarWorkerAnalisesAgendadas } from "./WorkerAnalisesAgendadas";

async function main(): Promise<void> {
  const fila = criarFilaAnalisesAgendadas();
  let worker: ReturnType<typeof criarWorkerAnalisesAgendadas> | undefined;
  let encerrando = false;

  const encerrar = async (sinal: NodeJS.Signals) => {
    if (encerrando) return;
    encerrando = true;
    console.info(`Sinal ${sinal} recebido; encerrando worker de analises agendadas.`);
    try {
      await worker?.close();
      await fila.close();
      await prisma.$disconnect();
      process.exitCode = 0;
    } catch (erro) {
      console.error("Falha ao encerrar worker de analises agendadas:", erro);
      process.exitCode = 1;
    }
  };

  process.once("SIGINT", encerrar);
  process.once("SIGTERM", encerrar);

  try {
    await fila.waitUntilReady();
    await registrarAgendamentosAnaliticos(fila);
    console.info("Agendamentos mensais e semanais de analises registrados no Redis.");
    worker = criarWorkerAnalisesAgendadas(criarProcessadorAnalisesAgendadas());
    worker.on("completed", (job, resultado) => {
      console.info(
        `Analise agendada ${resultado.tipo} concluida; job ${job.id}, resultado ${resultado.resultadoAnaliticoId}.`
      );
    });
    worker.on("failed", (job, erro) => {
      console.error(
        `Falha em analise agendada ${job?.data.tipo ?? "desconhecida"}; job ${job?.id ?? "desconhecido"} ` +
        `(tentativa ${job?.attemptsMade ?? 0}/${job?.opts.attempts ?? 1}):`,
        erro
      );
    });
    worker.on("error", (erro) => console.error("Erro no worker de analises agendadas:", erro));
    await worker.waitUntilReady();
    console.info("Worker de analises agendadas conectado ao Redis.");
  } catch (erro) {
    await worker?.close().catch(() => undefined);
    await fila.close().catch(() => undefined);
    await prisma.$disconnect();
    throw erro;
  }
}

main().catch(async (erro) => {
  console.error("Erro fatal ao iniciar worker de analises agendadas:", erro);
  await prisma.$disconnect();
  process.exitCode = 1;
});
