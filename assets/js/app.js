import { supabase, config } from "./supabase.js";

const app = document.querySelector("#app");
const state = {
  session: null,
  profile: null,
  view: "dashboard",
  equipmentPage: 0,
  equipmentSearch: "",
  pendingScan: null
};

const qs = (s, root = document) => root.querySelector(s);
const qsa = (s, root = document) => [...root.querySelectorAll(s)];
const esc = (v = "") => String(v).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
const uid = () => crypto.randomUUID();

function dt(value) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(d);
}
function dateOnly(value) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short" }).format(d);
}
function statusLabel(v) {
  return ({
    available: "Disponível", in_use: "Em uso", maintenance: "Manutenção", unavailable: "Indisponível",
    open: "Em aberto", returned: "Devolvida", cancelled: "Cancelada", confirmed: "Confirmada",
    fulfilled: "Utilizada", expired: "Expirada", resolved: "Resolvida"
  })[v] ?? v ?? "—";
}
function roleLabel(v) { return ({ student: "Aluno", teacher: "Professor", admin: "Administrador" })[v] ?? v ?? "Usuário"; }
function maskEmail(v = "") {
  const [name, domain] = String(v).split("@");
  if (!domain) return "—";
  return `${name.slice(0, Math.min(2, name.length))}${"*".repeat(Math.min(5, Math.max(2, name.length - 2)))}@${domain}`;
}
function errText(error) {
  const raw = error?.message || String(error || "Erro inesperado");
  const code = raw.match(/(ALOCA|DASEIN)_[A-Z0-9_]+/)?.[0];
  const map = {
    ALOCA_NOT_AUTHENTICATED: "Sua sessão expirou.", ALOCA_ADMIN_REQUIRED: "Esta ação exige administrador.",
    ALOCA_PROFILE_NOT_FOUND: "Perfil não encontrado.", ALOCA_CLASS_REQUIRED: "Informe a turma.",
    ALOCA_DESTINATION_REQUIRED: "Informe o destino.", ALOCA_EQUIPMENT_NOT_FOUND: "Equipamento não encontrado.",
    ALOCA_EQUIPMENT_UNAVAILABLE: "Equipamento indisponível.", ALOCA_EQUIPMENT_MAINTENANCE: "Equipamento em manutenção.",
    ALOCA_ALREADY_IN_USE: "Este equipamento já está em uso.", ALOCA_NOT_AVAILABLE: "Este equipamento não está disponível.",
    ALOCA_NOT_IN_USE_OR_FORBIDDEN: "Não há retirada aberta para você devolver este equipamento.",
    ALOCA_BATCH_IN_USE: "O lote contém equipamento em uso.", ALOCA_BATCH_MAINTENANCE: "O lote contém equipamento em manutenção.",
    ALOCA_BATCH_UNAVAILABLE: "O lote contém equipamento indisponível.", ALOCA_BATCH_CONFLICT: "Outro usuário alterou um dos equipamentos ao mesmo tempo.",
    ALOCA_CART_DUPLICATE_NUMBER_OR_EQUIPMENT: "Número do carrinho ou equipamento já está vinculado a outro carrinho.",
    DASEIN_NOT_AUTHENTICATED: "Sua sessão expirou.", DASEIN_ADMIN_REQUIRED: "Esta ação exige administrador.",
    DASEIN_PROFILE_NOT_FOUND: "Perfil não encontrado.", DASEIN_CLASS_REQUIRED: "Informe a turma.",
    DASEIN_DESTINATION_REQUIRED: "Informe o destino.", DASEIN_RESERVATION_TIME_INVALID: "O horário final precisa ser depois do inicial.",
    DASEIN_RESERVATION_PAST: "Não é possível reservar um horário que já passou.", DASEIN_RESERVATION_CONFLICT: "Esse equipamento já possui reserva nesse intervalo.",
    DASEIN_EQUIPMENT_NOT_FOUND: "Equipamento não encontrado.", DASEIN_EQUIPMENT_UNAVAILABLE: "Equipamento indisponível.",
    DASEIN_EQUIPMENT_MAINTENANCE: "Equipamento em manutenção.", DASEIN_RESERVATION_TOO_EARLY: "A retirada só é liberada 30 minutos antes da reserva.",
    DASEIN_RESERVATION_EXPIRED: "O horário dessa reserva já terminou.", DASEIN_RESERVATION_OWNER_REQUIRED: "A retirada desta reserva deve ser feita pelo responsável que a criou.",
    DASEIN_MAINTENANCE_ALREADY_OPEN: "Já existe uma manutenção aberta para este equipamento.", DASEIN_EQUIPMENT_IN_USE: "Devolva o equipamento antes de colocá-lo em manutenção."
  };
  return map[code] || raw.replace(/^.*ERROR:\s*/i, "");
}
function notify(message, type = "info") {
  const host = qs("#toast-host");
  if (!host) return;
  const titles = { success: "Concluído", error: "Não foi possível concluir", warning: "Atenção", info: "Dasein" };
  const marks = { success: "✓", error: "!", warning: "!", info: "i" };
  const el = document.createElement("section");
  el.className = `dasein-infobox ${type}`;
  el.setAttribute("role", type === "error" ? "alert" : "status");
  el.innerHTML = `<span class="infobox-mark" aria-hidden="true">${marks[type] || "i"}</span><div class="infobox-copy"><strong>${esc(titles[type] || "Dasein")}</strong><p>${esc(message)}</p></div><button class="infobox-close" type="button" aria-label="Fechar aviso">×</button><span class="infobox-timer" aria-hidden="true"></span>`;
  host.prepend(el);
  while (host.children.length > 4) host.lastElementChild?.remove();
  const remove = () => { el.classList.add("leaving"); setTimeout(() => el.remove(), 190); };
  qs(".infobox-close", el)?.addEventListener("click", remove);
  setTimeout(remove, type === "error" ? 7000 : 5000);
}
function confirmAction({ title = "Confirmar ação", message, confirmText = "Confirmar", cancelText = "Voltar", danger = false } = {}) {
  return new Promise(resolve => {
    const modal = makeModal(`<div class="confirm-box"><span class="confirm-symbol ${danger ? "danger" : ""}">${danger ? "!" : "?"}</span><div><span class="eyebrow">Dasein</span><h2>${esc(title)}</h2><p>${esc(message || "Confirme para continuar.")}</p></div></div><div class="modal-actions confirm-actions"><button class="button" type="button" data-confirm-no>${esc(cancelText)}</button><button class="button ${danger ? "danger-solid" : "primary"}" type="button" data-confirm-yes>${esc(confirmText)}</button></div>`);
    let settled = false;
    const finish = value => { if (settled) return; settled = true; modal.remove(); resolve(value); };
    qs("[data-confirm-no]", modal)?.addEventListener("click", () => finish(false));
    qs("[data-confirm-yes]", modal)?.addEventListener("click", () => finish(true));
    modal.addEventListener("click", e => { if (e.target === modal) finish(false); });
  });
}
function setBusy(button, busy, text = "Aguarde…") {
  if (!button) return;
  if (busy) { button.dataset.old = button.textContent; button.textContent = text; button.disabled = true; }
  else { button.textContent = button.dataset.old || button.textContent; button.disabled = false; }
}
function closeModal(modal) { modal?.remove(); }
function makeModal(html, wide = false) {
  const back = document.createElement("div");
  back.className = "modal-backdrop";
  back.innerHTML = `<section class="modal ${wide ? "wide" : ""}" role="dialog" aria-modal="true">${html}</section>`;
  document.body.append(back);
  qsa("[data-close]", back).forEach(b => b.addEventListener("click", () => closeModal(back)));
  back.addEventListener("click", e => { if (e.target === back) closeModal(back); });
  return back;
}
function detail(label, value) { return `<div class="detail"><span>${esc(label)}</span><strong>${esc(value || "—")}</strong></div>`; }
function qrUrl(token) {
  const url = new URL(location.href);
  url.search = ""; url.hash = "";
  url.searchParams.set("qr", token);
  return url.toString();
}
function scanTokenFromUrl() {
  const params = new URLSearchParams(location.search);
  const token = params.get("qr") || params.get("e");
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(token || "") ? token : null;
}
async function scanPublic(token) {
  if (!token) return null;
  const { data, error } = await supabase.rpc("scan_qr", { p_token: token });
  if (error) return null;
  return Array.isArray(data) ? data[0] || null : data;
}

