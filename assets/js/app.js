import { supabase, isConfigured, config } from "./supabase.js";

const app = document.querySelector("#app");
const state = {
  session: null,
  profile: null,
  currentView: "dashboard",
  equipmentPage: 0,
  equipmentSearch: ""
};

const qs = (selector, root = document) => root.querySelector(selector);
const qsa = (selector, root = document) => [...root.querySelectorAll(selector)];

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatDateTime(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short"
  }).format(date);
}

function statusLabel(status) {
  const map = {
    available: "Disponível",
    reserved: "Reservado",
    in_use: "Em uso",
    maintenance: "Manutenção",
    inactive: "Inativo"
  };
  return map[status] ?? status ?? "—";
}

function roleLabel(role) {
  const map = {
    student: "Aluno",
    teacher: "Professor",
    staff: "Funcionário/Técnico",
    admin: "Administrador"
  };
  return map[role] ?? role ?? "Usuário";
}

function notify(message, type = "info") {
  let host = qs("#toast-host");
  if (!host) {
    host = document.createElement("div");
    host.id = "toast-host";
    host.className = "toast-host";
    document.body.append(host);
  }

  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  host.append(toast);
  window.setTimeout(() => toast.remove(), 4200);
}

function setBusy(button, busy, text = "Aguarde…") {
  if (!button) return;
  if (busy) {
    button.dataset.oldText = button.textContent;
    button.textContent = text;
    button.disabled = true;
  } else {
    button.textContent = button.dataset.oldText || button.textContent;
    button.disabled = false;
  }
}

function renderSetup() {
  app.innerHTML = `
    <main class="setup-shell">
      <section class="setup-card">
        <div class="brand-row">
          <div class="brand-mark">D</div>
          <div>
            <span class="eyebrow">Dasein 0.0.1</span>
            <h1>Conecte o Supabase</h1>
          </div>
        </div>
        <p class="muted">A interface já está pronta para GitHub Pages, mas ainda faltam as duas informações públicas do projeto Supabase.</p>
        <ol class="setup-list">
          <li>Crie ou escolha o projeto Supabase do Dasein.</li>
          <li>Execute <code>supabase/001_initial.sql</code> no SQL Editor.</li>
          <li>Abra <code>assets/js/config.js</code> no GitHub e preencha a URL e a <strong>publishable key</strong>.</li>
          <li>Ative o GitHub Pages na raiz da branch publicada.</li>
        </ol>
        <div class="security-note">
          <strong>Importante:</strong> use apenas <code>sb_publishable_...</code>. Chaves secretas nunca entram no Pages.
        </div>
      </section>
    </main>`;
}

