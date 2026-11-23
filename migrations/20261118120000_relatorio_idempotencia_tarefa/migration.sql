ALTER TABLE "resultados_analiticos"
ADD COLUMN "tarefaId" UUID;

CREATE UNIQUE INDEX "resultados_analiticos_tarefaId_key"
ON "resultados_analiticos"("tarefaId");
