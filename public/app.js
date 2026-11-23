const $ = (selector, parent = document) => parent.querySelector(selector);
const $$ = (selector, parent = document) => [...parent.querySelectorAll(selector)];
const TOKEN_KEY = "greencode.accessToken";
const ROLES = {
  ADMINISTRADOR: "Administrador",
  OPERADOR_CADASTRO: "Operador de cadastro",
  GESTOR_ALMOXARIFADO: "Gestor de almoxarifado",
  AUDITORIA: "Auditoria"
};
const ENUMS = {
  papel: Object.keys(ROLES),
  statusLote: ["RECEBIDO", "EM_TRIAGEM", "TRIAGEM_CONCLUIDA", "ENCAMINHADO", "FINALIZADO"],
  tipoEquipamento: ["COMPUTADOR_MESA", "NOTEBOOK", "MONITOR", "IMPRESSORA", "SERVIDOR", "ROTEADOR", "CABO_ESTRUTURADO", "FONTE_ALIMENTACAO"],
  estadoFisico: ["NOVO", "BOM_ESTADO", "USADO_LEVE", "USADO_MODERADO", "DANIFICADO_LEVE", "DANIFICADO_GRAVE", "INSERVIVEL"],
  statusRastreamento: ["AGUARDANDO_TRIAGEM", "EM_TRIAGEM", "AGUARDANDO_DESMONTE", "EM_DESMONTE", "PECAS_REAPROVEITADAS", "MATERIAL_RECICLAVEL", "DESCARTE_SEGURO", "BAIXA_DEFINITIVA"],
  permissoesApi: ["RASTREAR_EQUIPAMENTO", "LER_LOTES", "ESCREVER_LOTES", "GERAR_RELATORIOS_ANALITICOS"],
  tipoAnalise: ["EFICIENCIA_OPERACIONAL", "RENTABILIDADE_EQUIPAMENTO", "VIDA_UTIL_PREDITIVA"]
};
const state = { token: sessionStorage.getItem(TOKEN_KEY), user: null, view: "dashboard", rows: [], submitDialog: null };
const viewTitles = { dashboard: "Visão geral", organizacoes: "Organizações", contratos: "Contratos", lotes: "Lotes", equipamentos: "Equipamentos", usuarios: "Usuários", analises: "Análises", chaves: "Chaves de API" };

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}
function label(value) {
  return String(value ?? "—").replaceAll("_", " ").toLocaleLowerCase("pt-BR").replace(/(^|\s)\S/g, (letter) => letter.toLocaleUpperCase("pt-BR"));
}
function date(value) { return value ? new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium" }).format(new Date(value)) : "—"; }
function currency(value) { return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(value ?? 0)); }
function canOrg() { return ["ADMINISTRADOR", "OPERADOR_CADASTRO"].includes(state.user?.papel); }
function canStock() { return ["ADMINISTRADOR", "GESTOR_ALMOXARIFADO"].includes(state.user?.papel); }
function isAdmin() { return state.user?.papel === "ADMINISTRADOR"; }

