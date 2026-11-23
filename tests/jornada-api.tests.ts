import { randomUUID } from "crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EstadoFisico, PapelUsuario, PermissaoChaveApi, Prisma, StatusRastreamento, TipoEquipamento, TipoResultadoAnalitico } from "@prisma/client";
import { FastifyInstance } from "fastify";
import { criarServidor } from "../src/http/Servidor";
import { prisma } from "../src/infra/PrismaClient";
import { RepositorioUsuarioPrisma } from "../src/infra/repositories/RepositorioUsuarioPrisma";
import { ServicoAutenticacaoPrisma } from "../src/services/ServicoAutenticacaoPrisma";
import { criarFilaRelatorios, NOME_JOB_RELATORIO_ANALITICO } from "../src/queue/FilaRelatorios";
import { ServicoAnaliseEficienciaPrisma } from "../src/analytics/ServicoAnaliseEficienciaPrisma";
import { ServicoAnaliseRentabilidadePrisma } from "../src/analytics/ServicoAnaliseRentabilidadePrisma";
import { ServicoAnaliseVidaUtilPrisma } from "../src/analytics/ServicoAnaliseVidaUtilPrisma";
import { criarProcessadorRelatorios } from "../src/queue/ProcessadorRelatorios";
import { criarWorkerRelatorios } from "../src/queue/WorkerRelatorios";
import { criarFilaAnalisesAgendadas } from "../src/queue/FilaAnalisesAgendadas";
import { AGENDAMENTOS_ANALITICOS, registrarAgendamentosAnaliticos } from "../src/queue/AgendadorAnalises";

jest.setTimeout(120_000);