function renderAuth(publicEquipment = null) {
  const equipmentId = new URLSearchParams(location.search).get("e");

  app.innerHTML = `
    <main class="auth-shell">
      <section class="auth-panel">
        <div class="auth-copy">
          <div class="brand-row">
            <div class="brand-mark">D</div>
            <strong>Dasein</strong>
          </div>
          <span class="eyebrow">Equipamentos escolares</span>
          <h1>Controle simples para uma operação que não pode ser bagunçada.</h1>
          <p>Reservas, retiradas, devoluções, manutenção e histórico em uma única plataforma.</p>
        </div>

        <div class="auth-card">
          <div class="auth-tabs" role="tablist" aria-label="Acesso">
            <button class="auth-tab active" data-auth-tab="login" type="button">Entrar</button>
            <button class="auth-tab" data-auth-tab="signup" type="button">Criar conta</button>
          </div>

          <form id="login-form" class="auth-form">
            <label>E-mail
              <input id="login-email" type="email" autocomplete="email" required placeholder="seu@email.com">
            </label>
            <label>Senha
              <input id="login-password" type="password" autocomplete="current-password" minlength="6" required placeholder="••••••••">
            </label>
            <button class="button primary full" type="submit">Entrar</button>
            <button class="link-button" id="forgot-password" type="button">Esqueci minha senha</button>
          </form>

          <form id="signup-form" class="auth-form hidden">
            <label>Nome completo
              <input id="signup-name" type="text" autocomplete="name" minlength="3" maxlength="120" required placeholder="Nome completo">
            </label>
            <label>E-mail
              <input id="signup-email" type="email" autocomplete="email" required placeholder="seu@email.com">
            </label>
            <label>Senha
              <input id="signup-password" type="password" autocomplete="new-password" minlength="8" required placeholder="Mínimo de 8 caracteres">
            </label>
            <label class="check-row">
              <input id="signup-terms" type="checkbox" required>
              <span>Li e concordo em revisar os Termos de Uso e a Política de Privacidade no primeiro acesso.</span>
            </label>
            <button class="button primary full" type="submit">Criar conta</button>
          </form>

          ${publicEquipment ? `<div class="qr-preview"><span class="eyebrow">Equipamento identificado</span><strong>${escapeHtml(publicEquipment.display_name)}</strong><span>${escapeHtml(publicEquipment.model || "Modelo não informado")} · ${escapeHtml(publicEquipment.asset_number || publicEquipment.public_id)}</span><span class="status status-${escapeHtml(publicEquipment.status)}">${escapeHtml(statusLabel(publicEquipment.status))}</span><small>Entre para ver ações compatíveis com sua permissão.</small></div>` : (equipmentId ? `<div class="qr-hint">QR informado: <strong>${escapeHtml(equipmentId)}</strong>. Entre para continuar.</div>` : "")}
        </div>
      </section>
    </main>`;

  bindAuthEvents();
}