async function api(path, options = {}) {
  const headers = new Headers(options.headers || {});
  headers.set("Accept", "application/json");
  if (state.token) headers.set("Authorization", `Bearer ${state.token}`);
  if (options.body !== undefined && !(options.body instanceof FormData)) headers.set("Content-Type", "application/json");
  const response = await fetch(path, { ...options, headers, body: options.body instanceof FormData ? options.body : options.body === undefined ? undefined : JSON.stringify(options.body) });
  const contentType = response.headers.get("content-type") || "";
  const result = contentType.includes("application/json") ? await response.json() : await response.text();
  if (response.status === 401 && path !== "/auth/login") {
    logout();
    throw new Error("Sua sessão expirou. Entre novamente.");
  }
  if (!response.ok) throw new Error(result?.erro || result?.message || `A solicitação falhou (${response.status}).`);
  return result;
}
function toast(message, kind = "success") {
  const node = document.createElement("div");
  node.className = `toast${kind === "error" ? " error" : ""}`;
  node.textContent = message;
  $("#toast-region").append(node);
  setTimeout(() => node.remove(), 4600);
}
function showLogin(error = "") {
  $("#login-screen").hidden = false;
  $("#app-screen").hidden = true;
  $("#login-error").textContent = error;
  $("#login-error").hidden = !error;
  if (error) $("#login-password").focus();
}
function logout() {
  state.token = null;
  state.user = null;
  sessionStorage.removeItem(TOKEN_KEY);
  showLogin();
}
function updateAccount() {
  $("#account-name").textContent = state.user.usuario;
  $("#account-role").textContent = ROLES[state.user.papel] || label(state.user.papel);
  $("#user-avatar").textContent = state.user.usuario.slice(0, 2).toUpperCase();
  $$(".admin-only").forEach((node) => { node.hidden = !isAdmin(); });
  $("#topbar-date").textContent = new Intl.DateTimeFormat("pt-BR", { dateStyle: "full" }).format(new Date());
}
function normalizeRows(value, key) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.[key])) return value[key];
  if (Array.isArray(value?.dados)) return value.dados;
  return [];
}
function header(title, description, action = "") {
  return `<div class="page-heading"><div><div class="page-kicker">GreenCode · gestão circular</div><h1>${esc(title)}</h1><p>${esc(description)}</p></div>${action ? `<div class="heading-actions">${action}</div>` : ""}</div>`;
}
function loading() { return '<div class="loading-state"><span class="spinner"></span> Carregando informações…</div>'; }
function empty(title, subtitle = "Os registros aparecerão aqui depois do primeiro cadastro.") {
  return `<div class="empty-state"><div><span class="empty-symbol">◈</span><strong>${esc(title)}</strong><p>${esc(subtitle)}</p></div></div>`;
}
function actionButton(action, id, text, danger = false, disabled = false) {
  return `<button class="table-action${danger ? " danger" : ""}" data-action="${esc(action)}" data-id="${esc(id)}"${disabled ? " disabled" : ""}>${esc(text)}</button>`;
}
function tableCard(columns, rows, countLabel = "registros") {
  if (!rows.length) return `<div class="table-card">${empty("Nenhum registro encontrado.")}</div>`;
  return `<div class="table-card"><div class="table-toolbar"><p>${rows.length} ${countLabel}</p><input class="table-search" type="search" placeholder="Buscar nesta lista…" aria-label="Buscar registros" /></div><div class="table-wrap"><table><thead><tr>${columns.map((c) => `<th>${esc(c.title)}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${columns.map((c) => `<td>${c.render(row)}</td>`).join("")}</tr>`).join("")}</tbody></table></div></div>`;
}
function statusBadge(value) {
  const warning = /EM_|AGUARDANDO/.test(value || "");
  const neutral = /BAIXA|FINALIZADO|INATIVO|REVOGADO/.test(value || "");
  return `<span class="badge${warning ? " warn" : neutral ? " neutral" : ""}">${esc(label(value))}</span>`;
}
function setView(view) {
  if (view === "chaves" && !isAdmin()) return;
  state.view = view;
  $("#breadcrumb-current").textContent = viewTitles[view] || viewTitles.dashboard;
  $$(".nav-link").forEach((item) => item.classList.toggle("is-active", item.dataset.view === view));
  $("#sidebar").classList.remove("is-open");
  $("#sidebar-backdrop").classList.remove("is-open");
  renderView();
}
async function renderView() {
  const target = $("#page-content");
  target.innerHTML = loading();
  try {
    switch (state.view) {
      case "organizacoes": return await renderOrganizations();
      case "contratos": return await renderContracts();
      case "lotes": return await renderLots();
      case "equipamentos": return await renderEquipment();
      case "usuarios": return await renderUsers();
      case "analises": return await renderAnalytics();
      case "chaves": return await renderKeys();
      default: return await renderDashboard();
    }
  } catch (error) {
    target.innerHTML = `${header(viewTitles[state.view] || "GreenCode", "Não foi possível carregar os dados.")}<div class="table-card">${empty("Ocorreu um erro", error.message)}</div>`;
  }
}

async function renderDashboard() {
  const [orgs, lots, equipment, contracts] = await Promise.all([
    api("/organizacoes?take=500").then((x) => normalizeRows(x, "organizacoes")),
    api("/lotes?take=500").then((x) => normalizeRows(x, "lotes")),
    api("/equipamentos?take=500").then((x) => normalizeRows(x, "equipamentos")),
    api("/contratos?take=500").then((x) => normalizeRows(x, "contratos"))
  ]);
  const statusCounts = ENUMS.statusLote.map((status) => ({ status, total: lots.filter((x) => x.statusProcessamento === status).length })).filter((x) => x.total);
  const maxStatus = Math.max(1, ...statusCounts.map((x) => x.total));
  $("#page-content").innerHTML = `${header("Visão geral", `Olá, ${state.user.usuario}. Aqui está um resumo da operação.`, '<button class="button button-secondary" data-action="refresh">↻ Atualizar</button>')}
    <section class="stats-grid">
      ${stat("Organizações ativas", orgs.length, "Parceiros cadastrados", "⌂")}${stat("Contratos", contracts.length, "Acordos vigentes", "▤")}${stat("Lotes recebidos", lots.length, "Entradas registradas", "▦")}${stat("Equipamentos", equipment.length, "Itens rastreáveis", "◈")}
    </section>
    <section class="dashboard-grid"><article class="panel"><div class="panel-heading"><div><h2>Fluxo de triagem</h2><p>Distribuição dos lotes por etapa de processamento</p></div><button class="text-link" data-view="lotes">Ver lotes →</button></div>
    ${statusCounts.length ? `<div class="status-list">${statusCounts.map((item) => `<div class="status-row"><div><div class="status-label"><span>${esc(label(item.status))}</span><strong>${item.total}</strong></div><div class="progress-track"><div class="progress-fill" style="width:${Math.max(5, item.total / maxStatus * 100)}%"></div></div></div><span class="status-total">${Math.round(item.total / lots.length * 100)}%</span></div>`).join("")}</div>` : empty("Ainda não há lotes", "Cadastre um lote para acompanhar o fluxo operacional.")}</article>
    <article class="panel"><div class="panel-heading"><div><h2>Acesso rápido</h2><p>Continue de onde a operação precisa</p></div></div><div class="activity-list"><div class="activity-item"><span class="activity-mark"></span><div class="activity-copy"><strong>Registrar uma nova entrada</strong><small>Cadastre um lote recebido de um parceiro</small></div>${actionButton("new-lot", "", "Abrir")}</div><div class="activity-item"><span class="activity-mark"></span><div class="activity-copy"><strong>Consultar rastreabilidade</strong><small>Busque equipamentos e seu histórico</small></div>${actionButton("goto-equipment", "", "Abrir")}</div><div class="activity-item"><span class="activity-mark"></span><div class="activity-copy"><strong>Gerar análise</strong><small>Explore eficiência, rentabilidade e vida útil</small></div>${actionButton("goto-analytics", "", "Abrir")}</div></div></article></section>`;
}
function stat(title, number, caption, icon) { return `<article class="stat-card"><div class="stat-top">${esc(title)}<span class="stat-icon">${icon}</span></div><div class="stat-number">${Number(number).toLocaleString("pt-BR")}</div><div class="stat-caption">${esc(caption)}</div></article>`; }