function gerarCnpj(): string {
  const base = randomUUID().replace(/\D/g, "").slice(0, 12).padEnd(12, "0").split("").map(Number);
  const calcular = (numeros: number[], pesos: number[]) => {
    const resto = numeros.reduce((soma, numero, indice) => soma + numero * pesos[indice]!, 0) % 11;
    return resto < 2 ? 0 : 11 - resto;
  };
  const primeiro = calcular(base, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const segundo = calcular([...base, primeiro], [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return [...base, primeiro, segundo].join("");
}

describe("jornada da GreenCode API", () => {
  afterAll(async () => prisma.$disconnect());

  it("autentica papéis, executa o ciclo de organização/lote/equipamento e consulta relatórios", async () => {
    const abortar = new Error("ROLLBACK_JORNADA_API");
    const senhaAdmin = "AdminApiForte#2026";
    const senhaUsuario = "UsuarioApiForte#2026";
    const filaRelatorios = criarFilaRelatorios("redis://localhost:6379");
    const filaAnalisesAgendadas = criarFilaAnalisesAgendadas("redis://localhost:6379");
    let tarefaRelatorioId: string | undefined;
    const tarefasDaJornada: string[] = [];
    let workerRelatorios: ReturnType<typeof criarWorkerRelatorios> | undefined;
    let diretorioSaidaRelatorios: string | undefined;
    const diretorioRelatoriosOriginal = process.env.REPORTS_DIRECTORY;

    await prisma.$transaction(async (tx) => {
      const transacionar = async <T>(operacao: (executor: Prisma.TransactionClient) => Promise<T>) => operacao(tx);
      const app: FastifyInstance = await criarServidor({ database: tx, transacionar, filaRelatorios });
      try {
        await registrarAgendamentosAnaliticos(filaAnalisesAgendadas);
        const agendamentosRedis = await filaAnalisesAgendadas.getJobSchedulers();
        expect(agendamentosRedis.map(({ key }) => key)).toEqual(expect.arrayContaining(
          AGENDAMENTOS_ANALITICOS.map(({ id }) => id)
        ));
        const autenticacao = new ServicoAutenticacaoPrisma(new RepositorioUsuarioPrisma(tx));
        const sufixo = randomUUID().slice(0, 8);
        const usuarioAdmin = `admin-${sufixo}`;
        await autenticacao.cadastrarUsuario(usuarioAdmin, senhaAdmin, PapelUsuario.ADMINISTRADOR);

        const loginAdmin = await app.inject({ method: "POST", url: "/auth/login", payload: { usuario: usuarioAdmin, senha: senhaAdmin } });
        if (loginAdmin.statusCode !== 200) throw new Error(`login admin: ${loginAdmin.statusCode} ${loginAdmin.body}`);
        expect(loginAdmin.statusCode).toBe(200);
        const tokenAdmin = loginAdmin.json<{ accessToken: string }>().accessToken;

        const criarUsuario = async (usuario: string, papel: PapelUsuario) => {
          const resposta = await app.inject({
            method: "POST", url: "/auth/usuarios", headers: { authorization: `Bearer ${tokenAdmin}` },
            payload: { usuario, senha: senhaUsuario, papel }
          });
          expect(resposta.statusCode).toBe(201);
        };
        const operador = `operador-${sufixo}`;
        const almoxarife = `almox-${sufixo}`;
        const auditora = `audit-${sufixo}`;
        await criarUsuario(operador, PapelUsuario.OPERADOR_CADASTRO);
        await criarUsuario(almoxarife, PapelUsuario.GESTOR_ALMOXARIFADO);
        await criarUsuario(auditora, PapelUsuario.AUDITORIA);

        const obterToken = async (usuario: string) => {
          const resposta = await app.inject({ method: "POST", url: "/auth/login", payload: { usuario, senha: senhaUsuario } });
          expect(resposta.statusCode).toBe(200);
          return resposta.json<{ accessToken: string }>().accessToken;
        };
        const tokenOperador = await obterToken(operador);
        const tokenAlmoxarife = await obterToken(almoxarife);
        const tokenAuditora = await obterToken(auditora);

        const organizacaoPayload = {
          razaoSocial: `Organizacao jornada ${sufixo}`, cnpj: gerarCnpj(), inscricaoEstadual: "ISENTO",
          enderecoCompleto: "Rua da Jornada, 25", telefone: "11999999999", email: `jornada-${sufixo}@example.com`
        };
        const criada = await app.inject({ method: "POST", url: "/organizacoes", headers: { authorization: `Bearer ${tokenOperador}` }, payload: organizacaoPayload });
        expect(criada.statusCode).toBe(201);
        const organizacaoCriada = criada.json<{ id: string; versao: number }>();
        const organizacaoId = organizacaoCriada.id;

        const vencimento = new Date();
        vencimento.setFullYear(vencimento.getFullYear() + 1);
        const contrato = await app.inject({
          method: "POST", url: "/contratos", headers: { authorization: `Bearer ${tokenOperador}` },
          payload: {
            organizacaoId, dataVencimento: vencimento.toISOString(), clausulas: ["Contrato de teste de jornada"],
            valorMensal: 1500, renovacaoAutomatica: true
          }
        });
        expect(contrato.statusCode).toBe(201);
        const contratoCriado = contrato.json<{ id: string; versao: number }>();

        const dataHoje = new Date().toISOString().slice(0, 10);
        const amanha = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
        const lote = await app.inject({
          method: "POST", url: "/lotes", headers: { authorization: `Bearer ${tokenAlmoxarife}` },
          payload: { dataEntrada: new Date().toISOString(), organizacaoId, notaFiscal: `NF-${sufixo}`, transportadora: "Logistica de teste" }
        });
        expect(lote.statusCode).toBe(201);
        const loteCriado = lote.json<{ id: string; versao: number }>();
        const loteId = loteCriado.id;

        const outraOrganizacaoResposta = await app.inject({
          method: "POST", url: "/organizacoes", headers: { authorization: `Bearer ${tokenOperador}` },
          payload: {
            ...organizacaoPayload,
            razaoSocial: `Organizacao externa ${sufixo}`,
            cnpj: gerarCnpj(),
            email: `externa-${sufixo}@example.com`
          }
        });
        expect(outraOrganizacaoResposta.statusCode).toBe(201);
        const outraOrganizacaoId = outraOrganizacaoResposta.json<{ id: string }>().id;
        const outroLoteResposta = await app.inject({
          method: "POST", url: "/lotes", headers: { authorization: `Bearer ${tokenAlmoxarife}` },
          payload: {
            dataEntrada: new Date().toISOString(), organizacaoId: outraOrganizacaoId,
            notaFiscal: `NF-EXTERNA-${sufixo}`, transportadora: "Transportadora de teste"
          }
        });
        expect(outroLoteResposta.statusCode).toBe(201);
        const outroLoteId = outroLoteResposta.json<{ id: string }>().id;

        const equipamento = await app.inject({
          method: "POST", url: "/equipamentos", headers: { authorization: `Bearer ${tokenAlmoxarife}` },
          payload: {
            tipo: TipoEquipamento.NOTEBOOK, marca: "GreenCode", modelo: "Modelo API",
            anoFabricacao: 2022, estadoFisico: EstadoFisico.BOM_ESTADO, pesoQuilogramas: 2.5, loteId
          }
        });
        expect(equipamento.statusCode).toBe(201);
        const equipamentoCriado = equipamento.json<{ id: string; codigoBarrasInterno: string; versao: number }>();
        expect(equipamentoCriado.codigoBarrasInterno).toMatch(/^NTB-/);

        const equipamentoExternoResposta = await app.inject({
          method: "POST", url: "/equipamentos", headers: { authorization: `Bearer ${tokenAlmoxarife}` },
          payload: {
            tipo: TipoEquipamento.NOTEBOOK, marca: "Outra Marca", modelo: "Externo",
            anoFabricacao: 2021, estadoFisico: EstadoFisico.BOM_ESTADO, pesoQuilogramas: 2.1, loteId: outroLoteId
          }
        });
        expect(equipamentoExternoResposta.statusCode).toBe(201);
        const equipamentoExternoId = equipamentoExternoResposta.json<{ id: string }>().id;

        const triagemInicial = await app.inject({
          method: "POST", url: `/lotes/${loteId}/processar-triagem`,
          headers: { authorization: `Bearer ${tokenAlmoxarife}` }, payload: { versao: loteCriado.versao }
        });
        if (triagemInicial.statusCode !== 200) throw new Error(`triagem inicial: ${triagemInicial.statusCode} ${triagemInicial.body}`);
        expect(triagemInicial.statusCode).toBe(200);
        const loteEmTriagem = triagemInicial.json<{ statusProcessamento: string; versao: number }>();
        expect(loteEmTriagem.statusProcessamento).toBe("EM_TRIAGEM");

        const versaoAntiga = await app.inject({
          method: "PATCH", url: `/equipamentos/${equipamentoCriado.id}/estado`, headers: { authorization: `Bearer ${tokenAlmoxarife}` },
          payload: { estadoFisico: EstadoFisico.USADO_LEVE, versao: 1 }
        });
        expect(versaoAntiga.statusCode).toBe(409);

        const aguardandoDesmonte = await app.inject({
          method: "PATCH", url: `/equipamentos/${equipamentoCriado.id}/status`, headers: { authorization: `Bearer ${tokenAlmoxarife}` },
          payload: { statusRastreamento: StatusRastreamento.AGUARDANDO_DESMONTE, justificativa: "Triagem concluida", versao: 2 }
        });
        expect(aguardandoDesmonte.statusCode).toBe(200);
        const triagemConcluida = await app.inject({
          method: "POST", url: `/lotes/${loteId}/processar-triagem`,
          headers: { authorization: `Bearer ${tokenAlmoxarife}` }, payload: { versao: loteEmTriagem.versao }
        });
        if (triagemConcluida.statusCode !== 200) throw new Error(`triagem concluida: ${triagemConcluida.statusCode} ${triagemConcluida.body}`);
        expect(triagemConcluida.statusCode).toBe(200);
        expect(triagemConcluida.json<{ statusProcessamento: string }>().statusProcessamento).toBe("TRIAGEM_CONCLUIDA");
        const loteConcluidoVersao = triagemConcluida.json<{ versao: number }>().versao;
        const tentativaEditarLoteProcessado = await app.inject({
          method: "PUT", url: `/lotes/${loteId}`, headers: { authorization: `Bearer ${tokenAlmoxarife}` },
          payload: { dataEntrada: new Date().toISOString(), notaFiscal: `NF-${sufixo}`, transportadora: "Logistica de teste", versao: loteConcluidoVersao }
        });
        expect(tentativaEditarLoteProcessado.statusCode).toBe(409);
        const tentativaExcluirLoteProcessado = await app.inject({
          method: "DELETE", url: `/lotes/${loteId}`, headers: { authorization: `Bearer ${tokenAlmoxarife}` },
          payload: { versao: loteConcluidoVersao }
        });
        expect(tentativaExcluirLoteProcessado.statusCode).toBe(409);

        const emDesmonte = await app.inject({
          method: "PATCH", url: `/equipamentos/${equipamentoCriado.id}/status`, headers: { authorization: `Bearer ${tokenAlmoxarife}` },
          payload: { statusRastreamento: StatusRastreamento.EM_DESMONTE, justificativa: "Inicio do desmonte", versao: 3 }
        });
        if (emDesmonte.statusCode !== 200) throw new Error(`em desmonte: ${emDesmonte.statusCode} ${emDesmonte.body}`);
        expect(emDesmonte.statusCode).toBe(200);
        const primeiraMovimentacao = await app.inject({
          method: "POST", url: `/equipamentos/${equipamentoCriado.id}/movimentacoes`, headers: { authorization: `Bearer ${tokenAlmoxarife}` },
          payload: {
            destino: "Bancada de desmontagem", responsavel: "Equipe GreenCode", versao: 4,
            observacao: "Equipamento recebido para desmontagem"
          }
        });
        expect(primeiraMovimentacao.statusCode).toBe(201);
        expect(primeiraMovimentacao.json()).toMatchObject({ origem: "RECEBIMENTO", destino: "Bancada de desmontagem" });

        const segundaMovimentacao = await app.inject({
          method: "POST", url: `/equipamentos/${equipamentoCriado.id}/movimentacoes`, headers: { authorization: `Bearer ${tokenAlmoxarife}` },
          payload: {
            destino: "Area de separacao de componentes", responsavel: "Equipe de desmontagem", versao: 5,
            observacao: "Componentes separados para avaliacao e reaproveitamento"
          }
        });
        expect(segundaMovimentacao.statusCode).toBe(201);
        expect(segundaMovimentacao.json()).toMatchObject({
          origem: "Bancada de desmontagem",
          destino: "Area de separacao de componentes",
          responsavel: "Equipe de desmontagem"
        });
        const movimentacoesListadas = await app.inject({
          method: "GET", url: `/equipamentos/${equipamentoCriado.id}/movimentacoes`,
          headers: { authorization: `Bearer ${tokenAuditora}` }
        });
        expect(movimentacoesListadas.statusCode).toBe(200);
        expect(movimentacoesListadas.json()).toHaveLength(2);

        const equipamentoAntesDaAnalise = await app.inject({
          method: "GET", url: `/equipamentos/${equipamentoCriado.id}`,
          headers: { authorization: `Bearer ${tokenAlmoxarife}` }
        });
        const alteracaoEstado = await app.inject({
          method: "PATCH", url: `/equipamentos/${equipamentoCriado.id}/estado`,
          headers: { authorization: `Bearer ${tokenAlmoxarife}` },
          payload: {
            estadoFisico: EstadoFisico.USADO_LEVE,
            versao: equipamentoAntesDaAnalise.json<{ versao: number }>().versao,
            justificativa: "Avaliacao para jornada analitica"
          }
        });
        expect(alteracaoEstado.statusCode).toBe(200);

        const valorRecuperado = await app.inject({
          method: "POST", url: `/analises/equipamentos/${equipamentoCriado.id}/recuperacao`,
          headers: { authorization: `Bearer ${tokenAlmoxarife}` },
          payload: { valorRecuperado: 125.5, observacao: "Valor avaliado na triagem" }
        });
        expect(valorRecuperado.statusCode).toBe(201);
        expect(valorRecuperado.json()).toMatchObject({
          equipamentoId: equipamentoCriado.id,
          valorRecuperado: "125.5",
          estadoFisico: EstadoFisico.USADO_LEVE
        });
        const recuperacoesListadas = await app.inject({
          method: "GET", url: `/analises/equipamentos/${equipamentoCriado.id}/recuperacao`,
          headers: { authorization: `Bearer ${tokenAuditora}` }
        });
        expect(recuperacoesListadas.statusCode).toBe(200);
        expect(recuperacoesListadas.json().recuperacoes).toHaveLength(1);

        const periodoAnalise = {
          inicio: new Date(Date.now() - 60_000).toISOString(),
          fim: new Date(Date.now() + 60_000).toISOString()
        };
        const journalConsultado = await app.inject({
          method: "GET", url: `/journal?inicio=${encodeURIComponent(periodoAnalise.inicio)}&fim=${encodeURIComponent(periodoAnalise.fim)}`,
          headers: { authorization: `Bearer ${tokenAuditora}` }
        });
        expect(journalConsultado.statusCode).toBe(200);
        expect(journalConsultado.json().registros.some((item: { operacao: string }) => item.operacao === "REGISTRAR_MOVIMENTACAO")).toBe(true);
        const analiseEficiencia = await app.inject({
          method: "POST", url: "/analises/eficiencia-operacional",
          headers: { authorization: `Bearer ${tokenAuditora}` },
          payload: { periodo: periodoAnalise }
        });
        expect(analiseEficiencia.statusCode).toBe(201);
        expect(analiseEficiencia.json().resultado.lotesConcluidos).toBeGreaterThanOrEqual(1);

        const analiseRentabilidade = await app.inject({
          method: "POST", url: "/analises/rentabilidade",
          headers: { authorization: `Bearer ${tokenAuditora}` },
          payload: { periodo: periodoAnalise }
        });
        expect(analiseRentabilidade.statusCode).toBe(201);
        expect(analiseRentabilidade.json().resultado.equipamentosComValorReal).toBe(1);

        const analiseVidaUtil = await app.inject({
          method: "POST", url: "/analises/vida-util",
          headers: { authorization: `Bearer ${tokenAuditora}` },
          payload: { tipo: TipoEquipamento.NOTEBOOK }
        });
        expect(analiseVidaUtil.statusCode).toBe(201);
        const previsaoDoEquipamento = analiseVidaUtil.json().resultado.previsoes.find(
          (previsao: { equipamentoId: string }) => previsao.equipamentoId === equipamentoCriado.id
        );
        expect(previsaoDoEquipamento).toMatchObject({
          equipamentoId: equipamentoCriado.id,
          estadoAtual: EstadoFisico.USADO_LEVE,
          situacao: "PREVISAO"
        });

        const historicoAnalises = await app.inject({
          method: "GET", url: "/analises?limite=10",
          headers: { authorization: `Bearer ${tokenAuditora}` }
        });
        expect(historicoAnalises.statusCode).toBe(200);
        expect(historicoAnalises.json().resultados).toHaveLength(3);
        const consultaAnalise = await app.inject({
          method: "GET", url: `/analises/${analiseRentabilidade.json<{ id: string }>().id}`,
          headers: { authorization: `Bearer ${tokenAuditora}` }
        });
        expect(consultaAnalise.statusCode).toBe(200);
        expect(consultaAnalise.json().tipo).toBe("RENTABILIDADE_EQUIPAMENTO");

        const criarChaveParceiro = async (
          nome: string,
          permissoes: PermissaoChaveApi[],
          organizacaoIdChave = organizacaoId
        ) => {
          const resposta = await app.inject({
            method: "POST", url: "/auth/api-keys", headers: { authorization: `Bearer ${tokenAdmin}` },
            payload: { nome, organizacaoId: organizacaoIdChave, permissoes }
          });
          expect(resposta.statusCode).toBe(201);
          return resposta.json<{ id: string; chave: string; prefixo: string; permissoes: PermissaoChaveApi[]; versao: number }>();
        };
        const tentativaNaoAdministrativa = await app.inject({
          method: "POST", url: "/auth/api-keys", headers: { authorization: `Bearer ${tokenAuditora}` },
          payload: { nome: "Chave negada", organizacaoId, permissoes: [PermissaoChaveApi.LER_LOTES] }
        });
        expect(tentativaNaoAdministrativa.statusCode).toBe(403);
        const chaveRastreio = await criarChaveParceiro("Parceiro rastreio", [PermissaoChaveApi.RASTREAR_EQUIPAMENTO]);
        const chaveLerLotes = await criarChaveParceiro("Parceiro leitor de lotes", [PermissaoChaveApi.LER_LOTES]);
        const chaveEscreverLotes = await criarChaveParceiro("Parceiro escritor de lotes", [PermissaoChaveApi.ESCREVER_LOTES]);
        const chaveRelatorios = await criarChaveParceiro("Parceiro relatorios", [PermissaoChaveApi.GERAR_RELATORIOS_ANALITICOS]);
        const chaveRelatoriosOutraOrganizacao = await criarChaveParceiro(
          "Parceiro relatorios outra organizacao",
          [PermissaoChaveApi.GERAR_RELATORIOS_ANALITICOS],
          outraOrganizacaoId
        );
        const chaveRastreioAlternativa = await criarChaveParceiro("Parceiro rastreio alternativo", [PermissaoChaveApi.RASTREAR_EQUIPAMENTO]);
        const chaveExpiradaCriada = await app.inject({
          method: "POST", url: "/auth/api-keys", headers: { authorization: `Bearer ${tokenAdmin}` },
          payload: {
            nome: "Chave para teste de expiracao", organizacaoId,
            permissoes: [PermissaoChaveApi.RASTREAR_EQUIPAMENTO],
            expiraEm: new Date(Date.now() + 86_400_000).toISOString()
          }
        });
        expect(chaveExpiradaCriada.statusCode).toBe(201);
        const chaveExpirada = chaveExpiradaCriada.json<{ id: string; chave: string }>();
        await tx.chaveApi.update({ where: { id: chaveExpirada.id }, data: { expiraEm: new Date(Date.now() - 1_000) } });

        const segredoNoStore = await tx.chaveApi.findUnique({ where: { id: chaveRastreio.id } });
        expect(segredoNoStore?.hashChave).not.toBe(chaveRastreio.chave);
        expect(segredoNoStore?.hashChave).toHaveLength(64);
        const listagemChaves = await app.inject({ method: "GET", url: "/auth/api-keys", headers: { authorization: `Bearer ${tokenAdmin}` } });
        expect(listagemChaves.statusCode).toBe(200);
        expect(JSON.stringify(listagemChaves.json())).not.toContain(chaveRastreio.chave);
        expect(listagemChaves.json().chaves[0]).not.toHaveProperty("hashChave");
        const chaveEditada = await app.inject({
          method: "PUT", url: `/auth/api-keys/${chaveRastreioAlternativa.id}`,
          headers: { authorization: `Bearer ${tokenAdmin}` },
          payload: { nome: "Parceiro rastreio revisado", permissoes: [PermissaoChaveApi.RASTREAR_EQUIPAMENTO], expiraEm: null, versao: chaveRastreioAlternativa.versao }
        });
        expect(chaveEditada.statusCode).toBe(200);
        expect(chaveEditada.json()).toMatchObject({ nome: "Parceiro rastreio revisado", permissoes: [PermissaoChaveApi.RASTREAR_EQUIPAMENTO], versao: chaveRastreioAlternativa.versao + 1 });
        expect(chaveEditada.json()).not.toHaveProperty("chave");
        const chaveConsultada = await app.inject({
          method: "GET", url: `/auth/api-keys/${chaveRastreioAlternativa.id}`, headers: { authorization: `Bearer ${tokenAdmin}` }
        });
        expect(chaveConsultada.statusCode).toBe(200);
        expect(chaveConsultada.json()).not.toHaveProperty("hashChave");
        expect(chaveConsultada.json()).not.toHaveProperty("chave");
        const chaveVersaoAntiga = await app.inject({
          method: "PUT", url: `/auth/api-keys/${chaveRastreioAlternativa.id}`,
          headers: { authorization: `Bearer ${tokenAdmin}` },
          payload: { nome: "Alteracao obsoleta", permissoes: [PermissaoChaveApi.RASTREAR_EQUIPAMENTO], expiraEm: null, versao: chaveRastreioAlternativa.versao }
        });
        expect(chaveVersaoAntiga.statusCode).toBe(409);

        const chaveInvalida = await app.inject({ method: "GET", url: `/api/v1/public/equipamentos/${equipamentoCriado.id}/rastreabilidade`, headers: { "x-api-key": "gcp_live_chave-invalida" } });
        expect(chaveInvalida.statusCode).toBe(401);
        const usoChaveExpirada = await app.inject({
          method: "GET", url: `/api/v1/public/equipamentos/${equipamentoCriado.id}/rastreabilidade`,
          headers: { "x-api-key": chaveExpirada.chave }
        });
        expect(usoChaveExpirada.statusCode).toBe(401);
        const rastreioPublico = await app.inject({
          method: "GET", url: `/api/v1/public/equipamentos/${equipamentoCriado.id}/rastreabilidade`,
          headers: { "x-api-key": chaveRastreio.chave }
        });
        expect(rastreioPublico.statusCode).toBe(200);
        expect(rastreioPublico.json().dados.lote.id).toBe(loteId);
        const rastreioOutraOrganizacao = await app.inject({
          method: "GET", url: `/api/v1/public/equipamentos/${equipamentoExternoId}/rastreabilidade`,
          headers: { "x-api-key": chaveRastreio.chave }
        });
        expect(rastreioOutraOrganizacao.statusCode).toBe(404);

        const permissaoInsuficiente = await app.inject({
          method: "GET", url: `/api/v1/public/lotes/${loteId}`,
          headers: { "x-api-key": chaveRastreio.chave }
        });
        expect(permissaoInsuficiente.statusCode).toBe(403);
        const leituraLotePublica = await app.inject({
          method: "GET", url: `/api/v1/public/lotes/${loteId}`,
          headers: { "x-api-key": chaveLerLotes.chave }
        });
        expect(leituraLotePublica.statusCode).toBe(200);
        expect(leituraLotePublica.json().dados.organizacaoId).toBe(organizacaoId);
        const loteDeOutraOrganizacao = await app.inject({
          method: "GET", url: `/api/v1/public/lotes/${outroLoteId}`,
          headers: { "x-api-key": chaveLerLotes.chave }
        });
        expect(loteDeOutraOrganizacao.statusCode).toBe(404);
        const listaLotesPublica = await app.inject({
          method: "GET", url: `/api/v1/public/lotes?inicio=${encodeURIComponent(periodoAnalise.inicio)}&fim=${encodeURIComponent(periodoAnalise.fim)}`,
          headers: { "x-api-key": chaveLerLotes.chave }
        });
        expect(listaLotesPublica.statusCode).toBe(200);
        expect(listaLotesPublica.json().dados.every((item: { organizacaoId: string }) => item.organizacaoId === organizacaoId)).toBe(true);

        const escritaSemPermissao = await app.inject({
          method: "POST", url: "/api/v1/public/lotes", headers: { "x-api-key": chaveLerLotes.chave },
          payload: { notaFiscal: "NF-NEGADA", transportadora: "Parceiro" }
        });
        expect(escritaSemPermissao.statusCode).toBe(403);
        const novoLotePublico = await app.inject({
          method: "POST", url: "/api/v1/public/lotes", headers: { "x-api-key": chaveEscreverLotes.chave },
          payload: { notaFiscal: `NF-PUBLICA-${sufixo}`, transportadora: "Parceiro logistico" }
        });
        expect(novoLotePublico.statusCode).toBe(201);
        expect(novoLotePublico.json().dados.organizacaoId).toBe(organizacaoId);

        const valorExterno = await app.inject({
          method: "POST", url: `/analises/equipamentos/${equipamentoExternoId}/recuperacao`,
          headers: { authorization: `Bearer ${tokenAlmoxarife}` },
          payload: { valorRecuperado: 9999, observacao: "Avaliacao isolada da outra organizacao" }
        });
        expect(valorExterno.statusCode).toBe(201);

        const totalAnalisesAntesDaSolicitacao = await tx.resultadoAnalitico.count();
        const relatorioSemPermissao = await app.inject({
          method: "POST", url: "/api/v1/public/relatorios/analiticos",
          headers: { "x-api-key": chaveLerLotes.chave },
          payload: { tipo: "RENTABILIDADE_EQUIPAMENTO" }
        });
        expect(relatorioSemPermissao.statusCode).toBe(403);
        const periodoObrigatorio = await app.inject({
          method: "POST", url: "/api/v1/public/relatorios/analiticos",
          headers: { "x-api-key": chaveRelatorios.chave },
          payload: { tipo: "EFICIENCIA_OPERACIONAL" }
        });
        expect(periodoObrigatorio.statusCode).toBe(400);
        const relatorioPublico = await app.inject({
          method: "POST", url: "/api/v1/public/relatorios/analiticos",
          headers: { "x-api-key": chaveRelatorios.chave },
          payload: { tipo: "RENTABILIDADE_EQUIPAMENTO", periodo: periodoAnalise }
        });
        expect(relatorioPublico.statusCode).toBe(202);
        const respostaTarefa = relatorioPublico.json<{ dados: { tarefaId: string; status: string } }>();
        tarefaRelatorioId = respostaTarefa.dados.tarefaId;
        expect(respostaTarefa.dados.tarefaId).toMatch(/^[0-9a-f-]{36}$/i);
        expect(respostaTarefa.dados.status).toBe("AGUARDANDO");
        expect(await tx.resultadoAnalitico.count()).toBe(totalAnalisesAntesDaSolicitacao);
        const tarefaEnfileirada = await filaRelatorios.getJob(tarefaRelatorioId);
        expect(tarefaEnfileirada?.data).toMatchObject({
          tipo: TipoResultadoAnalitico.RENTABILIDADE_EQUIPAMENTO,
          organizacaoId,
          apiKeyId: chaveRelatorios.id,
          periodo: periodoAnalise
        });
        expect(await tarefaEnfileirada?.getState()).toBe("waiting");
        const statusAguardando = await app.inject({
          method: "GET", url: `/api/v1/public/relatorios/analiticos/${tarefaRelatorioId}`,
          headers: { "x-api-key": chaveRelatorios.chave }
        });
        expect(statusAguardando.statusCode).toBe(200);
        expect(statusAguardando.json().dados).toMatchObject({ tarefaId: tarefaRelatorioId, status: "AGUARDANDO" });
        const downloadAguardando = await app.inject({
          method: "GET", url: `/api/v1/public/relatorios/analiticos/${tarefaRelatorioId}/arquivo`,
          headers: { "x-api-key": chaveRelatorios.chave }
        });
        expect(downloadAguardando.statusCode).toBe(409);
        const statusSemPermissao = await app.inject({
          method: "GET", url: `/api/v1/public/relatorios/analiticos/${tarefaRelatorioId}`,
          headers: { "x-api-key": chaveLerLotes.chave }
        });
        expect(statusSemPermissao.statusCode).toBe(403);
        const statusOutraOrganizacao = await app.inject({
          method: "GET", url: `/api/v1/public/relatorios/analiticos/${tarefaRelatorioId}`,
          headers: { "x-api-key": chaveRelatoriosOutraOrganizacao.chave }
        });
        expect(statusOutraOrganizacao.statusCode).toBe(404);

        diretorioSaidaRelatorios = await mkdtemp(join(tmpdir(), "greencode-jornada-worker-"));
        process.env.REPORTS_DIRECTORY = diretorioSaidaRelatorios;
        workerRelatorios = criarWorkerRelatorios(criarProcessadorRelatorios({
          eficiencia: new ServicoAnaliseEficienciaPrisma(tx),
          rentabilidade: new ServicoAnaliseRentabilidadePrisma(transacionar, tx),
          vidaUtil: new ServicoAnaliseVidaUtilPrisma(tx)
        }, diretorioSaidaRelatorios), "redis://localhost:6379");
        const tarefaConcluida = new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error("Timeout aguardando processamento do relatório.")), 30_000);
          workerRelatorios!.once("completed", (job) => {
            clearTimeout(timeout);
            if (job.id === tarefaRelatorioId) resolve();
            else reject(new Error(`O worker processou uma tarefa inesperada: ${job.id}.`));
          });
          workerRelatorios!.once("failed", (job, erro) => {
            clearTimeout(timeout);
            reject(new Error(`A tarefa ${job?.id ?? "desconhecida"} falhou: ${erro.message}`));
          });
        });
        await workerRelatorios.waitUntilReady();
        await tarefaConcluida;

        const jobConcluido = await filaRelatorios.getJob(tarefaRelatorioId);
        expect(await jobConcluido?.getState()).toBe("completed");
        expect(jobConcluido?.returnvalue).toMatchObject({
          resultadoAnaliticoId: expect.any(String),
          arquivo: `${tarefaRelatorioId}.json`,
          tipo: TipoResultadoAnalitico.RENTABILIDADE_EQUIPAMENTO
        });
        expect(await tx.resultadoAnalitico.count()).toBe(totalAnalisesAntesDaSolicitacao + 1);
        expect(await tx.resultadoAnalitico.findMany({ where: { tarefaId: tarefaRelatorioId } })).toHaveLength(1);
        const arquivoRelatorio = JSON.parse(await readFile(
          join(diretorioSaidaRelatorios, `${tarefaRelatorioId}.json`), "utf8"
        ));
        expect(arquivoRelatorio).toMatchObject({
          tarefaId: tarefaRelatorioId,
          resultadoAnaliticoId: jobConcluido?.returnvalue.resultadoAnaliticoId,
          tipo: TipoResultadoAnalitico.RENTABILIDADE_EQUIPAMENTO,
          resultado: { equipamentosComValorReal: 1 }
        });
        const statusConcluido = await app.inject({
          method: "GET", url: `/api/v1/public/relatorios/analiticos/${tarefaRelatorioId}`,
          headers: { "x-api-key": chaveRelatorios.chave }
        });
        expect(statusConcluido.statusCode).toBe(200);
        expect(statusConcluido.json().dados).toMatchObject({
          tarefaId: tarefaRelatorioId,
          status: "CONCLUIDA",
          progresso: 100,
          relatorioDisponivel: true,
          resultadoAnaliticoId: jobConcluido?.returnvalue.resultadoAnaliticoId
        });
        const downloadConcluido = await app.inject({
          method: "GET", url: `/api/v1/public/relatorios/analiticos/${tarefaRelatorioId}/arquivo`,
          headers: { "x-api-key": chaveRelatorios.chave }
        });
        expect(downloadConcluido.statusCode).toBe(200);
        expect(downloadConcluido.headers["content-type"]).toContain("application/json");
        expect(downloadConcluido.headers["content-disposition"]).toContain(`${tarefaRelatorioId}.json`);
        expect(JSON.parse(downloadConcluido.body)).toMatchObject({ tarefaId: tarefaRelatorioId });
        const downloadOutraOrganizacao = await app.inject({
          method: "GET", url: `/api/v1/public/relatorios/analiticos/${tarefaRelatorioId}/arquivo`,
          headers: { "x-api-key": chaveRelatoriosOutraOrganizacao.chave }
        });
        expect(downloadOutraOrganizacao.statusCode).toBe(404);

        await workerRelatorios.close();
        workerRelatorios = undefined;
        const tarefaRetryId = randomUUID();
        tarefasDaJornada.push(tarefaRetryId);
        let execucoesRetry = 0;
        const processadorComFalhaTransitória = criarProcessadorRelatorios({
          eficiencia: new ServicoAnaliseEficienciaPrisma(tx),
          rentabilidade: new ServicoAnaliseRentabilidadePrisma(transacionar, tx),
          vidaUtil: new ServicoAnaliseVidaUtilPrisma(tx)
        }, diretorioSaidaRelatorios);
        workerRelatorios = criarWorkerRelatorios(async (job) => {
          const resultado = await processadorComFalhaTransitória(job);
          execucoesRetry += 1;
          if (execucoesRetry === 1) throw new Error("falha temporaria depois de persistir");
          return resultado;
        }, "redis://localhost:6379");
        await filaRelatorios.add(NOME_JOB_RELATORIO_ANALITICO, {
          tipo: TipoResultadoAnalitico.RENTABILIDADE_EQUIPAMENTO,
          organizacaoId,
          apiKeyId: chaveRelatorios.id
        }, { jobId: tarefaRetryId });
        const tarefaRetryConcluida = new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error("Timeout aguardando retentativa do relatorio.")), 20_000);
          workerRelatorios!.once("completed", (job) => {
            clearTimeout(timeout);
            if (job.id === tarefaRetryId) resolve();
            else reject(new Error(`O worker concluiu uma tarefa inesperada: ${job.id}.`));
          });
        });
        await workerRelatorios.waitUntilReady();
        await tarefaRetryConcluida;
        const resultadosDaTarefaRetry = await tx.resultadoAnalitico.findMany({ where: { tarefaId: tarefaRetryId } });
        expect(execucoesRetry).toBe(2);
        expect(resultadosDaTarefaRetry).toHaveLength(1);
        expect(await tx.resultadoAnalitico.count()).toBe(totalAnalisesAntesDaSolicitacao + 2);
        await workerRelatorios.close();
        workerRelatorios = undefined;

        const tarefaFalhaId = randomUUID();
        tarefasDaJornada.push(tarefaFalhaId);
        await filaRelatorios.add(NOME_JOB_RELATORIO_ANALITICO, {
          tipo: TipoResultadoAnalitico.RENTABILIDADE_EQUIPAMENTO,
          organizacaoId,
          apiKeyId: chaveRelatorios.id
        }, { jobId: tarefaFalhaId });
        const workerFalha = criarWorkerRelatorios(async () => {
          throw new Error("detalhe interno simulado");
        }, "redis://localhost:6379");
        const tarefaFalhou = new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error("Timeout aguardando falha simulada.")), 15_000);
          workerFalha.on("failed", (job) => {
            if (job?.id === tarefaFalhaId && job.attemptsMade < (job.opts.attempts ?? 1)) return;
            clearTimeout(timeout);
            if (job?.id === tarefaFalhaId) resolve();
            else reject(new Error("O worker falhou uma tarefa inesperada."));
          });
        });
        try {
          await workerFalha.waitUntilReady();
          await tarefaFalhou;
        } finally {
          await workerFalha.close();
        }
        const statusFalhou = await app.inject({
          method: "GET", url: `/api/v1/public/relatorios/analiticos/${tarefaFalhaId}`,
          headers: { "x-api-key": chaveRelatorios.chave }
        });
        expect(statusFalhou.statusCode).toBe(200);
        expect(statusFalhou.json().dados).toMatchObject({
          tarefaId: tarefaFalhaId,
          status: "FALHOU",
          erro: "A tarefa falhou durante o processamento."
        });
        const jobFalho = await filaRelatorios.getJob(tarefaFalhaId);
        await jobFalho?.remove();

        const docs = await app.inject({ method: "GET", url: "/docs/" });
        expect(docs.statusCode).toBe(200);
        expect(docs.body).toContain("SwaggerUIBundle");
        const assetSwagger = await app.inject({ method: "GET", url: "/docs/swagger-ui-bundle.js" });
        expect(assetSwagger.statusCode).toBe(200);
        expect(assetSwagger.headers["content-type"]).toContain("text/javascript");
        const specPublica = await app.inject({ method: "GET", url: "/docs/json" });
        expect(specPublica.statusCode).toBe(200);
        expect(specPublica.headers["content-type"]).toContain("application/json");
        expect(specPublica.json().paths["/api/v1/public/lotes"].post.security).toEqual([{ apiKeyAuth: [] }]);
        expect(specPublica.json().paths["/api/v1/public/relatorios/analiticos"].post.responses).toHaveProperty("202");
        expect(specPublica.json().paths["/api/v1/public/relatorios/analiticos/{tarefaId}"].get.responses).toHaveProperty("200");
        expect(specPublica.json().paths["/api/v1/public/relatorios/analiticos/{tarefaId}/arquivo"].get.responses).toHaveProperty("200");
        expect(specPublica.json().paths["/organizacoes/{id}"]).toHaveProperty("put");
        expect(specPublica.json().paths["/contratos/{id}"]).toHaveProperty("delete");
        expect(specPublica.json().paths["/lotes/{id}"]).toHaveProperty("put");
        expect(specPublica.json().paths["/equipamentos/{id}"]).toHaveProperty("delete");

        let bloqueioRateLimit: number | undefined;
        for (let tentativa = 0; tentativa < 61 && bloqueioRateLimit === undefined; tentativa += 1) {
          const resposta = await app.inject({
            method: "GET", url: `/api/v1/public/equipamentos/${equipamentoCriado.id}/rastreabilidade`,
            headers: { "x-api-key": chaveRastreio.chave }
          });
          if (resposta.statusCode === 429) bloqueioRateLimit = resposta.statusCode;
        }
        expect(bloqueioRateLimit).toBe(429);
        const rateLimitIndependente = await app.inject({
          method: "GET", url: `/api/v1/public/equipamentos/${equipamentoCriado.id}/rastreabilidade`,
          headers: { "x-api-key": chaveRastreioAlternativa.chave }
        });
        expect(rateLimitIndependente.statusCode).toBe(200);

        const chaveRevogada = await app.inject({
          method: "DELETE", url: `/auth/api-keys/${chaveRastreioAlternativa.id}`,
          headers: { authorization: `Bearer ${tokenAdmin}` }
        });
        expect(chaveRevogada.statusCode).toBe(200);
        const chaveRevogadaNovamente = await app.inject({
          method: "DELETE", url: `/auth/api-keys/${chaveRastreioAlternativa.id}`,
          headers: { authorization: `Bearer ${tokenAdmin}` }
        });
        expect(chaveRevogadaNovamente.statusCode).toBe(404);
        const usoDepoisDeRevogada = await app.inject({
          method: "GET", url: `/api/v1/public/equipamentos/${equipamentoCriado.id}/rastreabilidade`,
          headers: { "x-api-key": chaveRastreioAlternativa.chave }
        });
        expect(usoDepoisDeRevogada.statusCode).toBe(401);

        const rastreabilidade = await app.inject({ method: "GET", url: `/equipamentos/${equipamentoCriado.id}/rastreabilidade`, headers: { authorization: `Bearer ${tokenAuditora}` } });
        if (rastreabilidade.statusCode !== 200) throw new Error(`rastreabilidade: ${rastreabilidade.statusCode} ${rastreabilidade.body}`);
        expect(rastreabilidade.statusCode).toBe(200);
        expect(rastreabilidade.json().equipamento.movimentacoes).toHaveLength(2);
        expect(rastreabilidade.json().equipamento.movimentacoes).toMatchObject([
          { origem: "RECEBIMENTO", destino: "Bancada de desmontagem" },
          { origem: "Bancada de desmontagem", destino: "Area de separacao de componentes" }
        ]);

        const relatorioOrganizacao = await app.inject({
          method: "GET", url: `/relatorios/organizacao?organizacaoId=${organizacaoId}&inicio=${dataHoje}&fim=${amanha}`,
          headers: { authorization: `Bearer ${tokenAuditora}` }
        });
        expect(relatorioOrganizacao.statusCode).toBe(200);
        expect(relatorioOrganizacao.json<{ relatorio: string }>().relatorio).toContain(loteId);

        const relatorioStatus = await app.inject({ method: "GET", url: "/relatorios/status?status=EM_DESMONTE", headers: { authorization: `Bearer ${tokenAuditora}` } });
        expect(relatorioStatus.statusCode).toBe(200);
        expect(relatorioStatus.json<{ relatorio: string }>().relatorio).toContain(equipamentoCriado.codigoBarrasInterno);

        const relatorioFinanceiro = await app.inject({ method: "GET", url: `/relatorios/financeiro?inicio=${dataHoje}&fim=${amanha}`, headers: { authorization: `Bearer ${tokenAuditora}` } });
        expect(relatorioFinanceiro.statusCode).toBe(200);
        expect(relatorioFinanceiro.json<{ relatorio: string }>().relatorio).toContain("R$ 1500.00");

        const acessoNegado = await app.inject({ method: "POST", url: "/organizacoes", headers: { authorization: `Bearer ${tokenAuditora}` }, payload: organizacaoPayload });
        expect(acessoNegado.statusCode).toBe(403);

        const organizacoesListadas = await app.inject({ method: "GET", url: "/organizacoes", headers: { authorization: `Bearer ${tokenAuditora}` } });
        expect(organizacoesListadas.statusCode).toBe(200);
        expect(organizacoesListadas.json().some((item: { id: string }) => item.id === organizacaoId)).toBe(true);
        const organizacaoAtualizada = await app.inject({
          method: "PUT", url: `/organizacoes/${organizacaoId}`, headers: { authorization: `Bearer ${tokenOperador}` },
          payload: { ...organizacaoPayload, versao: organizacaoCriada.versao }
        });
        expect(organizacaoAtualizada.statusCode).toBe(200);
        expect(organizacaoAtualizada.json()).toMatchObject({ id: organizacaoId, versao: organizacaoCriada.versao + 1 });

        const contratosListados = await app.inject({
          method: "GET", url: `/contratos?organizacaoId=${organizacaoId}`, headers: { authorization: `Bearer ${tokenAuditora}` }
        });
        expect(contratosListados.statusCode).toBe(200);
        expect(contratosListados.json().some((item: { id: string }) => item.id === contratoCriado.id)).toBe(true);
        const contratoConsultado = await app.inject({ method: "GET", url: `/contratos/${contratoCriado.id}`, headers: { authorization: `Bearer ${tokenAuditora}` } });
        expect(contratoConsultado.statusCode).toBe(200);
        const contratoAtualizado = await app.inject({
          method: "PUT", url: `/contratos/${contratoCriado.id}`, headers: { authorization: `Bearer ${tokenOperador}` },
          payload: { dataVencimento: vencimento.toISOString(), clausulas: ["Contrato revisado"], valorMensal: 1600,
            renovacaoAutomatica: false, versao: contratoCriado.versao }
        });
        expect(contratoAtualizado.statusCode).toBe(200);
        const contratoExcluido = await app.inject({
          method: "DELETE", url: `/contratos/${contratoCriado.id}`, headers: { authorization: `Bearer ${tokenOperador}` },
          payload: { versao: contratoAtualizado.json<{ versao: number }>().versao }
        });
        expect(contratoExcluido.statusCode).toBe(200);

        const loteDescartavelResposta = await app.inject({
          method: "POST", url: "/lotes", headers: { authorization: `Bearer ${tokenAlmoxarife}` },
          payload: { dataEntrada: new Date().toISOString(), organizacaoId, notaFiscal: `NF-CRUD-${sufixo}`, transportadora: "Teste CRUD" }
        });
        expect(loteDescartavelResposta.statusCode).toBe(201);
        const loteDescartavel = loteDescartavelResposta.json<{ id: string; versao: number }>();
        const lotesListados = await app.inject({ method: "GET", url: "/lotes?skip=0&take=500", headers: { authorization: `Bearer ${tokenAuditora}` } });
        expect(lotesListados.statusCode).toBe(200);
        expect(lotesListados.json().some((item: { id: string }) => item.id === loteDescartavel.id)).toBe(true);
        const loteAtualizado = await app.inject({
          method: "PUT", url: `/lotes/${loteDescartavel.id}`, headers: { authorization: `Bearer ${tokenAlmoxarife}` },
          payload: { dataEntrada: new Date().toISOString(), notaFiscal: `NF-CRUD-REV-${sufixo}`, transportadora: "Transportadora revisada",
            observacoes: "Registro atualizado", versao: loteDescartavel.versao }
        });
        expect(loteAtualizado.statusCode).toBe(200);
        const loteExcluido = await app.inject({
          method: "DELETE", url: `/lotes/${loteDescartavel.id}`, headers: { authorization: `Bearer ${tokenAlmoxarife}` },
          payload: { versao: loteAtualizado.json<{ versao: number }>().versao }
        });
        expect(loteExcluido.statusCode).toBe(200);

        const equipamentosListados = await app.inject({ method: "GET", url: `/equipamentos?loteId=${loteId}`, headers: { authorization: `Bearer ${tokenAuditora}` } });
        expect(equipamentosListados.statusCode).toBe(200);
        expect(equipamentosListados.json().some((item: { id: string }) => item.id === equipamentoCriado.id)).toBe(true);
        const equipamentoAtual = await app.inject({ method: "GET", url: `/equipamentos/${equipamentoCriado.id}`, headers: { authorization: `Bearer ${tokenAuditora}` } });
        const equipamentoAtualizado = await app.inject({
          method: "PUT", url: `/equipamentos/${equipamentoCriado.id}`, headers: { authorization: `Bearer ${tokenAlmoxarife}` },
          payload: { marca: "GreenCode revisada", modelo: "Modelo API revisto", anoFabricacao: 2022, pesoQuilogramas: 2.6,
            versao: equipamentoAtual.json<{ versao: number }>().versao }
        });
        expect(equipamentoAtualizado.statusCode).toBe(200);
        const equipamentoBaixado = await app.inject({
          method: "DELETE", url: `/equipamentos/${equipamentoCriado.id}`, headers: { authorization: `Bearer ${tokenAlmoxarife}` },
          payload: { versao: equipamentoAtualizado.json<{ versao: number }>().versao, justificativa: "Baixa solicitada no teste CRUD" }
        });
        expect(equipamentoBaixado.statusCode).toBe(200);
        expect(equipamentoBaixado.json()).toMatchObject({ statusRastreamento: StatusRastreamento.BAIXA_DEFINITIVA });

        const usuarioTemporario = await app.inject({
          method: "POST", url: "/auth/usuarios", headers: { authorization: `Bearer ${tokenAdmin}` },
          payload: { usuario: `crud-${sufixo}`, senha: senhaUsuario, papel: PapelUsuario.OPERADOR_CADASTRO }
        });
        expect(usuarioTemporario.statusCode).toBe(201);
        const usuarioCriado = usuarioTemporario.json<{ id: string; versao: number }>();
        expect(usuarioTemporario.json()).not.toHaveProperty("hashSenha");
        const usuarioConsultado = await app.inject({ method: "GET", url: `/auth/usuarios/${usuarioCriado.id}`, headers: { authorization: `Bearer ${tokenAdmin}` } });
        expect(usuarioConsultado.statusCode).toBe(200);
        expect(usuarioConsultado.json()).not.toHaveProperty("hashSenha");
        const usuarioForaDoEscopo = await app.inject({ method: "GET", url: `/auth/usuarios/${usuarioCriado.id}`, headers: { authorization: `Bearer ${tokenOperador}` } });
        expect(usuarioForaDoEscopo.statusCode).toBe(404);
        const usuarioAtualizado = await app.inject({
          method: "PUT", url: `/auth/usuarios/${usuarioCriado.id}`, headers: { authorization: `Bearer ${tokenAdmin}` },
          payload: { usuario: `crud-editado-${sufixo}`, papel: PapelUsuario.AUDITORIA, versao: usuarioCriado.versao }
        });
        expect(usuarioAtualizado.statusCode).toBe(200);
        expect(usuarioAtualizado.json()).toMatchObject({ papel: PapelUsuario.AUDITORIA, versao: usuarioCriado.versao + 1 });
        expect(usuarioAtualizado.json()).not.toHaveProperty("hashSenha");
        const usuarioExcluido = await app.inject({
          method: "DELETE", url: `/auth/usuarios/${usuarioCriado.id}`, headers: { authorization: `Bearer ${tokenAdmin}` },
          payload: { versao: usuarioAtualizado.json<{ versao: number }>().versao }
        });
        expect(usuarioExcluido.statusCode).toBe(200);
        expect(usuarioExcluido.json()).toMatchObject({ ativo: false });

        const organizacaoDesativada = await app.inject({
          method: "DELETE", url: `/organizacoes/${organizacaoId}`, headers: { authorization: `Bearer ${tokenOperador}` },
          payload: { versao: organizacaoAtualizada.json<{ versao: number }>().versao }
        });
        expect(organizacaoDesativada.statusCode).toBe(200);
        expect(organizacaoDesativada.json()).toMatchObject({ ativo: false });
        const eventosCrud = await app.inject({
          method: "GET", url: `/journal?inicio=${encodeURIComponent(periodoAnalise.inicio)}&fim=${encodeURIComponent(periodoAnalise.fim)}`,
          headers: { authorization: `Bearer ${tokenAuditora}` }
        });
        const operacoesJournal = eventosCrud.json().registros.map((item: { operacao: string }) => item.operacao);
        expect(operacoesJournal).toEqual(expect.arrayContaining([
          "CRIAR_USUARIO", "ATUALIZAR_USUARIO", "DESATIVAR_USUARIO", "ATUALIZAR_ORGANIZACAO",
          "ATUALIZAR_CONTRATO", "EXCLUIR_CONTRATO", "ATUALIZAR_LOTE", "EXCLUIR_LOTE",
          "ATUALIZAR_DADOS_EQUIPAMENTO", "BAIXAR_EQUIPAMENTO", "ATUALIZAR_CHAVE_API"
        ]));
      } finally {
        await app.close();
      }
      throw abortar;
    }, { timeout: 60_000 }).catch((erro: unknown) => {
      if (erro !== abortar) throw erro;
    }).finally(async () => {
      await workerRelatorios?.close();
      for (const tarefaId of [tarefaRelatorioId, ...tarefasDaJornada]) {
        if (!tarefaId) continue;
        const tarefa = await filaRelatorios.getJob(tarefaId);
        await tarefa?.remove();
      }
      await filaRelatorios.close();
      for (const { id } of AGENDAMENTOS_ANALITICOS) await filaAnalisesAgendadas.removeJobScheduler(id);
      await filaAnalisesAgendadas.close();
      if (diretorioSaidaRelatorios) {
        await rm(diretorioSaidaRelatorios, { recursive: true, force: true });
      }
      if (diretorioRelatoriosOriginal === undefined) delete process.env.REPORTS_DIRECTORY;
      else process.env.REPORTS_DIRECTORY = diretorioRelatoriosOriginal;
    });
  }, 60000);
});
