-- Guarda os valores reais de recuperacao informados para cada equipamento.
CREATE TYPE "TipoResultadoAnalitico" AS ENUM (
  'EFICIENCIA_OPERACIONAL',
  'RENTABILIDADE_EQUIPAMENTO',
  'VIDA_UTIL_PREDITIVA'
);

CREATE TABLE "recuperacoes_equipamentos" (
  "id" UUID NOT NULL,
  "equipamentoId" UUID NOT NULL,
  "valorRecuperado" DECIMAL(12,2) NOT NULL,
  "estadoFisico" "EstadoFisico" NOT NULL,
  "avaliadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "registradoPor" TEXT NOT NULL,
  "observacao" TEXT NOT NULL DEFAULT '',
  CONSTRAINT "recuperacoes_equipamentos_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "recuperacoes_valor_nao_negativo_check" CHECK ("valorRecuperado" >= 0)
);

CREATE TABLE "resultados_analiticos" (
  "id" UUID NOT NULL,
  "tipo" "TipoResultadoAnalitico" NOT NULL,
  "geradoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "periodoInicio" TIMESTAMP(3),
  "periodoFim" TIMESTAMP(3),
  "filtros" JSONB,
  "resultado" JSONB NOT NULL,
  "usuarioId" UUID,
  CONSTRAINT "resultados_analiticos_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "resultados_analiticos_periodo_valido_check" CHECK (
    "periodoInicio" IS NULL OR "periodoFim" IS NULL OR "periodoInicio" <= "periodoFim"
  )
);

CREATE INDEX "recuperacoes_equipamentos_avaliadoEm_idx"
  ON "recuperacoes_equipamentos"("avaliadoEm");
CREATE INDEX "recuperacoes_equipamentos_equipamentoId_avaliadoEm_idx"
  ON "recuperacoes_equipamentos"("equipamentoId", "avaliadoEm");
CREATE INDEX "resultados_analiticos_tipo_geradoEm_idx"
  ON "resultados_analiticos"("tipo", "geradoEm");
CREATE INDEX "resultados_analiticos_usuarioId_geradoEm_idx"
  ON "resultados_analiticos"("usuarioId", "geradoEm");

ALTER TABLE "recuperacoes_equipamentos"
  ADD CONSTRAINT "recuperacoes_equipamentos_equipamentoId_fkey"
  FOREIGN KEY ("equipamentoId") REFERENCES "equipamentos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "resultados_analiticos"
  ADD CONSTRAINT "resultados_analiticos_usuarioId_fkey"
  FOREIGN KEY ("usuarioId") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;