const organizations = {
  title: "Organizações", path: "/organizacoes?take=500", key: "organizacoes", createRoles: ["ADMINISTRADOR", "OPERADOR_CADASTRO"],
  fields: [{ name: "razaoSocial", label: "Razão social", required: true, wide: true }, { name: "cnpj", label: "CNPJ", required: true }, { name: "inscricaoEstadual", label: "Inscrição estadual", required: true }, { name: "enderecoCompleto", label: "Endereço completo", required: true, wide: true }, { name: "telefone", label: "Telefone", required: true }, { name: "email", label: "E-mail", type: "email", required: true }],
  cols: [{ title: "Organização", render: (x) => `<strong>${esc(x.razaoSocial)}</strong><small>${esc(x.cnpj)}</small>` }, { title: "Contato", render: (x) => `${esc(x.email)}<small>${esc(x.telefone)}</small>` }, { title: "Endereço", render: (x) => esc(x.enderecoCompleto) }, { title: "Status", render: (x) => statusBadge(x.ativo ? "ATIVA" : "INATIVA") }, { title: "Ações", render: (x) => `<div class="table-actions">${actionButton("edit", x.id, "Editar", false, !canOrg())}${actionButton("delete", x.id, "Desativar", true, !canOrg())}</div>` }],
  body: (d) => ({ razaoSocial: d.razaoSocial, cnpj: d.cnpj, inscricaoEstadual: d.inscricaoEstadual, enderecoCompleto: d.enderecoCompleto, telefone: d.telefone, email: d.email })
};
async function renderOrganizations() { await renderCrud(organizations, "Gerencie organizações parceiras e seus dados de contato.", canOrg() ? '<button class="button button-primary" data-action="create">+ Nova organização</button>' : ""); }

const contracts = {
  title: "Contratos", path: "/contratos?take=500", key: "contratos", createRoles: ["ADMINISTRADOR", "OPERADOR_CADASTRO"],
  fields: async () => [{ name: "organizacaoId", label: "Organização", type: "select", options: await getOptions("/organizacoes?take=500", "organizacoes", "id", "razaoSocial"), required: true, createOnly: true }, { name: "valorMensal", label: "Valor mensal (R$)", type: "number", min: "0.01", step: "0.01", required: true }, { name: "dataVencimento", label: "Vencimento", type: "date", required: true }, { name: "renovacaoAutomatica", label: "Renovação automática", type: "checkbox" }, { name: "clausulas", label: "Cláusulas (uma por linha)", type: "textarea", wide: true, required: true }],
  cols: [{ title: "Organização", render: (x) => `<strong>${esc(x.organizacao?.razaoSocial || x.organizacaoId)}</strong><small>${esc(x.organizacao?.cnpj || "")}</small>` }, { title: "Valor mensal", render: (x) => currency(x.valorMensal) }, { title: "Vencimento", render: (x) => date(x.dataVencimento) }, { title: "Renovação", render: (x) => statusBadge(x.renovacaoAutomatica ? "ATIVA" : "MANUAL") }, { title: "Ações", render: (x) => `<div class="table-actions">${actionButton("edit", x.id, "Editar", false, !canOrg())}${actionButton("delete", x.id, "Excluir", true, !canOrg())}</div>` }],
  body: (d) => ({ organizacaoId: d.organizacaoId, valorMensal: Number(d.valorMensal), dataVencimento: new Date(d.dataVencimento).toISOString(), clausulas: d.clausulas.split("\n").map((x) => x.trim()).filter(Boolean), renovacaoAutomatica: d.renovacaoAutomatica === "on" })
};
async function renderContracts() { await renderCrud(contracts, "Consulte e mantenha os contratos associados às organizações.", canOrg() ? '<button class="button button-primary" data-action="create">+ Novo contrato</button>' : ""); }