function bindAuthEvents() {
  qsa("[data-auth-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      qsa("[data-auth-tab]").forEach((item) => item.classList.toggle("active", item === button));
      qs("#login-form").classList.toggle("hidden", button.dataset.authTab !== "login");
      qs("#signup-form").classList.toggle("hidden", button.dataset.authTab !== "signup");
    });
  });

  qs("#login-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = qs('button[type="submit"]', event.currentTarget);
    setBusy(button, true, "Entrando…");
    const email = qs("#login-email").value.trim();
    const password = qs("#login-password").value;
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(button, false);
    if (error) notify(error.message, "error");
  });

  qs("#signup-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = qs('button[type="submit"]', event.currentTarget);
    setBusy(button, true, "Criando…");

    const fullName = qs("#signup-name").value.trim();
    const email = qs("#signup-email").value.trim();
    const password = qs("#signup-password").value;

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: fullName }
      }
    });

    setBusy(button, false);
    if (error) return notify(error.message, "error");

    if (data.session) {
      notify("Conta criada.", "success");
    } else {
      notify("Conta criada. Confira seu e-mail para confirmar o acesso.", "success");
      qsa("[data-auth-tab]")[0]?.click();
    }
  });

  qs("#forgot-password")?.addEventListener("click", async () => {
    const email = qs("#login-email").value.trim();
    if (!email) return notify("Digite seu e-mail primeiro.", "error");

    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${location.origin}${location.pathname}`
    });

    if (error) notify(error.message, "error");
    else notify("Enviamos as instruções de recuperação.", "success");
  });
}

async function loadProfile() {
  if (!state.session?.user) return null;
  const { data, error } = await supabase
    .from("profiles")
    .select("id, full_name, role, active")
    .eq("id", state.session.user.id)
    .single();

  if (error) {
    notify("Não foi possível carregar seu perfil.", "error");
    return null;
  }
  state.profile = data;
  return data;
}

async function ensureTerms() {
  const version = config.termsVersion;
  const { data, error } = await supabase
    .from("term_acceptances")
    .select("id")
    .eq("user_id", state.session.user.id)
    .eq("version", version)
    .maybeSingle();

  if (error) {
    notify("Não foi possível verificar os termos.", "error");
    return false;
  }
  if (data) return true;

  return new Promise((resolve) => {
    const modal = document.createElement("div");
    modal.className = "modal-backdrop";
    modal.innerHTML = `
      <section class="modal" role="dialog" aria-modal="true" aria-labelledby="terms-title">
        <span class="eyebrow">Versão ${escapeHtml(version)}</span>
        <h2 id="terms-title">Termos e privacidade</h2>
        <div class="terms-box">
          <p>O Dasein utiliza dados de conta e registros operacionais necessários para reservas, retiradas, devoluções, manutenção e auditoria escolar.</p>
          <p>O acesso deve seguir as regras definidas pela instituição. Esta versão inicial registra o aceite da versão apresentada para manter histórico de consentimentos e ciência do usuário.</p>
          <p>A política jurídica definitiva da escola deverá substituir este texto antes da implantação oficial.</p>
        </div>
        <label class="check-row">
          <input id="accept-terms" type="checkbox">
          <span>Li e aceito esta versão dos documentos.</span>
        </label>
        <button id="confirm-terms" class="button primary full" type="button" disabled>Continuar</button>
      </section>`;

    document.body.append(modal);
    const check = qs("#accept-terms", modal);
    const button = qs("#confirm-terms", modal);
    check.addEventListener("change", () => (button.disabled = !check.checked));
    button.addEventListener("click", async () => {
      setBusy(button, true, "Registrando…");
      const { error: insertError } = await supabase.from("term_acceptances").insert({
        user_id: state.session.user.id,
        version,
        accepted_at: new Date().toISOString()
      });
      setBusy(button, false);
      if (insertError) return notify("Não foi possível registrar o aceite.", "error");
      modal.remove();
      resolve(true);
    });
  });
}

function shell(content) {
  const profile = state.profile;
  const canAdmin = profile?.role === "admin";
  const canMaintain = ["admin", "staff"].includes(profile?.role);

  app.innerHTML = `
    <div class="app-shell">
      <aside class="sidebar" id="sidebar">
        <div class="sidebar-brand">
          <div class="brand-mark small">D</div>
          <div><strong>Dasein</strong><span>0.0.1</span></div>
        </div>
        <nav class="nav-list" aria-label="Principal">
          <button data-view="dashboard" class="nav-item ${state.currentView === "dashboard" ? "active" : ""}">Visão geral</button>
          <button data-view="equipment" class="nav-item ${state.currentView === "equipment" ? "active" : ""}">Equipamentos</button>
          <button data-view="reservations" class="nav-item ${state.currentView === "reservations" ? "active" : ""}">Reservas</button>
          ${canMaintain ? `<button data-view="maintenance" class="nav-item ${state.currentView === "maintenance" ? "active" : ""}">Manutenção</button>` : ""}
          ${canAdmin ? `<button data-view="admin" class="nav-item ${state.currentView === "admin" ? "active" : ""}">Administração</button>` : ""}
        </nav>
        <div class="sidebar-user">
          <div>
            <strong>${escapeHtml(profile?.full_name || "Usuário")}</strong>
            <span>${escapeHtml(roleLabel(profile?.role))}</span>
          </div>
          <button id="logout" class="icon-button" type="button" aria-label="Sair">↪</button>
        </div>
      </aside>

      <section class="main-area">
        <header class="topbar">
          <button id="menu-toggle" class="icon-button menu-toggle" type="button" aria-label="Abrir menu">☰</button>
          <div>
            <span class="eyebrow">Dasein</span>
            <h1 id="page-title">${pageTitle()}</h1>
          </div>
          <div class="topbar-actions">
            <span class="role-chip">${escapeHtml(roleLabel(profile?.role))}</span>
          </div>
        </header>
        <main class="content" id="content">${content}</main>
      </section>
    </div>`;

  bindShellEvents();
}

function pageTitle() {
  const map = {
    dashboard: "Visão geral",
    equipment: "Equipamentos",
    reservations: "Reservas",
    maintenance: "Manutenção",
    admin: "Administração"
  };
  return map[state.currentView] ?? "Dasein";
}

function bindShellEvents() {
  qsa("[data-view]").forEach((button) => {
    button.addEventListener("click", () => navigate(button.dataset.view));
  });
  qs("#logout")?.addEventListener("click", () => supabase.auth.signOut());
  qs("#menu-toggle")?.addEventListener("click", () => qs("#sidebar")?.classList.toggle("open"));
  qsa("[data-metric-view]").forEach((button) => {
    button.addEventListener("click", () => navigate(button.dataset.metricView));
  });
}

async function navigate(view) {
  state.currentView = view;
  qs("#sidebar")?.classList.remove("open");
  if (view === "equipment") return renderEquipment();
  if (view === "reservations") return renderPlaceholder("Reservas", "A estrutura está pronta. A próxima entrega liga criação, conflito de horários e cancelamento às funções atômicas do banco.");
  if (view === "maintenance") return renderPlaceholder("Manutenção", "O módulo entra na próxima camada operacional, usando histórico por equipamento e permissões de técnico/administrador.");
  if (view === "admin") return renderAdmin();
  return renderDashboard();
}

async function renderDashboard() {
  state.currentView = "dashboard";
  shell(`<div class="loading-card">Carregando indicadores…</div>`);

  const queries = await Promise.all([
    supabase.from("equipment").select("id", { count: "exact", head: true }),
    supabase.from("equipment").select("id", { count: "exact", head: true }).eq("status", "available"),
    supabase.from("equipment").select("id", { count: "exact", head: true }).eq("status", "in_use"),
    supabase.from("equipment").select("id", { count: "exact", head: true }).eq("status", "maintenance"),
    supabase.from("reservations").select("id", { count: "exact", head: true }).in("status", ["pending", "confirmed"])
  ]);

  const [total, available, inUse, maintenance, reservations] = queries.map((result) => result.count ?? 0);

  const { data: recent } = await supabase
    .from("equipment")
    .select("id, public_id, asset_number, name, model, status, updated_at")
    .order("updated_at", { ascending: false })
    .limit(6);

  shell(`
    <section class="metric-grid">
      ${metricCard("Equipamentos", total, "equipment")}
      ${metricCard("Disponíveis", available, "equipment")}
      ${metricCard("Em uso", inUse, "equipment")}
      ${metricCard("Manutenção", maintenance, "equipment")}
      ${metricCard("Reservas ativas", reservations, "reservations")}
    </section>

    <section class="panel">
      <div class="panel-head">
        <div><span class="eyebrow">Atualizações</span><h2>Equipamentos recentes</h2></div>
        <button class="button ghost" data-go-equipment type="button">Ver todos</button>
      </div>
      ${renderEquipmentRows(recent ?? [])}
    </section>`);

  qs("[data-go-equipment]")?.addEventListener("click", () => navigate("equipment"));
}

function metricCard(label, value, view) {
  return `<button class="metric-card" data-metric-view="${view}" type="button"><span>${escapeHtml(label)}</span><strong>${Number(value).toLocaleString("pt-BR")}</strong><small>Abrir detalhes</small></button>`;
}

async function renderEquipment() {
  state.currentView = "equipment";
  const from = state.equipmentPage * config.pageSize;
  const to = from + config.pageSize - 1;

  shell(`
    <section class="panel">
      <div class="toolbar">
        <div class="search-wrap">
          <input id="equipment-search" type="search" value="${escapeHtml(state.equipmentSearch)}" placeholder="Buscar patrimônio, nome ou modelo">
        </div>
        ${state.profile?.role === "admin" ? `<button id="new-equipment" class="button primary" type="button">Novo equipamento</button>` : ""}
      </div>
      <div id="equipment-results"><div class="loading-card">Carregando equipamentos…</div></div>
    </section>`);

  const search = state.equipmentSearch.trim();
  let query = supabase
    .from("equipment")
    .select("id, public_id, asset_number, name, category, manufacturer, model, location, status, updated_at", { count: "exact" })
    .order("updated_at", { ascending: false })
    .range(from, to);

  if (search) {
    const safe = search.replaceAll(",", " ");
    query = query.or(`asset_number.ilike.%${safe}%,name.ilike.%${safe}%,model.ilike.%${safe}%`);
  }

  const { data, count, error } = await query;
  const host = qs("#equipment-results");
  if (error) {
    host.innerHTML = `<div class="empty-state"><strong>Não foi possível carregar os equipamentos.</strong><span>${escapeHtml(error.message)}</span></div>`;
    return;
  }

  host.innerHTML = `
    ${renderEquipmentRows(data ?? [])}
    <div class="pagination">
      <span>${count ?? 0} registro(s)</span>
      <div>
        <button id="prev-page" class="button ghost" type="button" ${state.equipmentPage === 0 ? "disabled" : ""}>Anterior</button>
        <button id="next-page" class="button ghost" type="button" ${to + 1 >= (count ?? 0) ? "disabled" : ""}>Próxima</button>
      </div>
    </div>`;

  qsa("[data-equipment-id]").forEach((row) => row.addEventListener("click", () => openEquipment(row.dataset.equipmentId)));
  qs("#prev-page")?.addEventListener("click", () => { state.equipmentPage -= 1; renderEquipment(); });
  qs("#next-page")?.addEventListener("click", () => { state.equipmentPage += 1; renderEquipment(); });
  qs("#new-equipment")?.addEventListener("click", openEquipmentCreateModal);

  let timer;
  qs("#equipment-search")?.addEventListener("input", (event) => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      state.equipmentSearch = event.target.value;
      state.equipmentPage = 0;
      renderEquipment();
    }, 260);
  });
}

function renderEquipmentRows(rows) {
  if (!rows.length) return `<div class="empty-state"><strong>Nenhum equipamento encontrado.</strong><span>Quando houver registros, eles aparecem aqui.</span></div>`;

  return `
    <div class="data-list">
      ${rows.map((item) => `
        <button class="data-row" type="button" data-equipment-id="${escapeHtml(item.id)}">
          <div class="data-main">
            <strong>${escapeHtml(item.name || item.asset_number || item.model || "Equipamento")}</strong>
            <span>${escapeHtml(item.model || "Modelo não informado")} · ${escapeHtml(item.asset_number || "Sem patrimônio")}</span>
          </div>
          <span class="status status-${escapeHtml(item.status)}">${escapeHtml(statusLabel(item.status))}</span>
          <span class="data-date">${escapeHtml(formatDateTime(item.updated_at))}</span>
        </button>`).join("")}
    </div>`;
}

async function openEquipment(id) {
  const { data, error } = await supabase
    .from("equipment")
    .select("id, public_id, asset_number, name, category, manufacturer, model, serial_number, location, status, notes, allow_student_checkout, created_at, updated_at")
    .eq("id", id)
    .single();

  if (error) return notify("Equipamento não encontrado.", "error");

  const modal = document.createElement("div");
  modal.className = "modal-backdrop";
  modal.innerHTML = `
    <section class="modal wide" role="dialog" aria-modal="true">
      <div class="panel-head">
        <div>
          <span class="eyebrow">${escapeHtml(data.asset_number || data.public_id)}</span>
          <h2>${escapeHtml(data.name || data.model || "Equipamento")}</h2>
        </div>
        <button class="icon-button" data-close type="button" aria-label="Fechar">×</button>
      </div>
      <div class="detail-grid">
        ${detail("Estado", statusLabel(data.status))}
        ${detail("Modelo", data.model)}
        ${detail("Fabricante", data.manufacturer)}
        ${detail("Categoria", data.category)}
        ${detail("Localização", data.location)}
        ${detail("Patrimônio", data.asset_number)}
        ${detail("Identificador público", data.public_id)}
        ${detail("Atualizado", formatDateTime(data.updated_at))}
      </div>
      ${data.notes ? `<div class="notes-box">${escapeHtml(data.notes)}</div>` : ""}
      <div class="modal-actions">
        <button class="button ghost" data-copy-qr type="button">Copiar link do QR</button>
        ${state.profile?.role === "admin" ? `<button class="button primary" data-edit type="button">Editar</button>` : ""}
      </div>
    </section>`;

  document.body.append(modal);
  qs("[data-close]", modal).addEventListener("click", () => modal.remove());
  modal.addEventListener("click", (event) => { if (event.target === modal) modal.remove(); });
  qs("[data-copy-qr]", modal)?.addEventListener("click", async () => {
    const url = new URL(location.href);
    url.search = "";
    url.searchParams.set("e", data.public_id);
    await navigator.clipboard.writeText(url.toString());
    notify("Link do QR copiado.", "success");
  });
  qs("[data-edit]", modal)?.addEventListener("click", () => {
    modal.remove();
    openEquipmentEditModal(data);
  });
}

function detail(label, value) {
  return `<div class="detail-item"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value || "—")}</strong></div>`;
}

function openEquipmentCreateModal() {
  openEquipmentEditModal(null);
}

function openEquipmentEditModal(item) {
  const modal = document.createElement("div");
  modal.className = "modal-backdrop";
  modal.innerHTML = `
    <section class="modal wide" role="dialog" aria-modal="true">
      <div class="panel-head">
        <div><span class="eyebrow">Administração</span><h2>${item ? "Editar equipamento" : "Novo equipamento"}</h2></div>
        <button class="icon-button" data-close type="button" aria-label="Fechar">×</button>
      </div>
      <form id="equipment-form" class="form-grid">
        <label>Patrimônio<input name="asset_number" required maxlength="80" value="${escapeHtml(item?.asset_number || "")}"></label>
        <label>Nome opcional<input name="name" maxlength="120" value="${escapeHtml(item?.name || "")}"></label>
        <label>Categoria<input name="category" maxlength="80" value="${escapeHtml(item?.category || "")}"></label>
        <label>Fabricante<input name="manufacturer" maxlength="80" value="${escapeHtml(item?.manufacturer || "")}"></label>
        <label>Modelo<input name="model" maxlength="120" value="${escapeHtml(item?.model || "")}"></label>
        <label>Localização<input name="location" maxlength="120" value="${escapeHtml(item?.location || "")}"></label>
        <label>Estado
          <select name="status">
            ${["available","reserved","in_use","maintenance","inactive"].map((status) => `<option value="${status}" ${item?.status === status ? "selected" : ""}>${statusLabel(status)}</option>`).join("")}
          </select>
        </label>
        <label class="span-2">Observações<textarea name="notes" maxlength="1000" rows="4">${escapeHtml(item?.notes || "")}</textarea></label>
        <label class="check-row span-2"><input name="allow_student_checkout" type="checkbox" ${item?.allow_student_checkout ? "checked" : ""}><span>Permitir retirada direta por aluno quando não houver bloqueio de reserva.</span></label>
        <div class="modal-actions span-2">
          <button class="button ghost" data-close-form type="button">Cancelar</button>
          <button class="button primary" type="submit">Salvar</button>
        </div>
      </form>
    </section>`;

  document.body.append(modal);
  const close = () => modal.remove();
  qs("[data-close]", modal).addEventListener("click", close);
  qs("[data-close-form]", modal).addEventListener("click", close);
  qs("#equipment-form", modal).addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = qs('button[type="submit"]', event.currentTarget);
    setBusy(button, true, "Salvando…");
    const form = new FormData(event.currentTarget);
    const payload = {
      asset_number: form.get("asset_number")?.trim(),
      name: form.get("name")?.trim() || null,
      category: form.get("category")?.trim() || null,
      manufacturer: form.get("manufacturer")?.trim() || null,
      model: form.get("model")?.trim() || null,
      location: form.get("location")?.trim() || null,
      status: form.get("status"),
      notes: form.get("notes")?.trim() || null,
      allow_student_checkout: form.get("allow_student_checkout") === "on"
    };

    const request = item
      ? supabase.from("equipment").update(payload).eq("id", item.id)
      : supabase.from("equipment").insert(payload);
    const { error } = await request;
    setBusy(button, false);
    if (error) return notify(error.message, "error");
    notify(item ? "Equipamento atualizado." : "Equipamento criado.", "success");
    close();
    renderEquipment();
  });
}

function renderAdmin() {
  state.currentView = "admin";
  shell(`
    <section class="panel">
      <div class="panel-head"><div><span class="eyebrow">Administração</span><h2>Base operacional</h2></div></div>
      <div class="admin-grid">
        <div class="admin-tile"><strong>Equipamentos</strong><span>Cadastro, edição e QR já disponíveis nesta fundação.</span></div>
        <div class="admin-tile"><strong>Usuários e cargos</strong><span>Estrutura de perfis e cargos já existe no banco. A tela de gestão entra na próxima versão.</span></div>
        <div class="admin-tile"><strong>Auditoria</strong><span>O banco já possui tabela de auditoria preparada para as próximas operações críticas.</span></div>
      </div>
    </section>`);
}

function renderPlaceholder(title, text) {
  shell(`<section class="panel"><div class="empty-state large"><strong>${escapeHtml(title)}</strong><span>${escapeHtml(text)}</span></div></section>`);
}

async function openQrFromUrl() {
  const publicId = new URLSearchParams(location.search).get("e");
  if (!publicId) return false;

  const { data, error } = await supabase
    .from("equipment")
    .select("id")
    .eq("public_id", publicId)
    .maybeSingle();

  if (!error && data?.id) {
    state.currentView = "equipment";
    await renderEquipment();
    await openEquipment(data.id);
    return true;
  }
  notify("QR inválido ou equipamento indisponível.", "error");
  return false;
}

async function initAuthenticated(session) {
  state.session = session;
  await loadProfile();
  if (!state.profile?.active) {
    await supabase.auth.signOut();
    return notify("Sua conta está desativada.", "error");
  }
  const termsOk = await ensureTerms();
  if (!termsOk) return;
  const opened = await openQrFromUrl();
  if (!opened) await renderDashboard();
}

async function boot() {
  if (!isConfigured) return renderSetup();

  const { data: { session } } = await supabase.auth.getSession();
  if (session) {
    await initAuthenticated(session);
  } else {
    const publicId = new URLSearchParams(location.search).get("e");
    if (publicId) {
      const { data } = await supabase.rpc("get_public_equipment", { p_public_id: publicId });
      renderAuth(Array.isArray(data) ? data[0] : data);
    } else {
      renderAuth();
    }
  }

  supabase.auth.onAuthStateChange(async (event, sessionNow) => {
    if (event === "SIGNED_OUT" || !sessionNow) {
      state.session = null;
      state.profile = null;
      renderAuth();
      return;
    }

    if (["SIGNED_IN", "TOKEN_REFRESHED", "USER_UPDATED"].includes(event) && (!state.session || state.session.user.id !== sessionNow.user.id)) {
      await initAuthenticated(sessionNow);
    }
  });
}

boot().catch((error) => {
  console.error(error);
  app.innerHTML = `<main class="setup-shell"><section class="setup-card"><h1>O Dasein encontrou um erro.</h1><p class="muted">${escapeHtml(error?.message || "Erro inesperado")}</p></section></main>`;
});