function renderAuth(scan = null) {
  app.innerHTML = `
  <main class="auth-shell">
    <section class="auth-brand">
      <div class="brandline"><div class="brandmark">D</div><strong>Dasein</strong></div>
      <div class="auth-brand-copy"><span class="eyebrow" style="color:rgba(255,255,255,.65)">Equipamentos escolares</span><h1>Um lugar para saber onde cada equipamento está.</h1><p>Reservas, retiradas, devoluções, carrinhos, QR Codes, manutenção e histórico usando o mesmo Supabase do Aloca+.</p></div>
      <span class="auth-version">Dasein ${esc(config.version)} · Web</span>
    </section>
    <section class="auth-side">
      <div class="auth-card">
        <span class="eyebrow">Acesso</span><h2>Entrar no Dasein</h2><p>Use sua conta escolar cadastrada.</p>
        ${scan ? `<div class="scan-preview"><span>QR reconhecido · ${esc(scan.kind === "cart" ? "Carrinho" : "Equipamento")}</span><strong>${esc(scan.display_name)}</strong><span>${scan.model ? `${esc(scan.brand || "")} ${esc(scan.model)}` : `${Number(scan.item_count || 0)} equipamento(s)`}</span>${scan.status ? `<span class="status status-${esc(scan.status)}">${esc(statusLabel(scan.status))}</span>` : ""}</div>` : ""}
        <div class="auth-tabs"><button class="auth-tab active" data-tab="login" type="button">Entrar</button><button class="auth-tab" data-tab="signup" type="button">Criar conta</button></div>
        <form id="login-form" class="auth-form">
          <label>E-mail<input id="login-email" type="email" autocomplete="email" required></label>
          <label>Senha<input id="login-password" type="password" autocomplete="current-password" minlength="6" required></label>
          <button class="button primary full" type="submit">Entrar</button>
          <button class="link-button" id="forgot" type="button">Esqueci minha senha</button>
        </form>
        <form id="signup-form" class="auth-form hidden">
          <label>Nome completo<input id="signup-name" type="text" autocomplete="name" minlength="3" maxlength="120" required></label>
          <label>E-mail<input id="signup-email" type="email" autocomplete="email" required></label>
          <label>Senha<input id="signup-password" type="password" autocomplete="new-password" minlength="8" required></label>
          <label class="check"><input id="signup-terms" type="checkbox" required><span>Li os <button class="link-button" data-legal="terms" type="button">Termos de Uso</button> e a <button class="link-button" data-legal="privacy" type="button">Política de Privacidade</button>.</span></label>
          <button class="button primary full" type="submit">Criar conta</button>
        </form>
        <div class="auth-footer">Dados operacionais são usados apenas para gerenciar equipamentos e movimentações da escola. O painel evita usar e-mail como identificação principal.</div>
      </div>
    </section>
  </main>`;

  qsa("[data-tab]").forEach(btn => btn.addEventListener("click", () => {
    qsa("[data-tab]").forEach(x => x.classList.toggle("active", x === btn));
    qs("#login-form").classList.toggle("hidden", btn.dataset.tab !== "login");
    qs("#signup-form").classList.toggle("hidden", btn.dataset.tab !== "signup");
  }));
  qsa("[data-legal]").forEach(btn => btn.addEventListener("click", () => openLegal(btn.dataset.legal)));

  qs("#login-form").addEventListener("submit", async e => {
    e.preventDefault(); const b = qs('button[type="submit"]', e.currentTarget); setBusy(b, true, "Entrando…");
    const { error } = await supabase.auth.signInWithPassword({ email: qs("#login-email").value.trim(), password: qs("#login-password").value });
    setBusy(b, false); if (error) notify(errText(error), "error");
  });
  qs("#signup-form").addEventListener("submit", async e => {
    e.preventDefault(); const b = qs('button[type="submit"]', e.currentTarget); setBusy(b, true, "Criando…");
    const { data, error } = await supabase.auth.signUp({ email: qs("#signup-email").value.trim(), password: qs("#signup-password").value, options: { data: { full_name: qs("#signup-name").value.trim() } } });
    setBusy(b, false); if (error) return notify(errText(error), "error");
    notify(data.session ? "Conta criada." : "Conta criada. Confirme o e-mail para entrar.", "success");
    if (!data.session) qs('[data-tab="login"]').click();
  });
  qs("#forgot").addEventListener("click", async () => {
    const email = qs("#login-email").value.trim(); if (!email) return notify("Digite seu e-mail primeiro.", "warning");
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${location.origin}${location.pathname}` });
    notify(error ? errText(error) : "Instruções de recuperação enviadas.", error ? "error" : "success");
  });
}
function openLegal(kind) {
  const terms = kind === "terms";
  makeModal(`<div class="panel-head"><div><span class="eyebrow">Dasein</span><h2>${terms ? "Termos de Uso" : "Política de Privacidade"}</h2></div><button class="icon-button" data-close>×</button></div><div class="modal-body"><p>Documento preliminar para a fase de testes do Dasein. Antes da adoção oficial, a escola deverá revisar e publicar a versão institucional.</p>${terms ? `<p>O usuário deve utilizar a plataforma apenas para atividades autorizadas da escola, respeitar as permissões do seu cargo e registrar retiradas e devoluções corretamente.</p>` : `<p>O Dasein coleta somente dados de conta e registros necessários para autenticação, reservas, retiradas, devoluções, manutenção e administração. QR Codes não carregam dados pessoais.</p><p>Dados operacionais permanecem protegidos por autenticação e Row Level Security no Supabase.</p>`}</div>`);
}

async function loadProfile() {
  const { data, error } = await supabase.from("profiles").select("id,full_name,role,created_at,updated_at").eq("id", state.session.user.id).single();
  if (error) throw error;
  state.profile = data;
}
function pageTitle() {
  return ({ dashboard: "Visão geral", equipment: "Equipamentos", withdrawals: "Retiradas", reservations: "Reservas", history: "Histórico", carts: "Carrinhos", maintenance: "Manutenção", admin: "Administração" })[state.view] || "Dasein";
}
function firstName() { return (state.profile?.full_name || "Usuário").trim().split(/\s+/)[0] || "Usuário"; }
function greeting() {
  const h = new Date().getHours();
  if (h < 12) return "Bom dia";
  if (h < 18) return "Boa tarde";
  return "Boa noite";
}
function icon(name) {
  const paths = {
    dashboard: '<rect x="4" y="4" width="6" height="6" rx="1.4"/><rect x="14" y="4" width="6" height="6" rx="1.4"/><rect x="4" y="14" width="6" height="6" rx="1.4"/><rect x="14" y="14" width="6" height="6" rx="1.4"/>',
    equipment: '<rect x="3.5" y="5" width="17" height="12" rx="2"/><path d="M8 20h8M12 17v3"/>',
    withdrawals: '<path d="M5 7h13M15 4l3 3-3 3M19 17H6M9 14l-3 3 3 3"/>',
    reservations: '<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M8 3v4M16 3v4M4 10h16M8 14h3M13 14h3"/>',
    history: '<circle cx="12" cy="12" r="8"/><path d="M12 7v5l3 2"/>',
    carts: '<path d="M4 5h2l2 10h9l2-7H7M10 19a1 1 0 1 0 0 .01M17 19a1 1 0 1 0 0 .01"/>',
    maintenance: '<path d="M14.5 6.5a4 4 0 0 0-5 5L4 17l3 3 5.5-5.5a4 4 0 0 0 5-5l-3 3-3-3 3-3z"/>',
    admin: '<circle cx="12" cy="12" r="3"/><path d="M19 12a7 7 0 0 0-.12-1.28l2.02-1.57-2-3.46-2.48 1a7 7 0 0 0-2.22-1.29L13.82 3h-4l-.38 2.4a7 7 0 0 0-2.22 1.29l-2.48-1-2 3.46 2.02 1.57A7 7 0 0 0 4.64 12c0 .44.04.87.12 1.28l-2.02 1.57 2 3.46 2.48-1a7 7 0 0 0 2.22 1.29l.38 2.4h4l.38-2.4a7 7 0 0 0 2.22-1.29l2.48 1 2-3.46-2.02-1.57c.08-.41.12-.84.12-1.28z"/>',
    logout: '<path d="M10 5H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h4M14 8l4 4-4 4M18 12H9"/>',
    search: '<circle cx="11" cy="11" r="6"/><path d="m16 16 4 4"/>',
    user: '<circle cx="12" cy="8" r="3.2"/><path d="M5.5 20a6.5 6.5 0 0 1 13 0"/>',
    qr: '<rect x="4" y="4" width="6" height="6"/><rect x="14" y="4" width="6" height="6"/><rect x="4" y="14" width="6" height="6"/><path d="M14 14h2v2h-2zM18 14h2v4h-2zM14 18h4v2h-4z"/>'
  };
  return `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${paths[name] || paths.dashboard}</svg>`;
}
function shell(content) {
  const admin = state.profile?.role === "admin";
  app.innerHTML = `<div class="app-shell">
    <aside class="sidebar" id="sidebar">
      <div class="sidebar-brand" title="Dasein"><div class="brandmark small">D</div><div class="brand-copy"><strong>Dasein</strong><span>${esc(config.version)}</span></div></div>
      <nav class="nav" aria-label="Navegação principal">
        ${nav("dashboard","Visão geral","dashboard")}${nav("equipment","Equipamentos","equipment")}${nav("withdrawals","Retiradas","withdrawals")}${nav("reservations","Reservas","reservations")}${nav("history","Histórico","history")}${nav("carts","Carrinhos","carts")}${admin ? nav("maintenance","Manutenção","maintenance") + nav("admin","Administração","admin") : ""}
      </nav>
      <div class="sidebar-user"><div class="sidebar-user-copy"><strong>${esc(state.profile?.full_name)}</strong><span>${esc(roleLabel(state.profile?.role))}</span></div><button class="nav-icon logout-button" id="logout" title="Sair" aria-label="Sair">${icon("logout")}</button></div>
    </aside>
    <section class="main">
      <header class="topbar">
        <div class="topbar-greeting"><button class="nav-icon menu-toggle" id="menu" aria-label="Abrir menu">☰</button><div><strong>${esc(greeting())}, ${esc(firstName())}</strong><span>${esc(pageTitle())} · ${esc(roleLabel(state.profile?.role))}</span></div></div>
        <form class="global-search" id="global-search-form" role="search"><span>${icon("search")}</span><input id="global-search" type="search" placeholder="Pesquisar equipamentos" autocomplete="off"></form>
        <button class="account-chip" id="account-chip" type="button"><span class="account-avatar">${icon("user")}</span><span><strong>Minha conta</strong><small>${esc(roleLabel(state.profile?.role))}</small></span><b>⌄</b></button>
      </header>
      <main class="content view-${esc(state.view)}">${content}</main>
    </section>
  </div>`;
  qsa("[data-view]").forEach(b => b.addEventListener("click", () => navigate(b.dataset.view)));
  qs("#menu")?.addEventListener("click", () => qs("#sidebar")?.classList.toggle("open"));
  qs("#logout")?.addEventListener("click", () => supabase.auth.signOut());
  qs("#account-chip")?.addEventListener("click", () => navigate(admin ? "admin" : "dashboard"));
  qs("#global-search-form")?.addEventListener("submit", e => {
    e.preventDefault();
    const term = qs("#global-search")?.value.trim() || "";
    if (!term) return;
    state.equipmentSearch = term;
    state.equipmentPage = 0;
    navigate("equipment");
  });
}
function nav(view, label, iconName) { return `<button type="button" class="nav-button ${state.view === view ? "active" : ""}" data-view="${view}" title="${esc(label)}" aria-label="${esc(label)}"><span class="nav-symbol">${icon(iconName)}</span><span class="nav-label">${esc(label)}</span></button>`; }
async function navigate(view) {
  state.view = view; qs("#sidebar")?.classList.remove("open");
  if (view === "equipment") return renderEquipment();
  if (view === "withdrawals") return renderWithdrawals();
  if (view === "reservations") return renderReservations();
  if (view === "history") return renderHistory();
  if (view === "carts") return renderCarts();
  if (view === "maintenance") return renderMaintenance();
  if (view === "admin") return renderAdmin();
  return renderDashboard();
}
function metric(label, value, view) { return `<button class="metric" type="button" data-go="${view}"><span>${esc(label)}</span><strong>${Number(value || 0).toLocaleString("pt-BR")}</strong><small>Abrir detalhes</small></button>`; }

async function renderDashboard() {
  state.view = "dashboard";
  shell(`<div class="loading">Carregando indicadores…</div>`);

  const admin = state.profile.role === "admin";
  const base = [
    supabase.from("equipments").select("id", { count: "exact", head: true }).eq("is_active", true),
    supabase.from("equipments").select("id", { count: "exact", head: true }).eq("is_active", true).eq("status", "available"),
    supabase.from("equipments").select("id", { count: "exact", head: true }).eq("status", "in_use"),
    supabase.from("equipments").select("id", { count: "exact", head: true }).eq("status", "maintenance"),
    supabase.from("reservations").select("id", { count: "exact", head: true }).eq("status", "confirmed")
  ];
  const [total, available, inUse, maintenance, reservations] = (await Promise.all(base)).map(x => x.count || 0);
  const { data: current } = await supabase.rpc("home_withdrawals", { p_query: null });
  const pendingReturns = (current || []).reduce((sum, row) => sum + Number(row.pending_count || 0), 0);

  const safeTotal = Math.max(total, 1);
  const availablePct = Math.round(available / safeTotal * 100);
  const inUsePct = Math.round(inUse / safeTotal * 100);
  const maintenancePct = Math.round(maintenance / safeTotal * 100);

  shell(`<section class="bento-dashboard">
    <header class="dashboard-intro">
      <div>
        <span class="eyebrow">Centro de operação</span>
        <h1>Visão geral</h1>
        <p>Acompanhe disponibilidade, movimentações e reservas sem disputar espaço com informação que não ajuda.</p>
      </div>
      <button class="button dashboard-main-action" type="button" data-open="equipment">Abrir inventário ${icon("equipment")}</button>
    </header>

    <div class="bento-grid">
      <button class="bento-card bento-inventory" type="button" data-go="equipment">
        <div class="bento-card-head"><span class="bento-icon">${icon("equipment")}</span><span>Inventário ativo</span><i></i></div>
        <div class="bento-number">${Number(total).toLocaleString("pt-BR")}</div>
        <p>equipamentos disponíveis para a operação da escola</p>
        <div class="inventory-distribution" aria-label="Distribuição do inventário">
          <span class="dist-available" style="width:${availablePct}%"></span>
          <span class="dist-use" style="width:${inUsePct}%"></span>
          <span class="dist-maintenance" style="width:${maintenancePct}%"></span>
        </div>
        <div class="inventory-legend"><span><i class="available-dot"></i>${availablePct}% disponíveis</span><span>${Math.max(0,100-availablePct)}% em operação</span></div>
      </button>

      <button class="bento-card bento-available" type="button" data-go="equipment">
        <div class="bento-card-head"><span>Disponíveis</span><i></i></div>
        <div class="bento-number">${Number(available).toLocaleString("pt-BR")}</div>
        <div class="bento-foot"><span>Prontos para uso</span><strong>${availablePct}%</strong></div>
      </button>

      <button class="bento-card bento-inuse" type="button" data-go="withdrawals">
        <div class="bento-card-head"><span>Em uso</span><i></i></div>
        <div class="bento-number">${Number(inUse).toLocaleString("pt-BR")}</div>
        <div class="bento-foot"><span>Retirados agora</span><strong>${inUsePct}%</strong></div>
      </button>

      <button class="bento-card bento-maintenance" type="button" data-go="${admin ? "maintenance" : "equipment"}">
        <div class="bento-card-head"><span>Manutenção</span><i></i></div>
        <div class="bento-number">${Number(maintenance).toLocaleString("pt-BR")}</div>
        <div class="bento-foot"><span>Exigem atenção</span><strong>${maintenancePct}%</strong></div>
      </button>

      <button class="bento-card bento-reservations" type="button" data-go="reservations">
        <div class="bento-card-head"><span class="bento-icon purple">${icon("reservations")}</span><span>Reservas ativas</span><i></i></div>
        <div class="bento-number">${Number(reservations).toLocaleString("pt-BR")}</div>
        <p>agendamentos confirmados aguardando utilização</p>
      </button>

      <button class="bento-card bento-pending" type="button" data-go="withdrawals">
        <div class="bento-card-head"><span class="bento-icon dark">${icon("withdrawals")}</span><span>Devoluções pendentes</span><i></i></div>
        <div class="pending-layout"><div class="bento-number">${Number(pendingReturns).toLocaleString("pt-BR")}</div><span class="pending-badge">Agora</span></div>
        <p>${pendingReturns ? "Equipamentos ainda aguardando devolução." : "Nenhuma pendência de devolução no momento."}</p>
      </button>

      <section class="bento-card bento-actions">
        <div class="bento-section-title"><div><span class="eyebrow">Acesso rápido</span><h2>Ações</h2></div></div>
        <div class="bento-action-grid">
          <button type="button" class="bento-action primary-action" data-go="equipment"><span>${icon("equipment")}</span><b>Equipamentos</b><small>Consultar inventário</small></button>
          <button type="button" class="bento-action" data-go="withdrawals"><span>${icon("withdrawals")}</span><b>Retiradas</b><small>Uso e devolução</small></button>
          <button type="button" class="bento-action" data-go="reservations"><span>${icon("reservations")}</span><b>Reservas</b><small>Agenda futura</small></button>
          <button type="button" class="bento-action" data-go="carts"><span>${icon("qr")}</span><b>QR e carrinhos</b><small>Lotes e leitura</small></button>
        </div>
      </section>

      <section class="bento-card bento-activity">
        <div class="bento-section-title activity-title"><div><span class="eyebrow">Movimentação</span><h2>Retiradas recentes</h2></div><button class="text-action" data-open="withdrawals">Ver histórico</button></div>
        <div class="activity-table">${renderWithdrawalRows((current || []).slice(0,6))}</div>
      </section>
    </div>
  </section>`);

  qsa("[data-go],[data-open]").forEach(b => b.addEventListener("click", () => navigate(b.dataset.go || b.dataset.open)));
}
function equipmentRows(rows) {
  if (!rows.length) return `<div class="empty"><strong>Nenhum equipamento.</strong><span>Os registros aparecerão aqui.</span></div>`;
  return `<div class="data-list">${rows.map(e => `<button class="data-row" data-equipment="${esc(e.id)}" type="button"><div class="data-main"><strong>${esc(e.label || e.code)}</strong><span>${esc(e.brand)} ${esc(e.model)} · ${esc(e.asset_tag || e.code)}</span></div><span class="status status-${esc(e.status)}">${esc(statusLabel(e.status))}</span><span class="data-date">${esc(dt(e.updated_at))}</span></button>`).join("")}</div>`;
}
function bindEquipmentRowClicks(root = document) { qsa("[data-equipment]", root).forEach(r => r.addEventListener("click", () => openEquipment(r.dataset.equipment))); }
function cleanSearch(value) { return value.replace(/[,%()]/g, " ").trim().slice(0,80); }
async function renderEquipment() {
  state.view = "equipment"; const admin = state.profile.role === "admin"; const from = state.equipmentPage * config.pageSize; const to = from + config.pageSize - 1;
  shell(`<section class="panel"><div class="toolbar"><input class="search" id="equipment-search" type="search" value="${esc(state.equipmentSearch)}" placeholder="Buscar número, patrimônio, nome, marca ou modelo"><div class="toolbar-actions">${admin ? `<button class="button ghost" id="import-equipment">Importar</button><button class="button primary" id="new-equipment">Novo equipamento</button>` : ""}</div></div><div id="equipment-results"><div class="loading">Carregando equipamentos…</div></div></section>`);
  let query = supabase.from("equipments").select("id,code,asset_tag,brand,model,label,status,is_active,created_at,updated_at,qr_token", { count: "exact" }).order("code").range(from,to);
  const search = cleanSearch(state.equipmentSearch); if (search) query = query.or(`code.ilike.%${search}%,asset_tag.ilike.%${search}%,label.ilike.%${search}%,brand.ilike.%${search}%,model.ilike.%${search}%`);
  const { data, count, error } = await query; const host = qs("#equipment-results");
  if (error) host.innerHTML = `<div class="empty"><strong>Não foi possível carregar.</strong><span>${esc(errText(error))}</span></div>`;
  else { host.innerHTML = `${equipmentRows(data||[])}<div class="pagination"><span>${count||0} registro(s)</span><div><button class="button small" id="prev" ${state.equipmentPage===0?"disabled":""}>Anterior</button><button class="button small" id="next" ${to+1>=(count||0)?"disabled":""}>Próxima</button></div></div>`; bindEquipmentRowClicks(host); }
  qs("#prev")?.addEventListener("click",()=>{state.equipmentPage--;renderEquipment()}); qs("#next")?.addEventListener("click",()=>{state.equipmentPage++;renderEquipment()});
  let timer; qs("#equipment-search")?.addEventListener("input", e => { clearTimeout(timer); timer=setTimeout(()=>{state.equipmentSearch=e.target.value;state.equipmentPage=0;renderEquipment()},220); });
  qs("#new-equipment")?.addEventListener("click",()=>openEquipmentForm()); qs("#import-equipment")?.addEventListener("click",openImportModal);
}
async function getEquipment(id) { const { data, error } = await supabase.from("equipments").select("*").eq("id",id).single(); if(error) throw error; return data; }
async function openEquipment(id) {
  let e; try { e = await getEquipment(id); } catch(error) { return notify(errText(error),"error"); }
  const admin = state.profile.role === "admin";
  const modal = makeModal(`<div class="panel-head"><div><span class="eyebrow">${esc(e.code)}</span><h2>${esc(e.label || `${e.brand} ${e.model}`)}</h2></div><button class="icon-button" data-close>×</button></div><div class="modal-body"><div class="detail-grid">${detail("Estado",statusLabel(e.status))}${detail("Patrimônio",e.asset_tag)}${detail("Marca",e.brand)}${detail("Modelo",e.model)}${detail("QR token",e.qr_token)}${detail("Atualizado",dt(e.updated_at))}</div><div class="modal-actions"><button class="button ghost" data-qr>QR Code</button>${e.status==="available"?`<button class="button ghost" data-reserve>Reservar</button><button class="button primary" data-checkout>Retirar</button>`:""}${e.status==="in_use"?`<button class="button primary" data-return>Devolver</button>`:""}${admin && !["in_use","maintenance"].includes(e.status)?`<button class="button ghost" data-maintenance>Manutenção</button>`:""}${admin?`<button class="button ghost" data-edit>Editar</button>`:""}</div></div>`, true);
  qs("[data-qr]",modal)?.addEventListener("click",()=>openQrModal(e.qr_token,e.label||e.code,`${e.brand} ${e.model}`));
  qs("[data-checkout]",modal)?.addEventListener("click",()=>{modal.remove();openCheckoutModal([e])});
  qs("[data-reserve]",modal)?.addEventListener("click",()=>{modal.remove();openReservationModal(e)});
  qs("[data-return]",modal)?.addEventListener("click",async()=>{const b=qs("[data-return]",modal);setBusy(b,true,"Devolvendo…");const {error}=await supabase.rpc("return_equipment",{p_equipment_id:e.id,p_client_action_id:uid()});setBusy(b,false);if(error)return notify(errText(error),"error");notify("Devolução registrada.","success");modal.remove();navigate(state.view)});
  qs("[data-maintenance]",modal)?.addEventListener("click",()=>{modal.remove();openMaintenanceModal(e)});
  qs("[data-edit]",modal)?.addEventListener("click",()=>{modal.remove();openEquipmentForm(e)});
}
function openEquipmentForm(item=null) {
  const m = makeModal(`<div class="panel-head"><div><span class="eyebrow">Administração</span><h2>${item?"Editar":"Novo"} equipamento</h2></div><button class="icon-button" data-close>×</button></div><div class="modal-body"><form id="equipment-form" class="form-grid"><label>Número / código<input name="code" required maxlength="80" value="${esc(item?.code||"")}"></label><label>Patrimônio<input name="asset_tag" maxlength="80" value="${esc(item?.asset_tag||"")}"></label><label>Nome opcional<input name="label" maxlength="120" value="${esc(item?.label||"")}"></label><label>Modelo<input name="model" required maxlength="120" value="${esc(item?.model||"")}"></label><label>Marca<input name="brand" maxlength="100" value="${esc(item?.brand||"")}" placeholder="Não informado"></label><label>Estado<select name="status">${["available","in_use","maintenance","unavailable"].map(s=>`<option value="${s}" ${item?.status===s?"selected":""}>${statusLabel(s)}</option>`).join("")}</select></label><label class="check span-2"><input name="is_active" type="checkbox" ${item?.is_active!==false?"checked":""}><span>Equipamento ativo no catálogo</span></label><div class="modal-actions span-2"><button class="button" data-close type="button">Cancelar</button><button class="button primary" type="submit">Salvar</button></div></form></div>`, true);
  qs("#equipment-form",m).addEventListener("submit",async ev=>{ev.preventDefault();const b=qs('button[type="submit"]',ev.currentTarget);setBusy(b,true,"Salvando…");const f=new FormData(ev.currentTarget);const payload={code:f.get("code").trim(),asset_tag:f.get("asset_tag").trim()||null,label:f.get("label").trim()||null,model:f.get("model").trim(),brand:f.get("brand").trim()||"Não informado",status:f.get("status"),is_active:f.get("is_active")==="on"};if(!item)payload.created_by=state.profile.id;const req=item?supabase.from("equipments").update(payload).eq("id",item.id):supabase.from("equipments").insert(payload);const {error}=await req;setBusy(b,false);if(error)return notify(errText(error),"error");notify(item?"Equipamento atualizado.":"Equipamento criado.","success");m.remove();renderEquipment()});
}
function openCheckoutModal(items) {
  const m=makeModal(`<div class="panel-head"><div><span class="eyebrow">Retirada</span><h2>${items.length===1?esc(items[0].label||items[0].code):`${items.length} equipamentos`}</h2></div><button class="icon-button" data-close>×</button></div><div class="modal-body"><form id="checkout-form" class="form-grid"><label>Turma<input name="class_name" required maxlength="120" placeholder="3º A"></label><label>Destino<input name="destination" required maxlength="160" placeholder="Sala 12"></label>${state.profile.role!=="student"&&items.length===1?`<label class="span-2">Aluno responsável (opcional)<input name="student_name" maxlength="120"></label>`:""}<div class="modal-actions span-2"><button class="button" data-close type="button">Cancelar</button><button class="button primary" type="submit">Confirmar retirada</button></div></form></div>`,true);
  qs("#checkout-form",m).addEventListener("submit",async ev=>{ev.preventDefault();const b=qs('button[type="submit"]',ev.currentTarget);setBusy(b,true,"Registrando…");const f=new FormData(ev.currentTarget);const action=uid();let result;if(items.length===1)result=await supabase.rpc("checkout_equipment",{p_equipment_id:items[0].id,p_class_name:f.get("class_name").trim(),p_destination:f.get("destination").trim(),p_student_name:f.get("student_name")?.trim()||null,p_client_action_id:action});else result=await supabase.rpc("checkout_batch",{p_equipment_ids:items.map(x=>x.equipment_id||x.id),p_class_name:f.get("class_name").trim(),p_destination:f.get("destination").trim(),p_client_action_id:action});setBusy(b,false);if(result.error)return notify(errText(result.error),"error");notify("Retirada registrada.","success");m.remove();navigate("withdrawals")});
}
function openReservationModal(e) {
  const now=new Date();now.setMinutes(now.getMinutes()-now.getTimezoneOffset()+30);const start=now.toISOString().slice(0,16);const endD=new Date(now.getTime()+60*60*1000);const end=endD.toISOString().slice(0,16);
  const m=makeModal(`<div class="panel-head"><div><span class="eyebrow">Reserva futura</span><h2>${esc(e.label||e.code)}</h2></div><button class="icon-button" data-close>×</button></div><div class="modal-body"><form id="reservation-form" class="form-grid"><label>Início<input type="datetime-local" name="start" required value="${start}"></label><label>Fim<input type="datetime-local" name="end" required value="${end}"></label><label>Turma<input name="class_name" required maxlength="120"></label><label>Destino<input name="destination" required maxlength="160"></label><label class="span-2">Observação<textarea name="notes" maxlength="800"></textarea></label><div class="modal-actions span-2"><button class="button" data-close type="button">Cancelar</button><button class="button primary" type="submit">Reservar</button></div></form></div>`,true);
  qs("#reservation-form",m).addEventListener("submit",async ev=>{ev.preventDefault();const b=qs('button[type="submit"]',ev.currentTarget);setBusy(b,true,"Reservando…");const f=new FormData(ev.currentTarget);const {error}=await supabase.rpc("create_reservation",{p_equipment_id:e.id,p_class_name:f.get("class_name").trim(),p_destination:f.get("destination").trim(),p_start_at:new Date(f.get("start")).toISOString(),p_end_at:new Date(f.get("end")).toISOString(),p_notes:f.get("notes").trim()||null,p_client_action_id:uid()});setBusy(b,false);if(error)return notify(errText(error),"error");notify("Reserva criada.","success");m.remove();navigate("reservations")});
}
function openMaintenanceModal(e) {
  const m=makeModal(`<div class="panel-head"><div><span class="eyebrow">Manutenção</span><h2>${esc(e.label||e.code)}</h2></div><button class="icon-button" data-close>×</button></div><div class="modal-body"><form id="maintenance-form" class="auth-form"><label>Motivo<input name="title" required maxlength="160" placeholder="Ex.: teclado com falha"></label><label>Observações<textarea name="notes" maxlength="1200"></textarea></label><div class="modal-actions"><button class="button" data-close type="button">Cancelar</button><button class="button primary" type="submit">Abrir manutenção</button></div></form></div>`);
  qs("#maintenance-form",m).addEventListener("submit",async ev=>{ev.preventDefault();const b=qs('button[type="submit"]',ev.currentTarget);setBusy(b,true,"Abrindo…");const f=new FormData(ev.currentTarget);const {error}=await supabase.rpc("open_maintenance",{p_equipment_id:e.id,p_title:f.get("title").trim(),p_notes:f.get("notes").trim()||null,p_client_action_id:uid()});setBusy(b,false);if(error)return notify(errText(error),"error");notify("Equipamento enviado para manutenção.","success");m.remove();navigate("maintenance")});
}
function openQrModal(token,title,subtitle="") {
  const m=makeModal(`<div class="printable"><div class="panel-head"><div><span class="eyebrow">QR permanente</span><h2>${esc(title)}</h2></div><button class="icon-button" data-close>×</button></div><div class="qr-card"><div id="qr-code"></div><strong>${esc(title)}</strong><small>${esc(subtitle)}</small><span>${esc(qrUrl(token))}</span><div class="modal-actions"><button class="button ghost" id="copy-qr">Copiar link</button><button class="button primary" id="print-qr">Imprimir</button></div></div></div>`);
  new window.QRCode(qs("#qr-code",m),{text:qrUrl(token),width:210,height:210,correctLevel:window.QRCode.CorrectLevel.M});
  qs("#copy-qr",m).addEventListener("click",async()=>{await navigator.clipboard.writeText(qrUrl(token));notify("Link copiado.","success")});qs("#print-qr",m).addEventListener("click",()=>window.print());
}

async function renderWithdrawals() {
  state.view="withdrawals"; shell(`<section class="panel"><div class="toolbar"><input id="withdrawal-search" class="search" type="search" placeholder="Buscar turma, destino, responsável ou equipamento"></div><div id="withdrawals"><div class="loading">Carregando retiradas…</div></div></section>`);
  await loadWithdrawals(""); let timer; qs("#withdrawal-search").addEventListener("input",e=>{clearTimeout(timer);timer=setTimeout(()=>loadWithdrawals(cleanSearch(e.target.value)),220)});
}
async function loadWithdrawals(search) { const {data,error}=await supabase.rpc("home_withdrawals",{p_query:search||null});const h=qs("#withdrawals");if(!h)return;if(error)h.innerHTML=`<div class="empty"><strong>Erro ao carregar.</strong><span>${esc(errText(error))}</span></div>`;else h.innerHTML=renderWithdrawalRows(data||[]); }
function renderWithdrawalRows(rows) { if(!rows.length)return `<div class="empty"><strong>Nenhuma retirada encontrada.</strong><span>As movimentações compatíveis com seu perfil aparecem aqui.</span></div>`;return `<div class="data-list">${rows.map(r=>`<div class="data-row"><div class="data-main"><strong>${esc(r.class_name||"Sem turma")} · ${esc(r.destination||"Sem destino")}</strong><span>${esc(r.responsible_name||"")}${r.student_name?` · Aluno: ${esc(r.student_name)}`:""} · ${Number(r.pending_count||0)} pendente(s) de ${Number(r.total_count||0)}</span></div><span class="status status-${esc(r.status)}">${esc(statusLabel(r.status))}</span><span class="data-date">${esc(dt(r.withdrawn_at))}</span></div>`).join("")}</div>`; }

async function renderReservations() {
  state.view="reservations"; shell(`<section class="panel"><div class="panel-head"><div><span class="eyebrow">Agenda</span><h2>Reservas futuras</h2></div></div><div id="reservations"><div class="loading">Carregando reservas…</div></div></section>`);
  const {data,error}=await supabase.from("reservations").select("id,equipment_id,user_id,class_name,destination,start_at,end_at,notes,status,withdrawal_id,created_at,equipments(code,label,brand,model,status)").order("start_at",{ascending:true}).limit(300);const h=qs("#reservations");if(error){h.innerHTML=`<div class="empty"><strong>Erro ao carregar.</strong><span>${esc(errText(error))}</span></div>`;return}if(!data?.length){h.innerHTML=`<div class="empty"><strong>Nenhuma reserva.</strong><span>Abra um equipamento disponível e escolha Reservar.</span></div>`;return}
  h.innerHTML=`<div class="data-list">${data.map(r=>{const expired=r.status==="confirmed"&&new Date(r.end_at)<new Date();const st=expired?"expired":r.status;return `<div class="data-row"><div class="data-main"><strong>${esc(r.equipments?.label||r.equipments?.code||"Equipamento")}</strong><span>${esc(r.class_name)} · ${esc(r.destination)} · ${esc(dt(r.start_at))} até ${esc(dt(r.end_at))}</span></div><span class="status status-${esc(st)}">${esc(statusLabel(st))}</span><div class="row-actions">${r.status==="confirmed"&&!expired?`<button class="button small" data-cancel-res="${r.id}">Cancelar</button><button class="button primary small" data-use-res="${r.id}">Retirar</button>`:""}</div></div>`}).join("")}</div>`;
  qsa("[data-cancel-res]").forEach(b=>b.addEventListener("click",async()=>{const ok=await confirmAction({title:"Cancelar reserva?",message:"O horário ficará disponível novamente para este equipamento.",confirmText:"Cancelar reserva",danger:true});if(!ok)return;setBusy(b,true,"…");const {error}=await supabase.rpc("cancel_reservation",{p_reservation_id:Number(b.dataset.cancelRes)});setBusy(b,false);if(error)return notify(errText(error),"error");notify("Reserva cancelada.","success");renderReservations()}));
  qsa("[data-use-res]").forEach(b=>b.addEventListener("click",async()=>{setBusy(b,true,"Retirando…");const {error}=await supabase.rpc("checkout_reservation",{p_reservation_id:Number(b.dataset.useRes),p_client_action_id:uid()});setBusy(b,false);if(error)return notify(errText(error),"error");notify("Reserva convertida em retirada.","success");navigate("withdrawals")}));
}

async function renderHistory() {
  state.view="history"; shell(`<section class="panel"><div class="filters"><input id="h-equipment" placeholder="Equipamento/patrimônio"><input id="h-student" placeholder="Aluno"><input id="h-class" placeholder="Turma"><select id="h-status"><option value="">Todos os estados</option><option value="open">Em aberto</option><option value="returned">Devolvido</option><option value="cancelled">Cancelado</option></select></div><div class="toolbar"><span class="muted">Últimos ${config.historyLimit} eventos por consulta</span><button class="button primary small" id="history-filter">Filtrar</button></div><div id="history"><div class="loading">Carregando histórico…</div></div></section>`);
  qs("#history-filter").addEventListener("click",loadHistory); await loadHistory();
}
async function loadHistory(){const p={p_from:null,p_to:null,p_equipment:qs("#h-equipment")?.value.trim()||null,p_label:null,p_student:qs("#h-student")?.value.trim()||null,p_professor:null,p_class_name:qs("#h-class")?.value.trim()||null,p_destination:null,p_status:qs("#h-status")?.value||null,p_equipment_id:null,p_limit:config.historyLimit};const {data,error}=await supabase.rpc("history_events",p);const h=qs("#history");if(!h)return;if(error){h.innerHTML=`<div class="empty"><strong>Erro ao carregar histórico.</strong><span>${esc(errText(error))}</span></div>`;return}if(!data?.length){h.innerHTML=`<div class="empty"><strong>Nenhum evento.</strong><span>Altere os filtros ou aguarde novas movimentações.</span></div>`;return}h.innerHTML=`<div class="data-list">${data.map(x=>`<div class="data-row"><div class="data-main"><strong>${esc(x.label||x.code)} · ${esc(x.brand)} ${esc(x.model)}</strong><span>${esc(x.class_name||"Sem turma")} · ${esc(x.destination||"Sem destino")}${x.student_name?` · ${esc(x.student_name)}`:""}</span></div><span class="status status-${esc(x.status)}">${esc(statusLabel(x.status))}</span><span class="data-date">${esc(dt(x.withdrawn_at))}</span></div>`).join("")}</div>`}

async function renderCarts() {
  state.view="carts";const admin=state.profile.role==="admin";shell(`<section class="panel"><div class="panel-head"><div><span class="eyebrow">Lotes</span><h2>Carrinhos de equipamentos</h2></div>${admin?`<button class="button primary" id="new-cart">Novo carrinho</button>`:""}</div><div id="carts"><div class="loading">Carregando carrinhos…</div></div></section>`);qs("#new-cart")?.addEventListener("click",openCartForm);const {data,error}=await supabase.rpc("cart_scan_catalog");const h=qs("#carts");if(error){h.innerHTML=`<div class="empty"><strong>Erro ao carregar.</strong><span>${esc(errText(error))}</span></div>`;return}if(!data?.length){h.innerHTML=`<div class="empty"><strong>Nenhum carrinho cadastrado.</strong><span>O administrador pode agrupar equipamentos por códigos.</span></div>`;return}h.innerHTML=`<div class="data-list">${data.map(c=>`<button class="data-row" type="button" data-cart-token="${esc(c.qr_token)}"><div class="data-main"><strong>${esc(c.cart_name||`Carrinho ${c.cart_number}`)}</strong><span>${Number(c.item_count||0)} equipamento(s) · ${esc((c.equipment_codes||[]).slice(0,8).join(", "))}</span></div><span class="status status-available">Ativo</span><span class="data-date">#${c.cart_number}</span></button>`).join("")}</div>`;qsa("[data-cart-token]").forEach(b=>b.addEventListener("click",()=>openCart(b.dataset.cartToken)));
}
async function openCart(token) {const {data,error}=await supabase.rpc("cart_scan_equipment_list",{p_qr_token:token});if(error)return notify(errText(error),"error");const items=data||[];if(!items.length)return notify("Carrinho vazio ou indisponível.","warning");const available=items.filter(x=>x.is_active&&x.status==="available");const m=makeModal(`<div class="panel-head"><div><span class="eyebrow">Carrinho ${items[0].cart_number}</span><h2>${esc(items[0].cart_name||`Carrinho ${items[0].cart_number}`)}</h2></div><button class="icon-button" data-close>×</button></div><div class="modal-body">${equipmentRows(items.map(x=>({id:x.equipment_id,...x})))}<div class="modal-actions"><button class="button ghost" data-cart-qr>QR Code</button>${available.length?`<button class="button primary" data-batch>Retirar ${available.length} disponível(is)</button>`:""}</div></div>`,true);bindEquipmentRowClicks(m);qs("[data-cart-qr]",m)?.addEventListener("click",()=>openQrModal(token,items[0].cart_name||`Carrinho ${items[0].cart_number}`,`${items.length} equipamentos`));qs("[data-batch]",m)?.addEventListener("click",()=>{m.remove();openCheckoutModal(available)});}
function openCartForm(){const m=makeModal(`<div class="panel-head"><div><span class="eyebrow">Administração</span><h2>Novo carrinho</h2></div><button class="icon-button" data-close>×</button></div><div class="modal-body"><form id="cart-form" class="auth-form"><label>Número<input name="number" type="number" min="1" required></label><label>Nome opcional<input name="name" maxlength="120"></label><label>Códigos dos equipamentos<textarea name="codes" required placeholder="001\n002\n003"></textarea></label><div class="modal-actions"><button class="button" data-close type="button">Cancelar</button><button class="button primary" type="submit">Criar carrinho</button></div></form></div>`);qs("#cart-form",m).addEventListener("submit",async e=>{e.preventDefault();const b=qs('button[type="submit"]',e.currentTarget);setBusy(b,true,"Salvando…");const f=new FormData(e.currentTarget);const codes=[...new Set(f.get("codes").split(/[\n,;]+/).map(x=>x.trim()).filter(Boolean))];const {error}=await supabase.rpc("save_equipment_cart",{p_cart_id:null,p_number:Number(f.get("number")),p_name:f.get("name").trim()||null,p_equipment_codes:codes});setBusy(b,false);if(error)return notify(errText(error),"error");notify("Carrinho criado.","success");m.remove();renderCarts()})}

async function renderMaintenance(){if(state.profile.role!=="admin")return navigate("dashboard");state.view="maintenance";shell(`<section class="panel"><div class="panel-head"><div><span class="eyebrow">Oficina</span><h2>Histórico de manutenção</h2></div></div><div id="maintenance"><div class="loading">Carregando…</div></div></section>`);const {data,error}=await supabase.from("maintenance_events").select("id,equipment_id,title,notes,resolution,status,opened_at,closed_at,equipments(code,label,brand,model)").order("opened_at",{ascending:false}).limit(300);const h=qs("#maintenance");if(error){h.innerHTML=`<div class="empty"><strong>Erro.</strong><span>${esc(errText(error))}</span></div>`;return}if(!data?.length){h.innerHTML=`<div class="empty"><strong>Nenhuma manutenção registrada.</strong><span>Abra um equipamento e escolha Manutenção.</span></div>`;return}h.innerHTML=`<div class="data-list">${data.map(x=>`<div class="data-row"><div class="data-main"><strong>${esc(x.equipments?.label||x.equipments?.code)} · ${esc(x.title)}</strong><span>${esc(x.equipments?.brand||"")} ${esc(x.equipments?.model||"")} · aberta ${esc(dt(x.opened_at))}</span></div><span class="status status-${esc(x.status)}">${esc(statusLabel(x.status))}</span><div class="row-actions">${x.status==="open"?`<button class="button primary small" data-resolve="${x.id}">Concluir</button>`:""}</div></div>`).join("")}</div>`;qsa("[data-resolve]").forEach(b=>b.addEventListener("click",()=>resolveMaintenance(Number(b.dataset.resolve))));}
function resolveMaintenance(id){const m=makeModal(`<div class="panel-head"><div><span class="eyebrow">Manutenção</span><h2>Concluir manutenção</h2></div><button class="icon-button" data-close>×</button></div><div class="modal-body"><form id="resolve-form" class="auth-form"><label>Resolução<textarea name="resolution" maxlength="1200" placeholder="O que foi feito"></textarea></label><div class="modal-actions"><button class="button" data-close type="button">Cancelar</button><button class="button primary" type="submit">Concluir</button></div></form></div>`);qs("#resolve-form",m).addEventListener("submit",async e=>{e.preventDefault();const b=qs('button[type="submit"]',e.currentTarget);setBusy(b,true,"Concluindo…");const f=new FormData(e.currentTarget);const {error}=await supabase.rpc("resolve_maintenance",{p_event_id:id,p_resolution:f.get("resolution").trim()||null});setBusy(b,false);if(error)return notify(errText(error),"error");notify("Manutenção concluída.","success");m.remove();renderMaintenance()})}

async function renderAdmin(){if(state.profile.role!=="admin")return navigate("dashboard");state.view="admin";shell(`<div class="split"><section class="panel"><div class="panel-head"><div><span class="eyebrow">Pessoas</span><h2>Usuários e cargos</h2></div></div><div id="users"><div class="loading">Carregando usuários…</div></div></section><div class="stack"><section class="panel"><div class="panel-head"><div><span class="eyebrow">500 MB</span><h2>Capacidade do banco</h2></div></div><div id="capacity"><div class="loading">Medindo…</div></div></section><section class="panel"><div class="panel-head"><div><span class="eyebrow">Ferramentas</span><h2>Inventário</h2></div></div><div class="panel-pad quick-grid"><div class="quick-card"><strong>Importar</strong><span>CSV/XLSX é validado no navegador e não fica armazenado.</span><button class="button small" id="admin-import">Importar arquivo</button></div><div class="quick-card"><strong>Exportar</strong><span>Gera XLSX direto no navegador.</span><button class="button small" id="admin-export">Exportar XLSX</button></div><div class="quick-card"><strong>QRs em lote</strong><span>Folha pronta para impressão dos equipamentos ativos.</span><button class="button small" id="admin-qrs">Gerar QRs</button></div></div></section></div></div>`);qs("#admin-import").addEventListener("click",openImportModal);qs("#admin-export").addEventListener("click",exportEquipments);qs("#admin-qrs").addEventListener("click",printQrBatch);await Promise.all([loadAdminUsers(),loadCapacity()]);}
async function loadAdminUsers(){const {data,error}=await supabase.rpc("admin_user_list");const h=qs("#users");if(!h)return;if(error){h.innerHTML=`<div class="empty"><strong>Erro.</strong><span>${esc(errText(error))}</span></div>`;return}h.innerHTML=`<div class="data-list">${(data||[]).map(u=>`<button class="data-row" type="button" data-user='${esc(JSON.stringify({id:u.id,full_name:u.full_name,role:u.role,email:u.email}))}'><div class="data-main"><strong>${esc(u.full_name||"Usuário")}</strong><span>${esc(maskEmail(u.email))}</span></div><span class="status">${esc(roleLabel(u.role))}</span><span class="data-date">${esc(dateOnly(u.created_at))}</span></button>`).join("")}</div>`;qsa("[data-user]").forEach(b=>b.addEventListener("click",()=>openUserForm(JSON.parse(b.dataset.user))));}
function openUserForm(u){const m=makeModal(`<div class="panel-head"><div><span class="eyebrow">Usuário</span><h2>${esc(u.full_name)}</h2></div><button class="icon-button" data-close>×</button></div><div class="modal-body"><form id="user-form" class="auth-form"><label>Nome<input name="full_name" required maxlength="120" value="${esc(u.full_name)}"></label><label>Cargo<select name="role">${["student","teacher","admin"].map(r=>`<option value="${r}" ${u.role===r?"selected":""}>${roleLabel(r)}</option>`).join("")}</select></label><div class="modal-actions"><button class="button" data-close type="button">Cancelar</button><button class="button primary" type="submit">Salvar</button></div></form></div>`);qs("#user-form",m).addEventListener("submit",async e=>{e.preventDefault();const b=qs('button[type="submit"]',e.currentTarget);setBusy(b,true,"Salvando…");const f=new FormData(e.currentTarget);const {error}=await supabase.rpc("admin_update_user",{p_user_id:u.id,p_full_name:f.get("full_name").trim(),p_role:f.get("role")});setBusy(b,false);if(error)return notify(errText(error),"error");notify("Usuário atualizado.","success");m.remove();loadAdminUsers()})}
async function loadCapacity(){const {data,error}=await supabase.rpc("admin_capacity_status");const h=qs("#capacity");if(!h)return;if(error){h.innerHTML=`<div class="empty"><strong>Não foi possível medir.</strong><span>${esc(errText(error))}</span></div>`;return}const x=Array.isArray(data)?data[0]:data;h.innerHTML=`<div class="capacity"><div class="capacity-top"><div><span class="eyebrow">Uso atual</span><strong>${Number(x.database_mb).toLocaleString("pt-BR",{maximumFractionDigits:2})} MB</strong></div><span class="status status-${x.policy_state==='normal'?'available':'maintenance'}">${esc(x.policy_state)}</span></div><div class="capacity-track"><div class="capacity-fill" style="width:${Math.min(100,Number(x.percent_of_free_limit))}%"></div></div><small>${Number(x.percent_of_free_limit).toFixed(2)}% de ${x.free_limit_mb} MB · preparar em ${x.prepare_mb} MB · arquivar em ${x.archive_mb} MB · limpeza em ${x.purge_mb} MB</small></div>`;}

function normalizeHeader(v){return String(v||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").trim().toLowerCase().replace(/\s+/g,"_")}
function fieldFromRow(row, names){for(const n of names){const key=Object.keys(row).find(k=>normalizeHeader(k)===n);if(key!==undefined&&String(row[key]??"").trim()!=="")return String(row[key]).trim()}return ""}
function mapImportRows(raw){const seen=new Set();return raw.map((r,i)=>{const code=fieldFromRow(r,["numero","codigo","code","n","id"]);const asset=fieldFromRow(r,["patrimonio","asset_tag","asset"]);const model=fieldFromRow(r,["modelo","model"]);const label=fieldFromRow(r,["nome","label","rotulo"]);const brand=fieldFromRow(r,["marca","brand","fabricante"])||"Não informado";let status=normalizeHeader(fieldFromRow(r,["estado","status"])||"available");status=({disponivel:"available",em_uso:"in_use",manutencao:"maintenance",indisponivel:"unavailable"})[status]||status;if(!["available","in_use","maintenance","unavailable"].includes(status))status="available";const errors=[];if(!code)errors.push("Número/código obrigatório");if(!model)errors.push("Modelo obrigatório");if(code&&seen.has(code.toLowerCase()))errors.push("Código duplicado no arquivo");if(code)seen.add(code.toLowerCase());return{line:i+2,code,asset_tag:asset||null,brand,model,label:label||null,status,is_active:true,errors}})}
function openImportModal(){const m=makeModal(`<div class="panel-head"><div><span class="eyebrow">Importação</span><h2>CSV ou Excel</h2></div><button class="icon-button" data-close>×</button></div><div class="modal-body"><p class="muted">Colunas reconhecidas: Número/Código, Patrimônio, Modelo, Nome, Marca e Estado. O arquivo é processado somente no navegador.</p><input id="import-file" type="file" accept=".csv,.xlsx,.xls"><div id="import-preview" style="margin-top:14px"></div></div>`,true);qs("#import-file",m).addEventListener("change",async e=>{const file=e.target.files?.[0];if(!file)return;if(file.size>config.importMaxBytes)return notify("Arquivo maior que 5 MB.","error");try{const buf=await file.arrayBuffer();const wb=window.XLSX.read(buf,{type:"array"});const raw=window.XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]],{defval:""});const rows=mapImportRows(raw);showImportPreview(m,rows)}catch(error){notify(`Não foi possível ler o arquivo: ${error.message}`,"error")}})}
function showImportPreview(modal,rows){const valid=rows.filter(r=>!r.errors.length);const host=qs("#import-preview",modal);host.innerHTML=`<div class="import-preview"><table class="preview-table"><thead><tr><th>Linha</th><th>Código</th><th>Modelo</th><th>Nome</th><th>Estado</th><th>Validação</th></tr></thead><tbody>${rows.slice(0,200).map(r=>`<tr><td>${r.line}</td><td>${esc(r.code||"—")}</td><td>${esc(r.model||"—")}</td><td>${esc(r.label||"—")}</td><td>${esc(statusLabel(r.status))}</td><td class="${r.errors.length?"preview-error":""}">${esc(r.errors.join("; ")||"OK")}</td></tr>`).join("")}</tbody></table></div><div class="modal-actions"><span class="muted">${valid.length} válido(s) de ${rows.length}</span><button class="button primary" id="confirm-import" ${valid.length?"":"disabled"}>Importar válidos</button></div>`;qs("#confirm-import",modal)?.addEventListener("click",()=>performImport(modal,valid));}
async function performImport(modal,rows){const b=qs("#confirm-import",modal);setBusy(b,true,"Importando…");let inserted=0,skipped=0;try{for(let i=0;i<rows.length;i+=100){const chunk=rows.slice(i,i+100);const codes=chunk.map(r=>r.code);const {data:existing,error:e1}=await supabase.from("equipments").select("code").in("code",codes);if(e1)throw e1;const set=new Set((existing||[]).map(x=>x.code.toLowerCase()));const payload=chunk.filter(r=>!set.has(r.code.toLowerCase())).map(({line,errors,...r})=>({...r,created_by:state.profile.id}));skipped+=chunk.length-payload.length;if(payload.length){const {error}=await supabase.from("equipments").insert(payload);if(error)throw error;inserted+=payload.length}}notify(`${inserted} equipamento(s) importado(s)${skipped?` · ${skipped} duplicado(s) ignorado(s)`:""}.`,"success");modal.remove();renderEquipment()}catch(error){notify(errText(error),"error")}finally{setBusy(b,false)}}
async function fetchAllEquipments(limit=10000){const all=[];for(let from=0;from<limit;from+=500){const {data,error}=await supabase.from("equipments").select("code,asset_tag,brand,model,label,status,is_active,qr_token,created_at,updated_at").order("code").range(from,from+499);if(error)throw error;all.push(...(data||[]));if((data||[]).length<500)break}return all}
async function exportEquipments(){try{const rows=await fetchAllEquipments();const sheet=window.XLSX.utils.json_to_sheet(rows.map(x=>({Numero:x.code,Patrimonio:x.asset_tag||"",Marca:x.brand,Modelo:x.model,Nome:x.label||"",Estado:statusLabel(x.status),Ativo:x.is_active?"Sim":"Não",QR:x.qr_token,Criado:x.created_at,Atualizado:x.updated_at})));const wb=window.XLSX.utils.book_new();window.XLSX.utils.book_append_sheet(wb,sheet,"Equipamentos");window.XLSX.writeFile(wb,`Dasein-equipamentos-${new Date().toISOString().slice(0,10)}.xlsx`)}catch(error){notify(errText(error),"error")}}
async function printQrBatch(){try{const {data,error}=await supabase.from("equipments").select("code,label,brand,model,qr_token").eq("is_active",true).order("code").limit(200);if(error)throw error;const m=makeModal(`<div class="printable"><div class="panel-head"><div><span class="eyebrow">Impressão</span><h2>QR Codes · ${data.length} equipamento(s)</h2></div><button class="icon-button" data-close>×</button></div><div class="modal-body"><div id="qr-batch" style="display:grid;grid-template-columns:repeat(3,1fr);gap:14px"></div><div class="modal-actions"><button class="button primary" id="print-batch">Imprimir</button></div></div></div>`,true);const h=qs("#qr-batch",m);data.forEach((e,i)=>{const card=document.createElement("div");card.style.cssText="border:1px solid #ddd;border-radius:10px;padding:12px;text-align:center;break-inside:avoid";card.innerHTML=`<div id="qrb-${i}" style="display:grid;place-items:center"></div><strong style="display:block;margin-top:8px">${esc(e.label||e.code)}</strong><small>${esc(e.code)} · ${esc(e.model)}</small>`;h.append(card);new window.QRCode(qs(`#qrb-${i}`,card),{text:qrUrl(e.qr_token),width:112,height:112,correctLevel:window.QRCode.CorrectLevel.M})});qs("#print-batch",m).addEventListener("click",()=>window.print());if(data.length===200)notify("A impressão em lote foi limitada aos primeiros 200 equipamentos para proteger o navegador.","warning")}catch(error){notify(errText(error),"error")}}

async function handleScanAfterLogin(){const token=scanTokenFromUrl();if(!token)return false;const scan=await scanPublic(token);if(!scan){notify("QR inválido ou inativo.","error");return false}state.pendingScan=scan;if(scan.kind==="cart"){state.view="carts";await renderCarts();await openCart(token);return true}const {data,error}=await supabase.from("equipments").select("id").eq("qr_token",token).maybeSingle();if(error||!data)return false;state.view="equipment";await renderEquipment();await openEquipment(data.id);return true}
async function initSession(session){state.session=session;try{await loadProfile()}catch(error){notify("Sua conta existe, mas o perfil escolar ainda não foi criado.","error");await supabase.auth.signOut();return}if(!(await handleScanAfterLogin()))await renderDashboard()}
async function boot(){const token=scanTokenFromUrl();const [{data:{session}},scan]=await Promise.all([supabase.auth.getSession(),scanPublic(token)]);if(session)await initSession(session);else renderAuth(scan);supabase.auth.onAuthStateChange(async(event,sessionNow)=>{if(event==="SIGNED_OUT"||!sessionNow){state.session=null;state.profile=null;renderAuth(await scanPublic(scanTokenFromUrl()));return}if(event==="SIGNED_IN"&&(!state.session||state.session.user.id!==sessionNow.user.id))await initSession(sessionNow)})}

boot().catch(error=>{console.error(error);app.innerHTML=`<main class="boot"><div><strong>O Dasein encontrou um erro.</strong><span>${esc(errText(error))}</span></div></main>`});