const lots = {
  title: "Lotes", path: "/lotes?take=500", key: "lotes", createRoles: ["ADMINISTRADOR", "GESTOR_ALMOXARIFADO"],
  fields: async () => [{ name: "organizacaoId", label: "Organização", type: "select", options: await getOptions("/organizacoes?take=500", "organizacoes", "id", "razaoSocial"), required: true }, { name: "dataEntrada", label: "Data de entrada", type: "datetime-local", required: true }, { name: "notaFiscal", label: "Nota fiscal", required: true }, { name: "transportadora", label: "Transportadora", required: true }, { name: "observacoes", label: "Observações", type: "textarea", wide: true }],
  cols: [{ title: "Lote", render: (x) => `<strong>${esc(x.notaFiscal)}</strong><small>${esc(x.id)}</small>` }, { title: "Entrada", render: (x) => date(x.dataEntrada) }, { title: "Etapa", render: (x) => statusBadge(x.statusProcessamento) }, { title: "Itens", render: (x) => String(x.equipamentos?.length ?? 0) }, { title: "Ações", render: (x) => `<div class="table-actions">${actionButton("edit", x.id, "Editar", false, !canStock() || x.statusProcessamento !== "RECEBIDO")}${actionButton("process", x.id, "Iniciar triagem", false, !canStock() || x.statusProcessamento !== "RECEBIDO")}${actionButton("delete", x.id, "Excluir", true, !canStock() || x.statusProcessamento !== "RECEBIDO")}</div>` }],
  body: (d) => ({ organizacaoId: d.organizacaoId, dataEntrada: new Date(d.dataEntrada).toISOString(), notaFiscal: d.notaFiscal, transportadora: d.transportadora, observacoes: d.observacoes || "" })
};
async function renderLots() { await renderCrud(lots, "Acompanhe as entradas e o andamento da triagem.", canStock() ? '<button class="button button-primary" data-action="create">+ Novo lote</button>' : ""); }

const equipment = {
  title: "Equipamentos", path: "/equipamentos?take=500", key: "equipamentos", createRoles: ["ADMINISTRADOR", "GESTOR_ALMOXARIFADO"],
  fields: async () => [{ name: "loteId", label: "Lote", type: "select", options: await getOptions("/lotes?take=500", "lotes", "id", "notaFiscal"), required: true }, { name: "tipo", label: "Tipo", type: "select", options: ENUMS.tipoEquipamento.map((x) => [x, label(x)]), required: true }, { name: "marca", label: "Marca", required: true }, { name: "modelo", label: "Modelo", required: true }, { name: "anoFabricacao", label: "Ano de fabricação", type: "number", min: "1980", step: "1", required: true }, { name: "estadoFisico", label: "Estado físico", type: "select", options: ENUMS.estadoFisico.map((x) => [x, label(x)]), required: true }, { name: "pesoQuilogramas", label: "Peso (kg)", type: "number", min: "0.01", step: "0.01", required: true }],
  cols: [{ title: "Equipamento", render: (x) => `<strong>${esc(x.codigoBarrasInterno)}</strong><small>${esc(x.marca)} · ${esc(x.modelo)}</small>` }, { title: "Tipo", render: (x) => label(x.tipo) }, { title: "Condição", render: (x) => statusBadge(x.estadoFisico) }, { title: "Rastreamento", render: (x) => statusBadge(x.statusRastreamento) }, { title: "Ações", render: (x) => `<div class="table-actions">${actionButton("edit", x.id, "Editar", false, !canStock() || x.statusRastreamento === "BAIXA_DEFINITIVA")}${actionButton("state", x.id, "Condição", false, !canStock() || x.statusRastreamento === "BAIXA_DEFINITIVA")}${actionButton("status", x.id, "Status", false, !canStock() || x.statusRastreamento === "BAIXA_DEFINITIVA")}${actionButton("tracking", x.id, "Histórico")}${actionButton("move", x.id, "Movimentar", false, !canStock() || x.statusRastreamento === "BAIXA_DEFINITIVA")}${actionButton("recovery", x.id, "Recuperação", false, !canStock())}${actionButton("delete", x.id, "Baixa", true, !canStock() || x.statusRastreamento === "BAIXA_DEFINITIVA")}</div>` }],
  body: (d) => ({ loteId: d.loteId, tipo: d.tipo, marca: d.marca, modelo: d.modelo, anoFabricacao: Number(d.anoFabricacao), estadoFisico: d.estadoFisico, pesoQuilogramas: Number(d.pesoQuilogramas) })
};
async function renderEquipment() { await renderCrud(equipment, "Consulte os itens, seus estados e códigos de rastreabilidade.", canStock() ? '<button class="button button-primary" data-action="create">+ Novo equipamento</button>' : ""); }

const users = {
  title: "Usuários", path: "/auth/usuarios", key: "usuarios", createRoles: ["ADMINISTRADOR"],
  fields: [{ name: "usuario", label: "Nome de usuário", required: true, min: "3", max: "50" }, { name: "papel", label: "Papel de acesso", type: "select", options: ENUMS.papel.map((x) => [x, ROLES[x]]), required: true }, { name: "senha", label: "Senha inicial (mínimo 12 caracteres)", type: "password", required: true, createOnly: true, wide: true }],
  cols: [{ title: "Usuário", render: (x) => `<strong>${esc(x.usuario)}</strong><small>${esc(x.id)}</small>` }, { title: "Papel", render: (x) => statusBadge(ROLES[x.papel] || x.papel) }, { title: "Último acesso", render: (x) => date(x.ultimoAcesso) }, { title: "Status", render: (x) => statusBadge(x.ativo ? "ATIVO" : "INATIVO") }, { title: "Ações", render: (x) => `<div class="table-actions">${actionButton("edit", x.id, "Editar", false, !isAdmin() || !x.ativo)}${actionButton("delete", x.id, "Desativar", true, !isAdmin() || !x.ativo)}</div>` }],
  body: (d) => ({ usuario: d.usuario, papel: d.papel, ...(d.senha ? { senha: d.senha } : {}) })
};
async function renderUsers() { await renderCrud(users, isAdmin() ? "Administre contas, papéis e acessos ao sistema." : "Você pode consultar os usuários cadastrados por você.", isAdmin() ? '<button class="button button-primary" data-action="create">+ Novo usuário</button>' : ""); }

