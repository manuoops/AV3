CREATE TYPE "PermissaoChaveApi" AS ENUM (
  'RASTREAR_EQUIPAMENTO',
  'LER_LOTES',
  'ESCREVER_LOTES',
  'GERAR_RELATORIOS_ANALITICOS'
);

CREATE TABLE "chaves_api" (
  "id" UUID NOT NULL,
  "nome" TEXT NOT NULL,
  "prefixo" VARCHAR(20) NOT NULL,
  "hashChave" VARCHAR(64) NOT NULL,
  "permissoes" "PermissaoChaveApi"[] NOT NULL,
  "organizacaoId" UUID NOT NULL,
  "criadaPorId" UUID,
  "criadaEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiraEm" TIMESTAMP(3),
  "revogadaEm" TIMESTAMP(3),
  "ultimoUsoEm" TIMESTAMP(3),
  CONSTRAINT "chaves_api_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "chaves_api_hashChave_key" ON "chaves_api"("hashChave");
CREATE INDEX "chaves_api_organizacaoId_revogadaEm_idx" ON "chaves_api"("organizacaoId", "revogadaEm");
CREATE INDEX "chaves_api_expiraEm_idx" ON "chaves_api"("expiraEm");

ALTER TABLE "chaves_api"
  ADD CONSTRAINT "chaves_api_organizacaoId_fkey"
  FOREIGN KEY ("organizacaoId") REFERENCES "organizacoes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "chaves_api"
  ADD CONSTRAINT "chaves_api_criadaPorId_fkey"
  FOREIGN KEY ("criadaPorId") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;