async function getOptions(path, key, valueField, labelField) {
  const rows = normalizeRows(await api(path), key);
  return rows.map((row) => [row[valueField], `${row[labelField]}${row.ativo === false ? " (inativa)" : ""}`]);
}
async function renderCrud(config, description, button) {
  const result = await api(config.path);
  const rows = normalizeRows(result, config.key);
  state.rows = rows;
  const filteredColumns = config.cols;
  $("#page-content").innerHTML = `${header(config.title, description, button)}${tableCard(filteredColumns, rows)}`;
  const search = $(".table-search");
  if (search) search.addEventListener("input", () => {
    const query = search.value.toLocaleLowerCase("pt-BR");
    $$("tbody tr").forEach((row) => { row.hidden = !row.textContent.toLocaleLowerCase("pt-BR").includes(query); });
  });
}
function fieldMarkup(field, value, editMode) {
  if (field.createOnly && editMode) return "";
  const val = value ?? "";
  const common = `name="${esc(field.name)}" ${field.required ? "required" : ""} ${field.readOnly ? "readonly" : ""} ${field.min ? `min="${esc(field.min)}"` : ""} ${field.max ? `max="${esc(field.max)}"` : ""} ${field.step ? `step="${esc(field.step)}"` : ""} ${field.type !== "textarea" ? `value="${esc(field.type === "date" || field.type === "datetime-local" ? dateInputValue(val, field.type) : val)}"` : ""}`;
  let element;
  if (field.type === "checkbox") {
    return `<div class="form-field${field.wide ? " full" : ""}"><label class="check-field"><input type="checkbox" name="${esc(field.name)}" ${val ? "checked" : ""} /> ${esc(field.label)}</label></div>`;
  }
  if (field.type === "select") element = `<select ${common}><option value="">Selecione…</option>${(field.options || []).map((option) => { const [v, text] = Array.isArray(option) ? option : [option, label(option)]; return `<option value="${esc(v)}"${String(v) === String(val) ? " selected" : ""}>${esc(text)}</option>`; }).join("")}</select>`;
  else if (field.type === "textarea") element = `<textarea ${common} placeholder="${esc(field.placeholder || "")}">${esc(val)}</textarea>`;
  else element = `<input type="${esc(field.type || "text")}" ${common} placeholder="${esc(field.placeholder || "")}" />`;
  return `<label class="form-field${field.wide ? " full" : ""}">${esc(field.label)}${element}</label>`;
}
function dateInputValue(value, type) {
  if (!value) return type === "datetime-local" ? new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString();
  return type === "date" ? local.slice(0, 10) : local.slice(0, 16);
}
function formDataObject(form) {
  const data = Object.fromEntries(new FormData(form).entries());
  $$("input[type=checkbox]", form).forEach((input) => { data[input.name] = input.checked ? "on" : ""; });
  return data;
}
async function openForm(title, fields, values, onSubmit, options = {}) {
  const resolvedFields = typeof fields === "function" ? await fields() : fields;
  $("#dialog-title").textContent = title;
  $("#dialog-fields").innerHTML = resolvedFields.map((field) => fieldMarkup(field, values?.[field.name], options.editMode)).join("");
  $("#dialog-error").hidden = true;
  $("#dialog-submit").textContent = options.submitText || "Salvar";
  state.submitDialog = onSubmit;
  $("#entity-dialog").showModal();
}
function closeForm() { $("#entity-dialog").close(); state.submitDialog = null; }
function findRow(id) { return state.rows.find((row) => row.id === id); }
function clausesValue(row) { return (row.clausulas || []).join("\n"); }
function editValues(type, row) {
  if (type === "contratos") return { ...row, dataVencimento: row.dataVencimento, clausulas: clausesValue(row) };
  return row;
}
async function openCreate(config) {
  await openForm(`Novo ${singular(config.title)}`, config.fields, {}, async (formData) => {
    const body = config.body(formData);
    await api(config.path.split("?")[0], { method: "POST", body });
    toast(`${singular(config.title)} criado com sucesso.`);
  });
}
function singular(title) { return ({ Organizações: "organização", Contratos: "contrato", Lotes: "lote", Equipamentos: "equipamento", Usuários: "usuário" })[title] || title.toLocaleLowerCase("pt-BR"); }
async function openEdit(config, row) {
  const fields = typeof config.fields === "function" ? config.fields : config.fields;
  await openForm(`Editar ${singular(config.title)}`, fields, editValues(config.key, row), async (d) => {
    const base = config.body(d);
    const body = { ...base, versao: row.versao };
    if (config.key === "contratos") delete body.organizacaoId;
    if (config.key === "equipamentos") delete body.loteId, delete body.tipo, delete body.estadoFisico;
    if (config.key === "usuarios") delete body.senha;
    await api(`${config.path.split("?")[0]}/${row.id}`, { method: "PUT", body });
    toast("Alterações salvas.");
  }, { editMode: true });
}
async function deleteRow(config, row) {
  const verb = config.key === "organizacoes" || config.key === "usuarios" || config.key === "equipamentos" ? "desativar" : "excluir";
  if (!confirm(`Deseja ${verb} este registro?`)) return;
  let body = { versao: row.versao };
  if (config.key === "equipamentos") {
    const justificativa = prompt("Informe a justificativa da baixa definitiva:");
    if (!justificativa?.trim()) return;
    body.justificativa = justificativa.trim();
  }
  await api(`${config.path.split("?")[0]}/${row.id}`, { method: "DELETE", body });
  toast("Operação concluída.");
  await renderView();
}

async function renderAnalytics() {
  const html = `${header("Análises", "Execute os indicadores operacionais e consulte resultados anteriores.")}
    <section class="analysis-grid">
      ${analysisCard("Eficiência operacional", "Tempo médio da entrada à conclusão da triagem, por período e operador.", "efficiency", "◷")}
      ${analysisCard("Rentabilidade", "Valores de recuperação reais agrupados por tipo e estado físico.", "profitability", "◉")}
      ${analysisCard("Vida útil preditiva", "Projeções baseadas no histórico de estado físico dos equipamentos.", "useful-life", "⌁")}
    </section><section class="panel"><div class="panel-heading"><div><h2>Resultado da análise</h2><p id="analysis-result-caption">Os cálculos são persistidos no histórico quando executados.</p></div></div><pre id="analysis-output" class="result-box">Selecione uma análise acima para começar.</pre></section>
    <section class="panel" style="margin-top:16px"><div class="panel-heading"><div><h2>Histórico recente</h2><p>Últimos resultados analíticos armazenados</p></div><button class="text-link" data-action="refresh">Atualizar →</button></div><div id="analysis-history">${loading()}</div></section>`;
  $("#page-content").innerHTML = html;
  const results = normalizeRows(await api("/analises?limite=20"), "resultados");
  const columns = [{ title: "Tipo", render: (x) => label(x.tipo) }, { title: "Gerado em", render: (x) => date(x.geradoEm) }, { title: "Período", render: (x) => x.periodoInicio ? `${date(x.periodoInicio)} — ${date(x.periodoFim)}` : "Histórico completo" }, { title: "Ações", render: (x) => actionButton("analysis-detail", x.id, "Ver resultado") }];
  $("#analysis-history").innerHTML = tableCard(columns, results, "resultados");
}
function analysisCard(title, description, kind, icon) { return `<article class="analysis-card"><span class="stat-icon">${icon}</span><h3>${title}</h3><p>${description}</p><button class="button button-secondary" data-action="run-analysis" data-kind="${kind}">Executar análise →</button></article>`; }
async function runAnalysis(kind) {
  let path, body = {};
  if (kind === "efficiency") {
    const fields = [{ name: "inicio", label: "Início", type: "date", required: true }, { name: "fim", label: "Fim", type: "date", required: true }, { name: "comparar", label: "Início do período de comparação (opcional)", type: "date" }, { name: "compararFim", label: "Fim do período de comparação", type: "date" }];
    await openForm("Análise de eficiência operacional", fields, {}, async (d) => {
      body = { periodo: { inicio: new Date(`${d.inicio}T00:00:00`).toISOString(), fim: new Date(`${d.fim}T23:59:59`).toISOString() } };
      if (d.comparar && d.compararFim) body.periodoComparacao = { inicio: new Date(`${d.comparar}T00:00:00`).toISOString(), fim: new Date(`${d.compararFim}T23:59:59`).toISOString() };
      await showAnalysis("/analises/eficiencia-operacional", body);
    }); return;
  }
  if (kind === "profitability") {
    await openForm("Análise de rentabilidade", [{ name: "inicio", label: "Início do período (opcional)", type: "date" }, { name: "fim", label: "Fim do período", type: "date" }], {}, async (d) => {
      body = d.inicio && d.fim ? { periodo: { inicio: new Date(`${d.inicio}T00:00:00`).toISOString(), fim: new Date(`${d.fim}T23:59:59`).toISOString() } } : {};
      await showAnalysis("/analises/rentabilidade", body);
    }); return;
  }
  const fields = [{ name: "tipo", label: "Tipo de equipamento (opcional)", type: "select", options: [["", "Todos os tipos"], ...ENUMS.tipoEquipamento.map((x) => [x, label(x)])] }];
  await openForm("Análise preditiva de vida útil", fields, {}, async (d) => {
    await showAnalysis("/analises/vida-util", d.tipo ? { tipo: d.tipo } : {});
  });
}
async function showAnalysis(path, body) {
  $("#analysis-output").textContent = "Calculando…";
  closeForm();
  const result = await api(path, { method: "POST", body });
  $("#analysis-output").textContent = JSON.stringify(result, null, 2);
  $("#analysis-result-caption").textContent = `${label(result.tipo)} · ${date(result.geradoEm)} · salvo no histórico`;
  toast("Análise concluída e salva.");
  await renderAnalytics();
  $("#analysis-output").textContent = JSON.stringify(result, null, 2);
}

async function renderKeys() {
  const result = await api("/auth/api-keys");
  const rows = normalizeRows(result, "chaves");
  state.rows = rows;
  const cols = [{ title: "Chave", render: (x) => `<strong>${esc(x.nome)}</strong><small>${esc(x.prefixo)}••••</small>` }, { title: "Organização", render: (x) => esc(x.organizacao?.razaoSocial || x.organizacaoId) }, { title: "Permissões", render: (x) => esc((x.permissoes || []).map(label).join(", ")) }, { title: "Validade", render: (x) => x.revogadaEm ? statusBadge("REVOGADA") : x.expiraEm ? date(x.expiraEm) : "Sem expiração" }, { title: "Ações", render: (x) => `<div class="table-actions">${actionButton("revoke-key", x.id, "Revogar", true, Boolean(x.revogadaEm))}</div>` }];
  $("#page-content").innerHTML = `${header("Chaves de API", "Credenciais dos parceiros externos. O segredo é exibido uma única vez.", '<button class="button button-primary" data-action="create-key">+ Nova chave</button>')}${tableCard(cols, rows, "chaves")}`;
}

async function renderViewAction(action, id, extra) {
  if (action === "create") return openCreate(currentConfig());
  if (action === "edit") return openEdit(currentConfig(), findRow(id));
  if (action === "delete") return deleteRow(currentConfig(), findRow(id));
  if (action === "process") {
    const row = findRow(id);
    if (!confirm(`Iniciar a triagem do lote ${row.notaFiscal}?`)) return;
    await api(`/lotes/${id}/processar-triagem`, { method: "POST", body: { versao: row.versao } });
    toast("Triagem iniciada."); return renderView();
  }
  if (action === "state") return openEquipmentState(findRow(id));
  if (action === "status") return openEquipmentStatus(findRow(id));
  if (action === "tracking") return showEquipmentHistory(id);
  if (action === "move") return openMovement(findRow(id));
  if (action === "recovery") return openRecovery(findRow(id));
  if (action === "analysis-detail") {
    const result = await api(`/analises/${id}`);
    $("#analysis-output").textContent = JSON.stringify(result, null, 2);
    return;
  }
  if (action === "run-analysis") return runAnalysis(extra);
  if (action === "create-key") return openKeyForm();
  if (action === "revoke-key") {
    if (!confirm("Revogar esta chave? A integração do parceiro deixará de funcionar.")) return;
    await api(`/auth/api-keys/${id}`, { method: "DELETE" }); toast("Chave revogada."); return renderKeys();
  }
  if (action === "refresh") return renderView();
  if (action === "goto-equipment") return setView("equipamentos");
  if (action === "goto-analytics") return setView("analises");
  if (action === "new-lot") { setView("lotes"); return openCreate(lots); }
}
function currentConfig() { return ({ organizacoes: organizations, contratos: contracts, lotes: lots, equipamentos: equipment, usuarios: users })[state.view]; }
async function openEquipmentState(row) {
  const fields = [{ name: "estadoFisico", label: "Estado físico", type: "select", options: ENUMS.estadoFisico.map((x) => [x, label(x)]), required: true }, { name: "justificativa", label: "Justificativa (obrigatória se houver queda)", type: "text", wide: true }];
  await openForm("Atualizar estado físico", fields, row, async (d) => {
    await api(`/equipamentos/${row.id}/estado`, { method: "PATCH", body: { estadoFisico: d.estadoFisico, justificativa: d.justificativa || undefined, versao: row.versao } });
    toast("Estado físico atualizado.");
  });
}
async function openEquipmentStatus(row) {
  const fields = [{ name: "statusRastreamento", label: "Novo status de rastreamento", type: "select", options: ENUMS.statusRastreamento.map((x) => [x, label(x)]), required: true }, { name: "justificativa", label: "Justificativa para a mudança", type: "text", required: true, wide: true }];
  await openForm("Atualizar rastreamento", fields, row, async (d) => {
    await api(`/equipamentos/${row.id}/status`, { method: "PATCH", body: { statusRastreamento: d.statusRastreamento, justificativa: d.justificativa, versao: row.versao } });
    toast("Rastreamento atualizado.");
  });
}
async function showEquipmentHistory(id) {
  const history = await api(`/equipamentos/${id}/rastreabilidade`);
  await openForm("Histórico de rastreabilidade", [{ name: "historico", label: "Dados e movimentações", type: "textarea", wide: true, readOnly: true }], { historico: JSON.stringify(history, null, 2) }, async () => {}, { submitText: "Fechar" });
}
async function openMovement(row) {
  const fields = [{ name: "destino", label: "Destino", required: true }, { name: "responsavel", label: "Responsável", required: true }, { name: "observacao", label: "Observação", type: "textarea", wide: true }];
  await openForm("Registrar movimentação", fields, { responsavel: state.user.usuario }, async (d) => {
    await api(`/equipamentos/${row.id}/movimentacoes`, { method: "POST", body: { destino: d.destino, responsavel: d.responsavel, observacao: d.observacao || "", versao: row.versao } });
    toast("Movimentação registrada.");
  });
}
async function openRecovery(row) {
  const fields = [{ name: "valorRecuperado", label: "Valor recuperado (R$)", type: "number", min: "0", step: "0.01", required: true }, { name: "observacao", label: "Observação", type: "textarea", wide: true }];
  await openForm("Registrar valor de recuperação", fields, {}, async (d) => {
    await api(`/analises/equipamentos/${row.id}/recuperacao`, { method: "POST", body: { valorRecuperado: Number(d.valorRecuperado), observacao: d.observacao || "" } });
    toast("Valor de recuperação registrado.");
  });
}
async function openKeyForm() {
  const orgOptions = await getOptions("/organizacoes?take=500", "organizacoes", "id", "razaoSocial");
  const fields = [{ name: "nome", label: "Nome da integração", required: true, wide: true }, { name: "organizacaoId", label: "Organização", type: "select", options: orgOptions, required: true, wide: true }, ...ENUMS.permissoesApi.map((permission) => ({ name: `perm:${permission}`, label: label(permission), type: "checkbox" })), { name: "expiraEm", label: "Expiração (opcional)", type: "datetime-local", wide: true }];
  await openForm("Criar chave de API", fields, {}, async (d) => {
    const permissoes = ENUMS.permissoesApi.filter((p) => d[`perm:${p}`] === "on");
    if (!permissoes.length) throw new Error("Selecione ao menos uma permissão.");
    const created = await api("/auth/api-keys", { method: "POST", body: { nome: d.nome, organizacaoId: d.organizacaoId, permissoes, ...(d.expiraEm ? { expiraEm: new Date(d.expiraEm).toISOString() } : {}) } });
    closeForm();
    await openForm("Guarde o segredo agora", [{ name: "chave", label: "API Key · exibida uma única vez", type: "text", wide: true }], { chave: created.chave }, async () => { closeForm(); toast("Chave registrada. O segredo não será exibido novamente."); await renderKeys(); }, { submitText: "Já guardei" });
    const input = $("#dialog-fields input");
    if (input) input.readOnly = true;
    $("#dialog-fields").insertAdjacentHTML("beforeend", '<button class="button button-secondary" type="button" data-copy-key>Copiar chave</button>');
    return "dialog-opened";
  });
}

$("#login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const submit = $("button[type=submit]", event.currentTarget);
  submit.disabled = true; submit.textContent = "Entrando…";
  try {
    const form = new FormData(event.currentTarget);
    const response = await api("/auth/login", { method: "POST", body: Object.fromEntries(form.entries()) });
    state.token = response.accessToken; sessionStorage.setItem(TOKEN_KEY, state.token);
    await initialize();
  } catch (error) { showLogin(error.message); }
  finally { submit.disabled = false; submit.innerHTML = 'Entrar <span>→</span>'; }
});
$("#logout-button").addEventListener("click", logout);
$("#main-nav").addEventListener("click", (event) => { const link = event.target.closest("[data-view]"); if (link) setView(link.dataset.view); });
$("#page-content").addEventListener("click", async (event) => {
  const viewLink = event.target.closest("[data-view]");
  if (viewLink) return setView(viewLink.dataset.view);
  const button = event.target.closest("[data-action]");
  if (!button) return;
  button.disabled = true;
  try { await renderViewAction(button.dataset.action, button.dataset.id, button.dataset.kind); }
  catch (error) { toast(error.message, "error"); }
  finally { if (button.isConnected) button.disabled = false; }
});
$("#entity-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = $("#dialog-submit"); button.disabled = true;
  try {
    const result = await state.submitDialog?.(formDataObject(event.currentTarget));
    if (result !== "dialog-opened") { closeForm(); await renderView(); }
  }
  catch (error) { $("#dialog-error").textContent = error.message; $("#dialog-error").hidden = false; }
  finally { button.disabled = false; }
});
$("#entity-dialog").addEventListener("click", async (event) => {
  if (event.target.closest("[data-close-dialog]")) closeForm();
  if (event.target.closest("[data-copy-key]")) {
    const input = $("#dialog-fields input");
    if (!input) return;
    try { await navigator.clipboard.writeText(input.value); toast("Chave copiada. Guarde-a agora; ela não será mostrada novamente."); }
    catch { input.select(); toast("Não foi possível copiar automaticamente. Selecione e copie a chave manualmente.", "error"); }
  }
});
$("#entity-dialog").addEventListener("cancel", () => { state.submitDialog = null; });
$("#menu-button").addEventListener("click", () => { $("#sidebar").classList.toggle("is-open"); $("#sidebar-backdrop").classList.toggle("is-open"); });
$("#sidebar-backdrop").addEventListener("click", () => { $("#sidebar").classList.remove("is-open"); $("#sidebar-backdrop").classList.remove("is-open"); });

async function initialize() {
  if (!state.token) return showLogin();
  try {
    state.user = await api("/auth/me");
    $("#login-screen").hidden = true; $("#app-screen").hidden = false;
    updateAccount(); setView(state.view || "dashboard");
  } catch (error) { showLogin(error.message); }
}
initialize();
