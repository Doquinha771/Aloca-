const { supabase, config } = window.EquipaSupabase || {};
if (!supabase || !config) throw new Error("Cliente Supabase não inicializado.");

const app = document.querySelector("#app");
const state = {
  session: null,
  profile: null,
  view: "dashboard",
  equipmentPage: 0,
  equipmentSearch: "",
  equipmentFilters: { status: "", active: "", group: "" },
  withdrawalsSearch: "",
  withdrawalsStatus: "",
  reservationsSearch: "",
  reservationsStatus: "",
  maintenanceSearch: "",
  maintenanceStatus: "",
  cartSearch: "",
  cartPage: 0,
  historyFiltersOpen: false,
  auditSearch: "",
  auditAction: "",
  auditEntity: "",
  pendingScan: null
};

const qs = (s, root = document) => root.querySelector(s);
const qsa = (s, root = document) => [...root.querySelectorAll(s)];
const esc = (v = "") => String(v).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
const uid = () => crypto.randomUUID();
const loadedScripts = new Map();
function loadScriptOnce(src, globalName) {
  if (globalName && window[globalName]) return Promise.resolve(window[globalName]);
  if (loadedScripts.has(src)) return loadedScripts.get(src);
  const promise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.onload = () => resolve(globalName ? window[globalName] : true);
    script.onerror = () => { loadedScripts.delete(src); reject(new Error("Não foi possível carregar um recurso necessário.")); };
    document.head.append(script);
  });
  loadedScripts.set(src, promise);
  return promise;
}
const ensureQRCodeLib = () => loadScriptOnce("https://cdn.jsdelivr.net/npm/qrcodejs@1.0.0/qrcode.min.js", "QRCode");
const ensureXLSXLib = () => loadScriptOnce("https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js", "XLSX");
const ensureJsQRLib = () => loadScriptOnce("https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js", "jsQR");
const ensureJSZipLib = () => loadScriptOnce("https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js", "JSZip");

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
function schoolGroupLabel(v) { return ({chromebook:"Chromebook",positivo_novo:"Positivo novo",positivo_tecnico:"Positivo técnico",positivo_antigo:"Positivo antigo",thinkpad_lenovo:"ThinkPad Lenovo",tablet:"Tablet",outro:"Outro"})[v] ?? v ?? "Não definido"; }
function schoolGroupOptions(selected=""){return [["chromebook","Chromebook"],["positivo_novo","Positivo novo"],["positivo_tecnico","Positivo técnico"],["positivo_antigo","Positivo antigo"],["thinkpad_lenovo","ThinkPad Lenovo"],["tablet","Tablet"],["outro","Outro"]].map(([v,l])=>`<option value="${v}" ${selected===v?"selected":""}>${l}</option>`).join("");}
function maskEmail(v = "") {
  const [name, domain] = String(v).split("@");
  if (!domain) return "—";
  return `${name.slice(0, Math.min(2, name.length))}${"*".repeat(Math.min(5, Math.max(2, name.length - 2)))}@${domain}`;
}
function errText(error) {
  const raw = error?.message || String(error || "Erro inesperado");
  if (/foreign key constraint|violates foreign key|23503/i.test(raw))
    return "Este registro possui histórico relacionado. Desative o equipamento em vez de excluí-lo.";
  if (/EQUIPA_RETURN_BEFORE_DEACTIVATE/.test(raw))
    return "Equipamento em uso. Registre a devolução antes de desativá-lo.";
  if (/EQUIPA_CANCEL_RESERVATIONS_FIRST/.test(raw))
    return "O equipamento tem reservas futuras. Cancele-as antes de desativá-lo.";
  if (/EQUIPA_ADMIN_REQUIRED/.test(raw))
    return "Apenas a administração pode executar esta ação.";
  const code = raw.match(/(ALOCA|DASEIN|EQUIPA)_[A-Z0-9_]+/)?.[0];
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
    DASEIN_MAINTENANCE_ALREADY_OPEN: "Já existe uma manutenção aberta para este equipamento.", DASEIN_EQUIPMENT_IN_USE: "Devolva o equipamento antes de colocá-lo em manutenção.",
    EQUIPA_ACCOUNT_DISABLED: "Esta conta está aguardando aprovação ou teve o acesso removido.", EQUIPA_LEGAL_VERSION_INVALID: "Versão dos documentos legais inválida."
  };
  return map[code] || raw.replace(/^.*ERROR:\s*/i, "");
}
function notify(message, type = "info") {
  const host = qs("#toast-host");
  if (!host) return;
  const titles = { success: "Concluído", error: "Não foi possível concluir", warning: "Atenção", info: "Equipa" };
  const marks = { success: "✓", error: "!", warning: "!", info: "i" };
  const el = document.createElement("section");
  el.className = `dasein-infobox ${type}`;
  el.setAttribute("role", type === "error" ? "alert" : "status");
  el.innerHTML = `<span class="infobox-mark" aria-hidden="true">${marks[type] || "i"}</span><div class="infobox-copy"><strong>${esc(titles[type] || "Equipa")}</strong><p>${esc(message)}</p></div><button class="infobox-close" type="button" aria-label="Fechar aviso">×</button><span class="infobox-timer" aria-hidden="true"></span>`;
  host.prepend(el);
  while (host.children.length > 4) host.lastElementChild?.remove();
  const remove = () => { el.classList.add("leaving"); setTimeout(() => el.remove(), 190); };
  qs(".infobox-close", el)?.addEventListener("click", remove);
  setTimeout(remove, type === "error" ? 7000 : 5000);
}
function confirmAction({ title = "Confirmar ação", message, confirmText = "Confirmar", cancelText = "Voltar", danger = false } = {}) {
  return new Promise(resolve => {
    const modal = makeModal(`<div class="confirm-box"><span class="confirm-symbol ${danger ? "danger" : ""}">${danger ? "!" : "?"}</span><div><span class="eyebrow">Equipa</span><h2>${esc(title)}</h2><p>${esc(message || "Confirme para continuar.")}</p></div></div><div class="modal-actions confirm-actions"><button class="button" type="button" data-confirm-no>${esc(cancelText)}</button><button class="button ${danger ? "danger-solid" : "primary"}" type="button" data-confirm-yes>${esc(confirmText)}</button></div>`);
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
      <div class="brandline"><div class="brandmark">E</div><strong>Equipa</strong></div>
      <div class="auth-brand-copy"><span class="eyebrow" style="color:rgba(255,255,255,.65)">Equipamentos escolares</span><h1>Um lugar para saber onde cada equipamento está.</h1><p>Reservas, retiradas, devoluções, carrinhos, QR Codes, manutenção e histórico em um único ambiente escolar.</p></div>
      <span class="auth-version">Equipa ${esc(config.version)} · Web</span>
    </section>
    <section class="auth-side">
      <div class="auth-card" id="auth-card">
        <span class="eyebrow">Acesso</span><h2>Entrar no Equipa</h2><p>Use sua conta escolar cadastrada.</p>
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
      </div><footer class="equipa-watermark auth-watermark">feito pela equipe da coordenação da escola e 3-A do ensino médio</footer>
    </section>
  </main>`;

  qsa("[data-tab]").forEach(btn => btn.addEventListener("click", () => {
    const card = qs("#auth-card");
    card?.classList.remove("switching");
    void card?.offsetWidth;
    card?.classList.add("switching");
    qsa("[data-tab]").forEach(x => x.classList.toggle("active", x === btn));
    qs("#login-form").classList.toggle("hidden", btn.dataset.tab !== "login");
    qs("#signup-form").classList.toggle("hidden", btn.dataset.tab !== "signup");
    setTimeout(() => card?.classList.remove("switching"), 220);
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
    if (data.session) await supabase.rpc("accept_legal_documents", { p_terms_version: config.legalTermsVersion, p_privacy_version: config.privacyVersion });
    notify(data.session ? "Conta criada." : "Conta criada. Confirme o e-mail para entrar.", "success");
    if (!data.session) qs('[data-tab="login"]').click();
  });
  qs("#forgot").addEventListener("click", async () => {
    const email = qs("#login-email").value.trim(); if (!email) return notify("Digite seu e-mail primeiro.", "warning");
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${location.origin}${location.pathname}` });
    notify(error ? errText(error) : "Instruções de recuperação enviadas.", error ? "error" : "success");
  });
}
function legalDocument(kind) {
  const terms = kind === "terms";
  if (terms) return `<div class="legal-doc contract-doc">
    <p class="legal-lead"><strong>TERMO DE USO E RESPONSABILIDADE DO EQUIPA</strong><br>Versão ${esc(config.legalTermsVersion)}. Este documento disciplina o uso da plataforma Equipa no ambiente escolar e integra as regras administrativas de controle do patrimônio tecnológico da unidade.</p>
    <h3>1. Finalidade institucional</h3><p>O Equipa é destinado exclusivamente ao inventário, reserva, retirada, devolução, manutenção, localização e auditoria de equipamentos da escola. O uso fora dessas finalidades, inclusive para testar acessos não autorizados ou alterar registros sem motivo administrativo, é vedado.</p>
    <h3>2. Acesso e autorização</h3><p>O acesso depende de conta individual e, quando exigido pela escola, aprovação administrativa. As permissões variam conforme o perfil atribuído. O usuário não adquire qualquer direito de administração por conhecer endereços, QR Codes, código-fonte público ou identificadores técnicos da plataforma.</p>
    <h3>3. Credenciais e segurança</h3><p>Senha, sessão e dispositivo autenticado são de uso pessoal. O usuário deve encerrar a sessão em equipamento compartilhado e comunicar imediatamente suspeita de invasão, perda de credencial ou operação registrada em seu nome que não reconheça.</p>
    <h3>4. Retiradas e devoluções</h3><p>Ao registrar uma retirada, o usuário declara que a movimentação corresponde à realidade. O equipamento permanece vinculado à retirada até que a devolução seja efetivamente registrada no Equipa. Data e horário de retirada e devolução compõem o histórico administrativo. Divergências devem ser comunicadas à coordenação para correção ou apuração.</p>
    <h3>5. Responsabilidade sobre equipamentos</h3><p>Durante a retirada, o usuário deve observar as regras internas de guarda e utilização do patrimônio. O registro no Equipa não cria, por si só, responsabilidade financeira automática por dano, perda ou defeito. Eventuais responsabilidades serão apuradas pela escola conforme normas aplicáveis, circunstâncias do fato e direito de manifestação do envolvido.</p>
    <h3>6. QR Codes e carrinhos</h3><p>QR Codes são identificadores operacionais. Fotografar, copiar ou conhecer um QR não concede autorização para retirar, devolver, editar ou administrar qualquer item. As ações continuam submetidas à autenticação, às permissões da conta e às regras do banco de dados.</p>
    <h3>7. Integridade dos registros</h3><p>É proibido falsificar nomes, turmas, destinos, horários, estados de equipamento, manutenção ou devolução; remover registros com a intenção de eliminar rastreabilidade; utilizar conta de terceiro; ou tentar contornar controles de acesso. A escola pode bloquear contas, preservar evidências e revisar registros quando necessário à segurança e à gestão patrimonial.</p>
    <h3>8. Auditoria</h3><p>Operações administrativas e movimentações relevantes podem gerar registros de auditoria contendo usuário, data, tipo de ação, entidade afetada e dados necessários à investigação. A auditoria existe para segurança, prestação de contas e correção de inconsistências.</p>
    <h3>9. Disponibilidade e manutenção</h3><p>A escola pode suspender temporariamente o Equipa, alterar fluxos, corrigir informações e realizar manutenção quando necessário. Falhas técnicas devem ser comunicadas e não autorizam o usuário a criar registros fictícios ou ignorar procedimentos administrativos alternativos definidos pela escola.</p>
    <h3>10. Suspensão e encerramento de acesso</h3><p>Contas podem ser aprovadas, suspensas, banidas ou ter o acesso removido pela administração quando houver desligamento, mudança de função, risco de segurança, uso incompatível com estes termos ou necessidade administrativa. O histórico já existente poderá ser preservado para manter a integridade dos registros escolares.</p>
    <h3>11. Alterações</h3><p>O documento pode ser atualizado para acompanhar mudanças legais, técnicas ou administrativas. Alterações relevantes geram nova versão e podem exigir nova ciência e aceite antes de continuar usando a plataforma.</p>
    <h3>12. Contato</h3><p>Dúvidas, contestação de registros ou solicitações relacionadas ao uso do Equipa devem ser encaminhadas pelo ${esc(config.privacyContact)}.</p>
    <h3>13. Aceite eletrônico e vigência</h3><p>Ao marcar a opção de ciência e continuar, o usuário registra eletronicamente o aceite da versão indicada destes Termos. O Equipa guarda a identificação da conta, a versão e a data do aceite para comprovação administrativa. O registro eletrônico não elimina o direito de questionar dados incorretos nem substitui procedimentos disciplinares ou patrimoniais previstos pela escola.</p>
    <p class="legal-note">O aceite confirma ciência das regras de uso da plataforma. Ele não substitui normas escolares, legislação aplicável nem autorizações específicas que possam ser exigidas em situações determinadas.</p>
  </div>`;
  return `<div class="legal-doc contract-doc">
    <p class="legal-lead"><strong>AVISO E POLÍTICA DE PRIVACIDADE DO EQUIPA</strong><br>Versão ${esc(config.privacyVersion)}. Este documento informa como dados pessoais são tratados na operação escolar do Equipa, em conformidade com a Lei nº 13.709/2018 (LGPD) e com as regras aplicáveis ao ambiente educacional.</p>
    <h3>1. Responsabilidade pelo tratamento</h3><p>${esc(config.controllerName)} define as finalidades administrativas do tratamento realizado no Equipa. O ${esc(config.privacyContact)} é o canal indicado para dúvidas, exercício de direitos e comunicação de incidentes relacionados à plataforma.</p>
    <h3>2. Dados necessários</h3><p>O sistema pode tratar nome, e-mail de autenticação, perfil de acesso, identificador de conta, turma, destino, registros de retirada e devolução, reservas, manutenção, ações administrativas e informações de auditoria. Dados técnicos dos equipamentos, como patrimônio, número de série, modelo, grupo e localização, não são dados pessoais por si só, mas podem ser associados a movimentações de usuários.</p>
    <h3>3. Dados que o Equipa procura não coletar</h3><p>A plataforma não necessita armazenar imagem da câmera usada para leitura de QR, contatos do aparelho, localização GPS, conteúdo pessoal do dispositivo ou senhas dos usuários. A câmera é usada apenas durante a leitura do código quando autorizada pelo navegador.</p>
    <h3>4. Finalidades</h3><p>Os dados são usados para autenticação, autorização, gestão do inventário, responsabilização administrativa por movimentações, devoluções, reservas, manutenção, prevenção de conflito, segurança, investigação de inconsistências, continuidade do serviço e prestação de contas da unidade escolar.</p>
    <h3>5. Bases legais</h3><p>O tratamento deve se apoiar nas hipóteses legais adequadas à atuação da unidade escolar, como cumprimento de obrigações legais ou regulatórias, execução de políticas públicas e procedimentos administrativos, proteção do patrimônio e outras bases aplicáveis ao caso concreto. A mera aceitação desta política não transforma consentimento em base legal universal.</p>
    <h3>6. Crianças e adolescentes</h3><p>Quando houver tratamento de dados de crianças ou adolescentes, a escola deve observar seu melhor interesse, limitar a coleta ao necessário e adotar salvaguardas compatíveis com o contexto educacional e com a legislação aplicável.</p>
    <h3>7. Acesso e compartilhamento</h3><p>Os dados ficam acessíveis conforme o perfil e a necessidade funcional. Administradores podem acessar informações adicionais indispensáveis à gestão e auditoria. Prestadores de infraestrutura podem processar dados estritamente para hospedagem, autenticação, banco de dados e segurança, de acordo com os serviços contratados.</p>
    <h3>8. Segurança</h3><p>O Equipa utiliza autenticação, controle de acesso por função, Row Level Security, operações administrativas executadas no servidor, QR Codes sem dados pessoais embutidos e registro de auditoria. Nenhum sistema é imune a incidentes; por isso, suspeitas devem ser comunicadas imediatamente para contenção e análise.</p>
    <h3>9. Retenção</h3><p>Dados pessoais e históricos operacionais devem ser mantidos apenas pelo período necessário às finalidades escolares, à segurança, à prestação de contas e às obrigações legais. O encerramento de uma conta não implica apagamento automático de registros cuja preservação seja necessária para manter a integridade do histórico patrimonial.</p>
    <h3>10. Direitos dos titulares</h3><p>Nos termos da LGPD, o titular pode solicitar informações e, quando aplicável, confirmação de tratamento, acesso, correção, anonimização, bloqueio, eliminação, informações sobre compartilhamento e revisão de questões relacionadas ao tratamento. O atendimento observará a legislação e hipóteses legítimas de conservação.</p>
    <h3>11. Correção de registros</h3><p>Quando um usuário identificar movimentação incorreta, dado pessoal desatualizado ou registro atribuído indevidamente, deve comunicar a escola. A correção deve preservar, quando necessário, a trilha de auditoria para que a alteração não seja confundida com ocultação do histórico.</p>
    <h3>12. Incidentes</h3><p>Suspeitas de vazamento, acesso indevido ou uso abusivo devem ser encaminhadas imediatamente ao canal responsável. A unidade escolar avaliará o evento e adotará as providências administrativas e legais cabíveis, inclusive comunicações exigidas pela legislação.</p>
    <h3>13. Atualizações</h3><p>Esta política pode ser atualizada. Mudanças relevantes serão identificadas por nova versão e poderão exigir nova ciência antes da continuidade do uso.</p>
    <p class="legal-note">A ciência desta política registra que o usuário recebeu as informações sobre o tratamento. Direitos previstos em lei não são renunciados pelo aceite.</p>
  </div>`;
}
function openLegal(kind) {
  const terms = kind === "terms";
  const legalBack = makeModal(`<div class="panel-head"><div><span class="eyebrow">Equipa · LGPD</span><h2>${terms ? "Termos de Uso" : "Política de Privacidade"}</h2></div><button class="icon-button" data-close>×</button></div><div class="modal-body legal-modal-body">${legalDocument(kind)}</div>`, true);
  legalBack.classList.add("legal-document-backdrop");
}
async function hasCurrentLegalAcceptance() {
  const { data, error } = await supabase.rpc("has_current_legal_acceptance", { p_terms_version: config.legalTermsVersion, p_privacy_version: config.privacyVersion });
  if (error) { console.warn("Legal acceptance check unavailable", error); return false; }
  return data === true;
}
function requestLegalAcceptance() {
  return new Promise(resolve => {
    const back = document.createElement("div");
    back.className = "modal-backdrop legal-gate-backdrop";
    back.innerHTML = `<section class="modal wide legal-gate" role="dialog" aria-modal="true"><div class="panel-head"><div><span class="eyebrow">Privacidade e uso responsável</span><h2>Antes de continuar no Equipa</h2></div></div><div class="modal-body"><p class="legal-gate-intro">Leia os documentos institucionais antes de continuar. O Equipa registra apenas a versão aceita, a conta e a data, mantendo a rastreabilidade exigida para o uso escolar.</p><div class="legal-gate-links"><button class="button" type="button" data-read-terms>Termos de Uso</button><button class="button" type="button" data-read-privacy>Política de Privacidade</button></div><label class="check legal-check"><input type="checkbox" id="legal-accept-check"><span>Li, compreendi e aceito as regras dos Termos de Uso e declaro ciência da Política de Privacidade, versões ${esc(config.legalTermsVersion)} e ${esc(config.privacyVersion)}.</span></label><div class="modal-actions"><button class="button ghost" type="button" data-legal-exit>Sair</button><button class="button primary" type="button" data-legal-accept disabled>Continuar</button></div></div></section>`;
    document.body.append(back);
    const check=qs("#legal-accept-check",back), accept=qs("[data-legal-accept]",back);
    check.addEventListener("change",()=>{accept.disabled=!check.checked});
    qs("[data-read-terms]",back).addEventListener("click",()=>openLegal("terms"));
    qs("[data-read-privacy]",back).addEventListener("click",()=>openLegal("privacy"));
    qs("[data-legal-exit]",back).addEventListener("click",async()=>{back.remove();await supabase.auth.signOut();resolve(false)});
    accept.addEventListener("click",async()=>{setBusy(accept,true,"Registrando…");const {error}=await supabase.rpc("accept_legal_documents",{p_terms_version:config.legalTermsVersion,p_privacy_version:config.privacyVersion});setBusy(accept,false);if(error)return notify(errText(error),"error");back.remove();notify("Preferências legais registradas.","success");resolve(true)});
  });
}
async function ensureLegalAcceptance(){if(await hasCurrentLegalAcceptance())return true;return requestLegalAcceptance();}

async function loadProfile() {
  const { data, error } = await supabase.from("profiles").select("id,full_name,role,is_active,disabled_at,created_at,updated_at").eq("id", state.session.user.id).single();
  if (error) throw error;
  state.profile = data;
}
function pageTitle() {
  return ({ dashboard: "Visão geral", equipment: "Equipamentos", withdrawals: "Retiradas", reservations: "Reservas", history: "Histórico", carts: "Carrinhos", maintenance: "Manutenção", admin: "Administração", audit: "Auditoria" })[state.view] || "Equipa";
}
function firstName() { return (state.profile?.full_name || "Usuário").trim().split(/\s+/)[0] || "Usuário"; }
function greeting() {
  const h = new Date().getHours();
  if (h < 12) return "Bom dia";
  if (h < 18) return "Boa tarde";
  return "Boa noite";
}
function icon() { return ""; }
function cleanupTransientUi(){closeContextMenu?.();qs("#filter-mobile-shade")?.remove();document.body.classList.remove("filter-sheet-open");}
function renderPendingApproval(){app.innerHTML=`<main class="pending-access"><div class="pending-card"><div class="brandmark">E</div><span class="eyebrow">Equipa</span><h1>Acesso indisponível</h1><p>Esta conta está aguardando aprovação, suspensa ou teve o acesso removido pela administração da escola. Nenhum inventário ou histórico fica disponível enquanto o acesso não estiver liberado.</p><button class="button primary" id="pending-signout" type="button">Sair da conta</button></div><footer class="equipa-watermark standalone">feito pela equipe da coordenação da escola e 3-A do ensino médio</footer></main>`;qs("#pending-signout")?.addEventListener("click",()=>supabase.auth.signOut());}
function shell(content) {
  cleanupTransientUi();
  const admin = state.profile?.role === "admin";
  const mobileMoreItems = `${nav("reservations","Reservas")}${nav("history","Histórico")}${nav("carts","Carrinhos")}${admin ? nav("maintenance","Manutenção") + nav("audit","Auditoria") + nav("admin","Administração") : ""}`;
  app.innerHTML = `<div class="app-shell">
    <aside class="sidebar" id="sidebar">
      <div class="sidebar-brand" title="Equipa"><div class="brandmark small">E</div><div class="brand-copy"><strong>Equipa</strong><span>Gestão escolar</span></div></div>
      <nav class="nav" aria-label="Navegação principal">
        ${nav("dashboard","Início")}${nav("equipment","Equipamentos")}${nav("withdrawals","Retiradas")}${nav("reservations","Reservas")}${nav("history","Histórico")}${nav("carts","Carrinhos")}${admin ? nav("maintenance","Manutenção") + nav("audit","Auditoria") + nav("admin","Administração") : ""}
      </nav>
      <div class="sidebar-user sidebar-user-simple"><button class="logout-button" id="logout" title="Sair" aria-label="Sair">Sair</button></div>
    </aside>
    <section class="main">
      <header class="topbar">
        <div class="topbar-greeting"><button class="nav-icon menu-toggle" id="menu" aria-label="Abrir menu">☰</button><div><span class="topbar-kicker">Equipa</span><strong>${esc(pageTitle())}</strong></div></div>
        <form class="global-search" id="global-search-form" role="search"><input id="global-search" type="search" value="${esc(currentGlobalSearchValue())}" placeholder="Pesquisar equipamento, turma, aluno ou manutenção" autocomplete="off"></form>
        <button class="account-chip" id="account-chip" type="button"><span><strong>Conta</strong><small>${esc(roleLabel(state.profile?.role))}</small></span></button>
      </header>
      <main class="content view-${esc(state.view)}">${content}</main><footer class="equipa-watermark">feito pela equipe da coordenação da escola e 3-A do ensino médio</footer>
    </section>
    <nav class="mobile-tabbar" aria-label="Navegação do aplicativo">
      ${mobileNav("dashboard","Início")}${mobileNav("equipment","Equipamentos")}<button class="mobile-nav-item mobile-qr-action" id="mobile-qr-scan" type="button" aria-label="Ler QR Code"><small>Ler QR</small></button>${mobileNav("withdrawals","Retiradas")}<button class="mobile-nav-item" id="mobile-more" type="button"><small>Mais</small></button>
    </nav>
    <div class="mobile-more-backdrop" id="mobile-more-backdrop"><section class="mobile-more-sheet"><div class="mobile-sheet-handle"></div><div class="mobile-sheet-head"><div><span>Mais opções</span><strong>Equipa</strong></div><button class="icon-button" id="mobile-more-close" type="button">×</button></div><div class="mobile-more-list">${mobileMoreItems}</div><button class="mobile-sheet-logout" id="mobile-sheet-logout" type="button"><span>Sair da conta</span></button></section></div>
  </div>`;
  qsa("[data-view]").forEach(b => b.addEventListener("click", () => navigate(b.dataset.view)));
  qs("#menu")?.addEventListener("click", () => qs("#sidebar")?.classList.toggle("open"));
  qs("#logout")?.addEventListener("click", () => supabase.auth.signOut());
  qs("#mobile-sheet-logout")?.addEventListener("click", () => supabase.auth.signOut());
  qs("#mobile-qr-scan")?.addEventListener("click", openMobileQrScanner);
  qs("#account-chip")?.addEventListener("click", () => navigate(admin ? "admin" : "dashboard"));
  const closeMobileMore = () => qs("#mobile-more-backdrop")?.classList.remove("open");
  qs("#mobile-more")?.addEventListener("click", () => qs("#mobile-more-backdrop")?.classList.add("open"));
  qs("#mobile-more-close")?.addEventListener("click", closeMobileMore);
  qs("#mobile-more-backdrop")?.addEventListener("click", e => { if (e.target?.id === "mobile-more-backdrop") closeMobileMore(); });
  qsa("#mobile-more-backdrop [data-view]").forEach(b => b.addEventListener("click", closeMobileMore));
  qs("#global-search-form")?.addEventListener("submit", e => {
    e.preventDefault();
    const term = qs("#global-search")?.value.trim() || "";
    if (!term) return;
    runSmartGlobalSearch(term);
  });
}
function nav(view, label) { return `<button type="button" class="nav-button ${state.view === view ? "active" : ""}" data-view="${view}" title="${esc(label)}" aria-label="${esc(label)}"><span class="nav-label">${esc(label)}</span></button>`; }
function mobileNav(view,label){return `<button type="button" class="mobile-nav-item ${state.view===view?"active":""}" data-view="${view}"><small>${esc(label)}</small></button>`;}
async function navigate(view) {
  state.view = view; qs("#sidebar")?.classList.remove("open");
  if (view === "equipment") return renderEquipment();
  if (view === "withdrawals") return renderWithdrawals();
  if (view === "reservations") return renderReservations();
  if (view === "history") return renderHistory();
  if (view === "carts") return renderCarts();
  if (view === "maintenance") return renderMaintenance();
  if (view === "audit") return renderAudit();
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
  const safeTotal = Math.max(total,1);
  const availablePct = Math.round(available/safeTotal*100);
  const inUsePct = Math.round(inUse/safeTotal*100);
  const maintenancePct = Math.round(maintenance/safeTotal*100);
  const today = new Intl.DateTimeFormat("pt-BR", { weekday:"long", day:"2-digit", month:"long" }).format(new Date());

  const recentMobile = (current || []).slice(0,4);
  shell(`<section class="future-home desktop-dashboard">
    <header class="future-welcome"><div><span class="future-breadcrumb">Início</span><h1>Olá, ${esc(firstName())}</h1><p>${esc(roleLabel(state.profile.role))} · ${esc(today)}</p></div></header>

    <section class="future-status-row" aria-label="Resumo da operação">
      <button class="future-status-card status-blue" data-go="equipment" type="button"><span class="future-status-icon">${icon("equipment")}</span><div><strong>${Number(available).toLocaleString("pt-BR")}</strong><span>Disponíveis</span></div><small>${availablePct}% do inventário</small></button>
      <button class="future-status-card status-navy" data-go="withdrawals" type="button"><span class="future-status-icon">${icon("withdrawals")}</span><div><strong>${Number(inUse).toLocaleString("pt-BR")}</strong><span>Em uso</span></div><small>${pendingReturns} devolução(ões) pendente(s)</small></button>
      <button class="future-status-card status-sky" data-go="reservations" type="button"><span class="future-status-icon">${icon("reservations")}</span><div><strong>${Number(reservations).toLocaleString("pt-BR")}</strong><span>Reservas</span></div><small>Agendamentos confirmados</small></button>
      <button class="future-status-card status-alert" data-go="${admin?"maintenance":"equipment"}" type="button"><span class="future-status-icon">${icon("maintenance")}</span><div><strong>${Number(maintenance).toLocaleString("pt-BR")}</strong><span>Manutenção</span></div><small>${maintenancePct}% exige atenção</small></button>
    </section>

    <div class="future-main-grid">
      <section class="future-module operation-module">
        <div class="future-module-head"><div><span class="section-overline">OPERAÇÃO</span><h2>Movimentações recentes</h2></div><button class="future-link" data-open="withdrawals">Ver todas</button></div>
        <div class="future-list">${renderWithdrawalRows((current||[]).slice(0,5))}</div>
      </section>
      <section class="future-module inventory-module">
        <div class="future-module-head"><div><span class="section-overline">INVENTÁRIO</span><h2>Situação dos equipamentos</h2></div><button class="future-link" data-open="equipment">Abrir inventário</button></div>
        <div class="future-inventory-number"><strong>${Number(total).toLocaleString("pt-BR")}</strong><span>equipamentos ativos</span></div>
        <div class="future-progress"><i class="p-available" style="width:${availablePct}%"></i><i class="p-use" style="width:${inUsePct}%"></i><i class="p-maint" style="width:${maintenancePct}%"></i></div>
        <div class="future-legend"><span><i class="legend-available"></i>Disponíveis ${available}</span><span><i class="legend-use"></i>Em uso ${inUse}</span><span><i class="legend-maint"></i>Manutenção ${maintenance}</span></div>
      </section>
    </div>

  </section>

  <section class="mobile-dashboard-organic" aria-label="Visão geral mobile">
    <header class="mobile-home-hero">
      <div class="mobile-home-eyebrow"><span>Hoje</span><small>${esc(today)}</small></div>
      <div class="mobile-home-greeting"><h1>Olá, ${esc(firstName())}</h1><span>${esc(roleLabel(state.profile.role))}</span></div>
      <div class="mobile-home-health">
        <div class="mobile-health-copy"><strong>${Number(available).toLocaleString("pt-BR")}</strong><span>disponíveis de ${Number(total).toLocaleString("pt-BR")}</span><small>${availablePct}% do inventário pronto para uso</small></div>
        <div class="mobile-health-ring" style="--health:${availablePct * 3.6}deg"><div><strong>${availablePct}%</strong><span>livre</span></div></div>
      </div>
      <div class="mobile-home-progress" aria-hidden="true"><i style="width:${availablePct}%"></i><i class="use" style="width:${inUsePct}%"></i><i class="maint" style="width:${maintenancePct}%"></i></div>
    </header>

    <section class="mobile-flow-section mobile-now">
      <div class="mobile-section-title"><div><span>AGORA</span><h2>O que está acontecendo</h2></div></div>
      <div class="mobile-stat-flow">
        <button class="mobile-stat-pill" data-go="withdrawals" type="button"><span class="mobile-stat-icon">${icon("withdrawals")}</span><div><strong>${Number(inUse).toLocaleString("pt-BR")}</strong><span>Em uso</span><small>${pendingReturns} para devolver</small></div></button>
        <button class="mobile-stat-pill" data-go="reservations" type="button"><span class="mobile-stat-icon">${icon("reservations")}</span><div><strong>${Number(reservations).toLocaleString("pt-BR")}</strong><span>Reservas</span><small>Confirmadas</small></div></button>
        <button class="mobile-stat-pill ${maintenance ? 'attention' : ''}" data-go="${admin?"maintenance":"equipment"}" type="button"><span class="mobile-stat-icon">${icon("maintenance")}</span><div><strong>${Number(maintenance).toLocaleString("pt-BR")}</strong><span>Manutenção</span><small>${maintenance ? 'Exigem atenção' : 'Tudo certo'}</small></div></button>
      </div>
    </section>

    <section class="mobile-flow-section mobile-activity-feed">
      <div class="mobile-section-title"><div><span>ATIVIDADE</span><h2>Movimentações recentes</h2></div><button type="button" data-open="withdrawals">Ver todas</button></div>
      <div class="mobile-activity-list">
        ${recentMobile.length ? recentMobile.map((r,i)=>`<button type="button" class="mobile-activity-item" data-go="withdrawals"><span class="mobile-activity-dot ${i===0?'live':''}"></span><div><strong>${esc(r.class_name||"Sem turma")}</strong><span>${esc(r.destination||"Sem destino")}${r.student_name?` · ${esc(r.student_name)}`:""}</span><small>${Number(r.pending_count||0)} pendente(s) · ${esc(dt(r.withdrawn_at))}</small></div></button>`).join("") : `<div class="mobile-empty-state"><span>${icon("history")}</span><strong>Nenhuma movimentação agora</strong><small>As próximas retiradas vão aparecer aqui.</small></div>`}
      </div>
    </section>
  </section>`);

  qsa("[data-go],[data-open]").forEach(b => b.addEventListener("click", () => navigate(b.dataset.go || b.dataset.open)));
}
function closeContextMenu(){qs("#equipa-context-menu")?.remove()}
function openContextMenu(x,y,items=[]){
  closeContextMenu();if(!items.length)return;
  const menu=document.createElement("div");menu.id="equipa-context-menu";menu.className="context-menu";
  menu.innerHTML=items.map((item,i)=>item.separator?`<div class="context-separator"></div>`:`<button type="button" data-context-index="${i}" class="${item.danger?'danger':''}"><span class="context-icon">${contextActionIcon(item.icon||'view')}</span><div><strong>${esc(item.label)}</strong><small>${esc(item.hint||'')}</small></div></button>`).join("");
  document.body.append(menu);const rect=menu.getBoundingClientRect();menu.style.left=`${Math.max(8,Math.min(x,innerWidth-rect.width-10))}px`;menu.style.top=`${Math.max(8,Math.min(y,innerHeight-rect.height-10))}px`;
  qsa("[data-context-index]",menu).forEach(b=>b.addEventListener("click",e=>{e.stopPropagation();const item=items[Number(b.dataset.contextIndex)];closeContextMenu();item?.action?.()}));
  const outside=e=>{if(menu.contains(e.target))return;document.removeEventListener("pointerdown",outside,true);closeContextMenu()};
  setTimeout(()=>document.addEventListener("pointerdown",outside,true),0);
}
async function deleteEquipment(id){
  if(state.profile?.role!=="admin")return notify("Apenas a administração pode desativar equipamentos.","error");
  let item;
  try { item=await getEquipment(id); }
  catch(error){return notify(errText(error),"error");}
  const ok=await confirmAction({
    title:"Desativar equipamento?",
    message:`${item.label||item.code} deixará de aparecer como disponível. O histórico de retiradas, devoluções e reservas será preservado. Equipamentos em uso ou com reservas futuras precisam ser regularizados antes.`,
    confirmText:"Desativar",danger:true
  });
  if(!ok)return;
  let error;
  try { ({error}=await supabase.rpc("deactivate_equipment",{p_equipment_id:id})); }
  catch(failure){error=failure;}
  if(error)return notify(errText(error),"error");
  notify("Equipamento desativado sem apagar o histórico.","success");
  return renderEquipment();
}
function contextActionIcon(name){
  const paths={
    view:'<circle cx="11" cy="11" r="3"/><path d="M2 11s3.6-7 9-7 9 7 9 7-3.6 7-9 7-9-7-9-7Z"/>',
    edit:'<path d="m15 5 4 4M4 20l4.5-1 11-11a2.1 2.1 0 0 0-3-3l-11 11L4 20Z"/>',
    delete:'<path d="M4 7h16M9 7V4h6v3m-9 0 1 13h10l1-13M10 11v5m4-5v5"/>',
    reserve:'<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4m10-4v4M3 10h18m-13 5h8"/>',
    lock:'<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
    unlock:'<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 7.5-2"/>'
  };
  return `<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.7">${paths[name]||paths.view}</svg>`;
}
function bindEquipmentContextMenus(){ /* contexto tratado por delegação global */ }
function equipmentRows(rows) {
  if (!rows.length) return `<div class="empty"><strong>Nenhum equipamento.</strong><span>Os registros aparecerão aqui.</span></div>`;
  return `<div class="data-list">${rows.map(e => `<button class="data-row equipment-row" data-equipment="${esc(e.id)}" type="button"><div class="data-main"><strong>${esc(e.label || e.code)}</strong><span>${esc(schoolGroupLabel(e.school_group))} · ${esc(e.brand)} ${esc(e.model)} · ${esc(e.asset_tag || e.code)}${e.location_text?` · ${esc(e.location_text)}`:""}</span></div><span class="status status-${esc(e.status)}">${esc(statusLabel(e.status))}</span><span class="data-date">${esc(dt(e.updated_at))}</span></button>`).join("")}</div>`;
}
function bindEquipmentRowClicks(root = document) { qsa("[data-equipment]", root).forEach(r => r.addEventListener("click", () => openEquipment(r.dataset.equipment))); bindEquipmentContextMenus(root); }
function installGlobalContextMenus(){
  if(document.documentElement.dataset.contextReady)return;
  document.documentElement.dataset.contextReady="1";
  document.addEventListener("contextmenu",e=>{
    if(!state.profile)return;
    const admin=state.profile.role==="admin";
    const equipment=e.target.closest?.("[data-equipment]");
    if(equipment){
      e.preventDefault();e.stopPropagation();const id=equipment.dataset.equipment;
      const items=[{icon:"view",label:"Ver equipamento",hint:"Dados e disponibilidade",action:()=>openEquipment(id)}];
      if(admin){
        items.push({icon:"edit",label:"Editar",hint:"Atualizar o cadastro",action:async()=>{try{openEquipmentForm(await getEquipment(id))}catch(error){notify(errText(error),"error")}}});
        items.push({icon:"delete",label:"Desativar",hint:"Preservar histórico escolar",danger:true,action:()=>deleteEquipment(id)});
      }else{
        items.push({icon:"reserve",label:"Reservar",hint:"Escolher dia e horário",action:async()=>{try{const item=await getEquipment(id);if(item.status!=="available"||!item.is_active)return notify("Equipamento indisponível.","warning");openReservationModal(item)}catch(error){notify(errText(error),"error")}}});
      }
      openContextMenu(e.clientX,e.clientY,items);return;
    }
    const cart=e.target.closest?.("[data-cart-record]");
    if(cart){
      e.preventDefault();e.stopPropagation();let record={};try{record=JSON.parse(cart.dataset.cartRecord||"{}")}catch{}
      const items=[{icon:"view",label:"Abrir carrinho",hint:"Ver e selecionar equipamentos",action:()=>openCart(record.qr_token)}];
      if(admin){
        items.push({icon:"edit",label:"Editar",hint:"Alterar dados e itens",action:()=>openCartForm(record)});
        items.push({icon:"delete",label:"Desativar",hint:"Retirar da operação",danger:true,action:()=>deactivateCart(record)});
      }
      openContextMenu(e.clientX,e.clientY,items);return;
    }
    const user=e.target.closest?.("[data-user]");
    if(user&&admin){
      e.preventDefault();e.stopPropagation();let record={};try{record=JSON.parse(user.dataset.user||"{}")}catch{}
      openContextMenu(e.clientX,e.clientY,[
        {icon:"edit",label:"Editar usuário",hint:"Nome e cargo",action:()=>openUserForm(record)},
        {icon:record.is_active?"delete":"unlock",label:record.is_active?"Remover acesso":"Restaurar acesso",hint:"Gerenciar permissão",danger:record.is_active,action:()=>adminUserAction(record,record.is_active?"remove":"restore")},
        {icon:record.is_banned?"unlock":"lock",label:record.is_banned?"Desbanir":"Banir",hint:"Gerenciar bloqueio",danger:!record.is_banned,action:()=>record.is_banned?adminUserAction(record,"unban"):openBanUser(record)}
      ]);
    }
  },true);
}
function cleanSearch(value) { return String(value || "").replace(/[,%()]/g, " ").trim().slice(0,80); }
function normalizeSearchText(value = "") {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
function searchTokens(value = "") { return normalizeSearchText(value).split(/\s+/).filter(Boolean).slice(0, 8); }
function smartScore(fields, query) {
  const normalizedFields = fields.map(normalizeSearchText).filter(Boolean);
  const joined = normalizedFields.join(" ");
  const normalizedQuery = normalizeSearchText(query);
  const tokens = searchTokens(query);
  if (!tokens.length) return 1;
  let score = 0;
  for (const token of tokens) {
    let tokenScore = 0;
    for (const field of normalizedFields) {
      if (!field) continue;
      if (field === token) tokenScore = Math.max(tokenScore, 120);
      else if (field.startsWith(token)) tokenScore = Math.max(tokenScore, 90);
      else if (field.includes(` ${token}`)) tokenScore = Math.max(tokenScore, 62);
      else if (field.includes(token)) tokenScore = Math.max(tokenScore, 42);
    }
    if (!tokenScore && joined.includes(token)) tokenScore = 26;
    if (!tokenScore) return 0;
    score += tokenScore;
  }
  if (normalizedQuery && joined === normalizedQuery) score += 110;
  else if (normalizedQuery && joined.startsWith(normalizedQuery)) score += 45;
  return score;
}
function smartFilter(rows, query, fieldsGetter) {
  const q = cleanSearch(query || "");
  if (!q) return rows;
  return rows.map(row => ({ row, score: smartScore(fieldsGetter(row), q) })).filter(x => x.score > 0).sort((a, b) => b.score - a.score).map(x => x.row);
}
function activeFilterCount(values = []) { return values.filter(v => v !== null && v !== undefined && String(v).trim() !== "").length; }
function filterBadge(count) { return count ? `<span class="filter-count">${count}</span>` : ""; }
function wireFilterToggle(toggleId, panelId) {
  const btn = qs(`#${toggleId}`); const panel = qs(`#${panelId}`);
  if (!btn || !panel) return;
  if (!qs(".filter-sheet-head",panel)) panel.insertAdjacentHTML("afterbegin",`<div class="filter-sheet-head"><div><span>Filtros</span><strong>Refine os resultados</strong></div><button type="button" class="filter-sheet-close" aria-label="Fechar">Fechar</button></div>`);
  const marker=document.createComment(`equipa-filter-${panelId}`);
  const restorePanel=()=>{ if(marker.parentNode){ marker.parentNode.insertBefore(panel,marker); marker.remove(); } };
  const removeShade=()=>{const shade=qs("#filter-mobile-shade");shade?.remove();document.body.classList.remove("filter-sheet-open")};
  const setOpen=open=>{
    const mobile=matchMedia("(max-width:820px)").matches;
    if(open&&mobile){
      if(!marker.parentNode) panel.parentNode?.insertBefore(marker,panel);
      document.body.append(panel);
      qs("#filter-mobile-shade")?.remove();
      const shade=document.createElement("button");shade.type="button";shade.id="filter-mobile-shade";shade.className="filter-mobile-shade";shade.setAttribute("aria-label","Fechar filtros");document.body.append(shade);shade.addEventListener("click",()=>setOpen(false));document.body.classList.add("filter-sheet-open");
      panel.classList.add("open");btn.classList.add("active");btn.setAttribute("aria-expanded","true");requestAnimationFrame(()=>shade.classList.add("open"));return;
    }
    panel.classList.toggle("open",open);btn.classList.toggle("active",open);btn.setAttribute("aria-expanded",open?"true":"false");
    if(!open){removeShade();restorePanel()}
  };
  btn.addEventListener("click",()=>setOpen(!panel.classList.contains("open")));
  qs(".filter-sheet-close",panel)?.addEventListener("click",()=>setOpen(false));
  panel.querySelectorAll("[id$='filter-apply'],[id$='filter-clear'],#history-filter,#history-filter-clear,#audit-apply,#audit-clear").forEach(x=>x.addEventListener("click",()=>setOpen(false)));
}
function currentGlobalSearchValue() { return ({ equipment: state.equipmentSearch, withdrawals: state.withdrawalsSearch, reservations: state.reservationsSearch, maintenance: state.maintenanceSearch, carts: state.cartSearch })[state.view] || ""; }
function routeFromSearch(query) {
  const q = normalizeSearchText(query);
  if (!q) return "equipment";
  if (/carrinho|lote|qr/.test(q)) return "carts";
  if (/manut|oficina|conserto/.test(q)) return "maintenance";
  if (/reserva|agenda/.test(q)) return "reservations";
  if ((/usuario|usuário|cargo|banco|capacidade/.test(q)) && state.profile?.role === "admin") return "admin";
  if (/retirada|devolu|turma|aluno|destino|responsavel/.test(q)) return "withdrawals";
  return "equipment";
}
function runSmartGlobalSearch(query) {
  const term = cleanSearch(query || "");
  const view = routeFromSearch(term);
  if (view === "equipment") { state.equipmentSearch = term; state.equipmentPage = 0; }
  else if (view === "withdrawals") state.withdrawalsSearch = term;
  else if (view === "reservations") state.reservationsSearch = term;
  else if (view === "maintenance") state.maintenanceSearch = term;
  else if (view === "carts") state.cartSearch = term;
  navigate(view);
}
async function renderEquipment() {
  state.view = "equipment";
  const admin = state.profile.role === "admin";
  const from = state.equipmentPage * config.pageSize;
  const to = from + config.pageSize - 1;
  const filterCount = activeFilterCount([state.equipmentFilters.status, state.equipmentFilters.active, state.equipmentFilters.group]);
  shell(`<section class="panel workspace-panel"><div class="panel-head workspace-head"><div><span class="eyebrow">Inventário</span><h2>Equipamentos</h2><p>Consulte, filtre e gerencie os dispositivos cadastrados.</p></div><div class="toolbar-actions">${admin ? `<button class="button ghost" id="import-equipment">Importar</button><button class="button primary" id="new-equipment">Novo equipamento</button>` : ""}</div></div><div class="toolbar workspace-toolbar"><div class="toolbar-cluster"><input class="search" id="equipment-search" type="search" value="${esc(state.equipmentSearch)}" placeholder="Buscar número, patrimônio, nome, marca ou modelo"><button class="filter-button ${filterCount ? 'has-active active' : ''}" id="equipment-filter-toggle" type="button" aria-expanded="${filterCount ? 'true' : 'false'}">${icon("filter")}<span>Filtros</span>${filterBadge(filterCount)}</button></div></div><div class="filter-drawer" id="equipment-filter-panel"><div class="filter-grid"><label>Estado<select id="equipment-status"><option value="">Todos os estados</option><option value="available" ${state.equipmentFilters.status==='available'?'selected':''}>Disponível</option><option value="in_use" ${state.equipmentFilters.status==='in_use'?'selected':''}>Em uso</option><option value="maintenance" ${state.equipmentFilters.status==='maintenance'?'selected':''}>Manutenção</option><option value="unavailable" ${state.equipmentFilters.status==='unavailable'?'selected':''}>Indisponível</option></select></label><label>Catálogo<select id="equipment-active"><option value="">Todos</option><option value="active" ${state.equipmentFilters.active==='active'?'selected':''}>Apenas ativos</option><option value="inactive" ${state.equipmentFilters.active==='inactive'?'selected':''}>Inativos</option></select></label><label>Grupo<select id="equipment-group"><option value="">Todos os grupos</option>${schoolGroupOptions(state.equipmentFilters.group)}</select></label></div><div class="filter-actions"><button class="button small ghost" id="equipment-filter-clear" type="button">Limpar filtros</button><button class="button primary small" id="equipment-filter-apply" type="button">Aplicar</button></div></div><div id="equipment-results"><div class="loading">Carregando equipamentos…</div></div></section>`);
  const host = qs("#equipment-results");
  const search = cleanSearch(state.equipmentSearch);
  const usingSmart = Boolean(search || filterCount);
  let rows = [];
  let count = 0;
  let error = null;
  if (usingSmart) {
    const result = await supabase.from("equipments").select("id,code,asset_tag,brand,model,label,school_group,serial_number,location_text,notes,status,is_active,created_at,updated_at,qr_token").order("code").limit(2000);
    error = result.error;
    rows = result.data || [];
    if (!error) {
      if (state.equipmentFilters.status) rows = rows.filter(r => r.status === state.equipmentFilters.status);
      if (state.equipmentFilters.active === "active") rows = rows.filter(r => r.is_active);
      if (state.equipmentFilters.active === "inactive") rows = rows.filter(r => !r.is_active);
      if (state.equipmentFilters.group) rows = rows.filter(r => r.school_group === state.equipmentFilters.group);
      rows = smartFilter(rows, search, r => [r.code, r.asset_tag, r.label, r.brand, r.model, r.serial_number, r.location_text, schoolGroupLabel(r.school_group), statusLabel(r.status), r.is_active ? 'ativo' : 'inativo']);
      count = rows.length;
      rows = rows.slice(from, to + 1);
    }
  } else {
    const result = await supabase.from("equipments").select("id,code,asset_tag,brand,model,label,school_group,serial_number,location_text,notes,status,is_active,created_at,updated_at,qr_token", { count: "exact" }).order("code").range(from, to);
    rows = result.data || [];
    count = result.count || 0;
    error = result.error;
  }
  if (error) host.innerHTML = `<div class="empty"><strong>Não foi possível carregar.</strong><span>${esc(errText(error))}</span></div>`;
  else host.innerHTML = `${equipmentRows(rows || [])}<div class="pagination"><span>${count || 0} registro(s)</span><div><button class="button small" id="prev" ${state.equipmentPage===0?"disabled":""}>Anterior</button><button class="button small" id="next" ${to+1>=(count||0)?"disabled":""}>Próxima</button></div></div>`;
  bindEquipmentRowClicks(host);
  qs("#prev")?.addEventListener("click",()=>{state.equipmentPage--;renderEquipment()});
  qs("#next")?.addEventListener("click",()=>{state.equipmentPage++;renderEquipment()});
  let timer;
  qs("#equipment-search")?.addEventListener("input", e => { clearTimeout(timer); timer=setTimeout(()=>{state.equipmentSearch=e.target.value;state.equipmentPage=0;renderEquipment()},180); });
  wireFilterToggle("equipment-filter-toggle", "equipment-filter-panel");
  qs("#equipment-filter-apply")?.addEventListener("click", () => { state.equipmentFilters.status = qs("#equipment-status")?.value || ""; state.equipmentFilters.active = qs("#equipment-active")?.value || ""; state.equipmentFilters.group = qs("#equipment-group")?.value || ""; state.equipmentPage = 0; renderEquipment(); });
  qs("#equipment-filter-clear")?.addEventListener("click", () => { state.equipmentFilters = { status: "", active: "", group: "" }; state.equipmentPage = 0; renderEquipment(); });
  qs("#new-equipment")?.addEventListener("click",()=>openEquipmentForm());
  qs("#import-equipment")?.addEventListener("click",openImportModal);
}
async function getEquipment(id) { const { data, error } = await supabase.from("equipments").select("*").eq("id",id).single(); if(error) throw error; return data; }
async function openEquipment(id) {
  let e; try { e = await getEquipment(id); } catch(error) { return notify(errText(error),"error"); }
  const admin = state.profile.role === "admin";
  const modal = makeModal(`<div class="panel-head"><div><span class="eyebrow">${esc(e.code)}</span><h2>${esc(e.label || `${e.brand} ${e.model}`)}</h2></div><button class="icon-button" data-close>×</button></div><div class="modal-body"><div class="detail-grid">${detail("Estado",statusLabel(e.status))}${detail("Grupo",schoolGroupLabel(e.school_group))}${detail("Patrimônio",e.asset_tag)}${detail("Número de série",e.serial_number)}${detail("Marca",e.brand)}${detail("Modelo",e.model)}${detail("Local",e.location_text)}${detail("Atualizado",dt(e.updated_at))}</div>${e.notes?`<div class="equipment-notes"><span>Observações</span><p>${esc(e.notes)}</p></div>`:""}<div class="modal-actions"><button class="button ghost" data-qr>QR Code</button>${e.status==="available"?`<button class="button ghost" data-reserve>Reservar</button><button class="button primary" data-checkout>Retirar</button>`:""}${e.status==="in_use"?`<button class="button primary" data-return>Registrar devolução</button>`:""}${admin && !["in_use","maintenance"].includes(e.status)?`<button class="button ghost" data-maintenance>Manutenção</button>`:""}${admin?`<button class="button ghost" data-edit>Editar</button>`:""}</div></div>`, true);
  qs("[data-qr]",modal)?.addEventListener("click",()=>openQrModal(e.qr_token,e.label||e.code,`${schoolGroupLabel(e.school_group)} · ${e.brand} ${e.model}`));
  qs("[data-checkout]",modal)?.addEventListener("click",()=>{modal.remove();openCheckoutModal([e])});
  qs("[data-reserve]",modal)?.addEventListener("click",()=>{modal.remove();openReservationModal(e)});
  qs("[data-return]",modal)?.addEventListener("click",async()=>{const b=qs("[data-return]",modal);setBusy(b,true,"Registrando…");const {error}=await supabase.rpc("return_equipment",{p_equipment_id:e.id,p_client_action_id:uid()});setBusy(b,false);if(error)return notify(errText(error),"error");notify("Devolução registrada com data e horário.","success");modal.remove();navigate("withdrawals")});
  qs("[data-maintenance]",modal)?.addEventListener("click",()=>{modal.remove();openMaintenanceModal(e)});
  qs("[data-edit]",modal)?.addEventListener("click",()=>{modal.remove();openEquipmentForm(e)});
}
function openEquipmentForm(item=null) {
  const m = makeModal(`<div class="panel-head"><div><span class="eyebrow">Administração</span><h2>${item?"Editar":"Novo"} equipamento</h2></div><button class="icon-button" data-close>×</button></div><div class="modal-body"><form id="equipment-form" class="form-grid"><label>Número / código<input name="code" required maxlength="80" value="${esc(item?.code||"")}"></label><label>Patrimônio<input name="asset_tag" maxlength="80" value="${esc(item?.asset_tag||"")}"></label><label>Grupo<select name="school_group"><option value="">Não definido</option>${schoolGroupOptions(item?.school_group||"")}</select></label><label>Número de série<input name="serial_number" maxlength="120" value="${esc(item?.serial_number||"")}"></label><label>Nome opcional<input name="label" maxlength="120" value="${esc(item?.label||"")}"></label><label>Localização<input name="location_text" maxlength="160" value="${esc(item?.location_text||"")}" placeholder="Ex.: Sala 12 / Carrinho 3"></label><label>Modelo<input name="model" required maxlength="120" value="${esc(item?.model||"")}"></label><label>Marca<input name="brand" maxlength="100" value="${esc(item?.brand||"")}" placeholder="Não informado"></label><label>Estado<select name="status">${["available","in_use","maintenance","unavailable"].map(s=>`<option value="${s}" ${item?.status===s?"selected":""}>${statusLabel(s)}</option>`).join("")}</select></label><label class="span-2">Observações<textarea name="notes" maxlength="1200" placeholder="Condição, acessórios ou informação útil">${esc(item?.notes||"")}</textarea></label><label class="check span-2"><input name="is_active" type="checkbox" ${item?.is_active!==false?"checked":""}><span>Equipamento ativo no catálogo</span></label><div class="modal-actions span-2"><button class="button" data-close type="button">Cancelar</button><button class="button primary" type="submit">Salvar</button></div></form></div>`, true);
  qs("#equipment-form",m).addEventListener("submit",async ev=>{ev.preventDefault();const b=qs('button[type="submit"]',ev.currentTarget);setBusy(b,true,"Salvando…");const f=new FormData(ev.currentTarget);const payload={code:f.get("code").trim(),asset_tag:f.get("asset_tag").trim()||null,school_group:f.get("school_group")||null,serial_number:f.get("serial_number").trim()||null,label:f.get("label").trim()||null,location_text:f.get("location_text").trim()||null,model:f.get("model").trim(),brand:f.get("brand").trim()||"Não informado",notes:f.get("notes").trim()||null,status:f.get("status"),is_active:f.get("is_active")==="on"};if(!item)payload.created_by=state.profile.id;const req=item?supabase.from("equipments").update(payload).eq("id",item.id):supabase.from("equipments").insert(payload);const {error}=await req;setBusy(b,false);if(error)return notify(errText(error),"error");notify(item?"Equipamento atualizado.":"Equipamento criado.","success");m.remove();renderEquipment()});
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
async function openQrModal(token,title,subtitle="") {
  try { await ensureQRCodeLib(); } catch (error) { return notify(error.message,"error"); }
  const m=makeModal(`<div class="printable"><div class="panel-head"><div><span class="eyebrow">QR permanente</span><h2>${esc(title)}</h2></div><button class="icon-button" data-close>×</button></div><div class="qr-card"><div id="qr-code"></div><strong>${esc(title)}</strong><small>${esc(subtitle)}</small><span>${esc(qrUrl(token))}</span><div class="modal-actions"><button class="button ghost" id="copy-qr">Copiar link</button><button class="button primary" id="print-qr">Imprimir</button></div></div></div>`);
  new window.QRCode(qs("#qr-code",m),{text:qrUrl(token),width:210,height:210,correctLevel:window.QRCode.CorrectLevel.M});
  qs("#copy-qr",m).addEventListener("click",async()=>{await navigator.clipboard.writeText(qrUrl(token));notify("Link copiado.","success")});qs("#print-qr",m).addEventListener("click",()=>window.print());
}

async function renderWithdrawals() {
  state.view="withdrawals";
  const filterCount = activeFilterCount([state.withdrawalsStatus]);
  shell(`<section class="panel workspace-panel"><div class="panel-head workspace-head"><div><span class="eyebrow">Operação</span><h2>Retiradas</h2><p>Acompanhe equipamentos em uso e devoluções da escola.</p></div></div><div class="toolbar workspace-toolbar"><div class="toolbar-cluster"><input id="withdrawal-search" class="search" type="search" value="${esc(state.withdrawalsSearch)}" placeholder="Buscar turma, destino, responsável ou equipamento"><button class="filter-button ${filterCount ? 'has-active active' : ''}" id="withdrawal-filter-toggle" type="button" aria-expanded="${filterCount ? 'true' : 'false'}">${icon("filter")}<span>Filtros</span>${filterBadge(filterCount)}</button></div></div><div class="filter-drawer" id="withdrawal-filter-panel"><div class="filter-grid"><label>Status<select id="withdrawal-status"><option value="">Todos</option><option value="open" ${state.withdrawalsStatus==='open'?'selected':''}>Em aberto</option><option value="returned" ${state.withdrawalsStatus==='returned'?'selected':''}>Devolvida</option><option value="cancelled" ${state.withdrawalsStatus==='cancelled'?'selected':''}>Cancelada</option></select></label></div><div class="filter-actions"><button class="button small ghost" id="withdrawal-filter-clear" type="button">Limpar filtros</button><button class="button primary small" id="withdrawal-filter-apply" type="button">Aplicar</button></div></div><div id="withdrawals"><div class="loading">Carregando retiradas…</div></div></section>`);
  await loadWithdrawals();
  let timer;
  qs("#withdrawal-search")?.addEventListener("input",e=>{clearTimeout(timer);timer=setTimeout(()=>{state.withdrawalsSearch=e.target.value;loadWithdrawals()},180)});
  wireFilterToggle("withdrawal-filter-toggle", "withdrawal-filter-panel");
  qs("#withdrawal-filter-apply")?.addEventListener("click", () => { state.withdrawalsStatus = qs("#withdrawal-status")?.value || ""; loadWithdrawals(); });
  qs("#withdrawal-filter-clear")?.addEventListener("click", () => { state.withdrawalsStatus = ""; loadWithdrawals(); });
}
async function loadWithdrawals() {
  const {data,error}=await supabase.rpc("home_withdrawals",{p_query:null});
  const h=qs("#withdrawals"); if(!h) return;
  if(error){ h.innerHTML=`<div class="empty"><strong>Erro ao carregar.</strong><span>${esc(errText(error))}</span></div>`; return; }
  let rows = data || [];
  rows = smartFilter(rows, state.withdrawalsSearch, r => [r.class_name, r.destination, r.responsible_name, r.student_name, r.status, statusLabel(r.status)]);
  if (state.withdrawalsStatus) rows = rows.filter(r => r.status === state.withdrawalsStatus);
  h.innerHTML = renderWithdrawalRows(rows);
  qsa("[data-withdrawal-id]",h).forEach(b=>b.addEventListener("click",()=>openWithdrawalDetail(b.dataset.withdrawalId)));
}
function renderWithdrawalRows(rows) { if(!rows.length)return `<div class="empty"><strong>Nenhuma retirada encontrada.</strong><span>As movimentações compatíveis com seu perfil aparecem aqui.</span></div>`;return `<div class="data-list">${rows.map(r=>`<button class="data-row" type="button" data-withdrawal-id="${esc(r.withdrawal_id)}"><div class="data-main"><strong>${esc(r.class_name||"Sem turma")} · ${esc(r.destination||"Sem destino")}</strong><span>${esc(r.responsible_name||"")}${r.student_name?` · Aluno: ${esc(r.student_name)}`:""} · ${Number(r.pending_count||0)} pendente(s) de ${Number(r.total_count||0)}</span></div><span class="status status-${esc(r.status)}">${esc(statusLabel(r.status))}</span><span class="data-date">${r.returned_at?`Devolvido ${esc(dt(r.returned_at))}`:esc(dt(r.withdrawn_at))}</span></button>`).join("")}</div>`; }
async function openWithdrawalDetail(withdrawalId){
  const [{data:w,error:we},{data:items,error:ie}] = await Promise.all([
    supabase.from("withdrawals").select("id,class_name,destination,responsible_name,student_name,status,withdrawn_at,returned_at").eq("id",withdrawalId).single(),
    supabase.from("withdrawal_items").select("id,equipment_id,created_at,returned_at,equipments(id,code,label,brand,model,school_group)").eq("withdrawal_id",withdrawalId).order("id")
  ]);
  if(we||ie)return notify(errText(we||ie),"error");
  const m=makeModal(`<div class="panel-head"><div><span class="eyebrow">Retirada ${esc(withdrawalId)}</span><h2>${esc(w.class_name||"Sem turma")} · ${esc(w.destination||"Sem destino")}</h2></div><button class="icon-button" data-close>×</button></div><div class="modal-body"><div class="withdrawal-meta">${detail("Responsável",w.responsible_name)}${detail("Aluno",w.student_name)}${detail("Retirada",dt(w.withdrawn_at))}${detail("Devolução final",dt(w.returned_at))}</div><div class="return-list">${(items||[]).map(i=>`<div class="return-item"><div><strong>${esc(i.equipments?.label||i.equipments?.code||"Equipamento")}</strong><span>${esc(schoolGroupLabel(i.equipments?.school_group))} · ${esc(i.equipments?.brand||"")} ${esc(i.equipments?.model||"")}</span></div>${i.returned_at?`<span class="return-date">Devolvido em ${esc(dt(i.returned_at))}</span>`:`<button class="button primary small" type="button" data-return-item="${esc(i.equipment_id)}">Registrar devolução</button>`}</div>`).join("")}</div></div>`,true);
  qsa("[data-return-item]",m).forEach(b=>b.addEventListener("click",async()=>{setBusy(b,true,"Registrando…");const {error}=await supabase.rpc("return_equipment",{p_equipment_id:b.dataset.returnItem,p_client_action_id:uid()});setBusy(b,false);if(error)return notify(errText(error),"error");notify("Devolução registrada com data e horário.","success");m.remove();await loadWithdrawals();openWithdrawalDetail(withdrawalId)}));
}

async function renderReservations() {
  state.view="reservations";
  const filterCount = activeFilterCount([state.reservationsStatus]);
  shell(`<section class="panel workspace-panel"><div class="panel-head workspace-head"><div><span class="eyebrow">Agenda</span><h2>Reservas futuras</h2><p>Organize a utilização dos equipamentos sem conflitos de horário.</p></div></div><div class="toolbar workspace-toolbar"><div class="toolbar-cluster"><input id="reservation-search" class="search" type="search" value="${esc(state.reservationsSearch)}" placeholder="Buscar equipamento, turma, destino ou período"><button class="filter-button ${filterCount ? 'has-active active' : ''}" id="reservation-filter-toggle" type="button" aria-expanded="${filterCount ? 'true' : 'false'}"><span>Filtros</span>${filterBadge(filterCount)}</button></div></div><div class="filter-drawer" id="reservation-filter-panel"><div class="filter-grid"><label>Status<select id="reservation-status"><option value="">Todos</option><option value="confirmed" ${state.reservationsStatus==='confirmed'?'selected':''}>Confirmada</option><option value="fulfilled" ${state.reservationsStatus==='fulfilled'?'selected':''}>Utilizada</option><option value="cancelled" ${state.reservationsStatus==='cancelled'?'selected':''}>Cancelada</option><option value="expired" ${state.reservationsStatus==='expired'?'selected':''}>Expirada</option></select></label></div><div class="filter-actions"><button class="button small ghost" id="reservation-filter-clear" type="button">Limpar filtros</button><button class="button primary small" id="reservation-filter-apply" type="button">Aplicar</button></div></div><div id="reservations"><div class="loading">Carregando reservas…</div></div></section>`);
  const h=qs("#reservations");
  let data, error;
  try {
    ({data,error}=await supabase.from("reservations").select("id,equipment_id,user_id,class_name,destination,start_at,end_at,notes,status,withdrawal_id,created_at,equipments(code,label,brand,model,status)").order("start_at",{ascending:true}).limit(400));
  } catch (failure) { error=failure; }
  if(!h)return;
  if(error){h.innerHTML=`<div class="empty"><strong>Não foi possível carregar as reservas.</strong><span>${esc(errText(error))}</span><button type="button" class="button" id="retry-reservations">Tentar novamente</button></div>`;qs("#retry-reservations")?.addEventListener("click",renderReservations);return}
  let rows = data || [];
  rows = rows.map(r => ({ ...r, computed_status: r.status === 'confirmed' && new Date(r.end_at) < new Date() ? 'expired' : r.status }));
  rows = smartFilter(rows, state.reservationsSearch, r => [r.equipments?.label, r.equipments?.code, r.class_name, r.destination, r.notes, statusLabel(r.computed_status), dt(r.start_at), dt(r.end_at)]);
  if (state.reservationsStatus) rows = rows.filter(r => r.computed_status === state.reservationsStatus);
  if(!rows.length){h.innerHTML=`<div class="empty"><strong>Nenhuma reserva.</strong><span>Abra um equipamento disponível e escolha Reservar.</span></div>`;} else {
    h.innerHTML=`<div class="data-list">${rows.map(r=>{const st=r.computed_status;const expired=st==='expired';return `<div class="data-row"><div class="data-main"><strong>${esc(r.equipments?.label||r.equipments?.code||"Equipamento")}</strong><span>${esc(r.class_name)} · ${esc(r.destination)} · ${esc(dt(r.start_at))} até ${esc(dt(r.end_at))}</span></div><span class="status status-${esc(st)}">${esc(statusLabel(st))}</span><div class="row-actions">${r.status==="confirmed"&&!expired?`<button class="button small" data-cancel-res="${r.id}">Cancelar</button>${r.user_id === state.profile.id ? `<button class="button primary small" data-use-res="${r.id}">Retirar</button>` : ""}`:""}</div></div>`}).join("")}</div>`;
  }
  let timer; qs("#reservation-search")?.addEventListener("input", e => { clearTimeout(timer); timer=setTimeout(()=>{state.reservationsSearch=e.target.value; renderReservations();}, 180); });
  wireFilterToggle("reservation-filter-toggle", "reservation-filter-panel");
  qs("#reservation-filter-apply")?.addEventListener("click", () => { state.reservationsStatus = qs("#reservation-status")?.value || ""; renderReservations(); });
  qs("#reservation-filter-clear")?.addEventListener("click", () => { state.reservationsStatus = ""; renderReservations(); });
  qsa("[data-cancel-res]").forEach(b=>b.addEventListener("click",async()=>{const ok=await confirmAction({title:"Cancelar reserva?",message:"O horário ficará disponível novamente para este equipamento.",confirmText:"Cancelar reserva",danger:true});if(!ok)return;setBusy(b,true,"…");const {error}=await supabase.rpc("cancel_reservation",{p_reservation_id:Number(b.dataset.cancelRes)});setBusy(b,false);if(error)return notify(errText(error),"error");notify("Reserva cancelada.","success");renderReservations()}));
  qsa("[data-use-res]").forEach(b=>b.addEventListener("click",async()=>{setBusy(b,true,"Retirando…");const {error}=await supabase.rpc("checkout_reservation",{p_reservation_id:Number(b.dataset.useRes),p_client_action_id:uid()});setBusy(b,false);if(error)return notify(errText(error),"error");notify("Reserva convertida em retirada.","success");navigate("withdrawals")}));
}


async function renderHistory() {
  state.view="history";
  shell(`<section class="panel workspace-panel"><div class="panel-head workspace-head"><div><span class="eyebrow">Movimentações</span><h2>Histórico</h2><p>Consulte retiradas e devoluções por equipamento, pessoa, turma, destino ou estado.</p></div></div><div class="toolbar workspace-toolbar"><div class="toolbar-cluster"><input id="history-smart" class="search" type="search" placeholder="Buscar equipamento, pessoa, turma ou destino"><button class="filter-button ${state.historyFiltersOpen ? 'active' : ''}" id="history-filter-toggle" type="button" aria-expanded="${state.historyFiltersOpen ? 'true' : 'false'}"><span>Filtros</span></button></div></div><div class="filter-drawer ${state.historyFiltersOpen ? 'open' : ''}" id="history-filter-panel"><div class="filter-grid"><label>Equipamento ou patrimônio<input id="h-equipment" placeholder="Ex.: CB-042"></label><label>Pessoa<input id="h-person" placeholder="Aluno ou responsável"></label><label>Aluno<input id="h-student" placeholder="Nome do aluno"></label><label>Turma<input id="h-class" placeholder="Ex.: 3º A"></label><label>Status<select id="h-status"><option value="">Todos os estados</option><option value="open">Em aberto</option><option value="returned">Devolvido</option><option value="cancelled">Cancelado</option></select></label></div><div class="filter-actions"><span class="muted">Ao informar uma pessoa, a consulta amplia o limite para localizar o histórico dela.</span><div><button class="button small ghost" id="history-filter-clear" type="button">Limpar</button><button class="button primary small" id="history-filter" type="button">Aplicar filtros</button></div></div></div><div id="history"><div class="loading">Carregando histórico…</div></div></section>`);
  wireFilterToggle("history-filter-toggle", "history-filter-panel");
  qs("#history-filter-toggle")?.addEventListener("click", ()=>{ state.historyFiltersOpen = qs("#history-filter-panel")?.classList.contains("open"); });
  qs("#history-filter")?.addEventListener("click", ()=>loadHistory());
  qs("#history-filter-clear")?.addEventListener("click", ()=>{ ["#h-equipment", "#h-person", "#h-student", "#h-class", "#h-status", "#history-smart"].forEach(sel => { const el = qs(sel); if (el) el.value = ""; }); loadHistory(); });
  let timer; qs("#history-smart")?.addEventListener("input", e=>{ clearTimeout(timer); timer=setTimeout(()=>loadHistory(e.target.value),180); });
  await loadHistory();
}
async function loadHistory(smartQuery=""){
  const person=qs("#h-person")?.value.trim()||"";
  const p={p_from:null,p_to:null,p_equipment:qs("#h-equipment")?.value.trim()||null,p_label:null,p_student:qs("#h-student")?.value.trim()||null,p_professor:null,p_class_name:qs("#h-class")?.value.trim()||null,p_destination:null,p_status:qs("#h-status")?.value||null,p_equipment_id:null,p_limit:person?5000:config.historyLimit};
  const {data,error}=await supabase.rpc("history_events",p);const h=qs("#history");if(!h)return;
  if(error){h.innerHTML=`<div class="empty"><strong>Erro ao carregar histórico.</strong><span>${esc(errText(error))}</span></div>`;return}
  let rows=data||[];
  if(person)rows=smartFilter(rows,person,x=>[x.student_name,x.responsible_name]);
  rows=smartFilter(rows, smartQuery || qs("#history-smart")?.value || "", x=>[x.label,x.code,x.brand,x.model,x.class_name,x.destination,x.student_name,x.responsible_name,x.status,statusLabel(x.status)]);
  if(!rows.length){h.innerHTML=`<div class="empty"><strong>Nenhum evento.</strong><span>Altere os filtros ou aguarde novas movimentações.</span></div>`;return}
  h.innerHTML=`<div class="data-list">${rows.map(x=>`<div class="data-row"><div class="data-main"><strong>${esc(x.label||x.code)} · ${esc(x.brand)} ${esc(x.model)}</strong><span>${esc(x.class_name||"Sem turma")} · ${esc(x.destination||"Sem destino")}${x.student_name?` · Aluno: ${esc(x.student_name)}`:""}${x.responsible_name?` · Responsável: ${esc(x.responsible_name)}`:""}</span></div><span class="status status-${esc(x.status)}">${esc(statusLabel(x.status))}</span><span class="data-date">${x.returned_at?`Devolvido ${esc(dt(x.returned_at))}`:esc(dt(x.withdrawn_at))}</span></div>`).join("")}</div>`;
}

async function renderCarts() {
  state.view="carts";
  const admin=state.profile.role==="admin";
  shell(`<section class="panel workspace-panel"><div class="panel-head workspace-head"><div><span class="eyebrow">Lotes</span><h2>Carrinhos de equipamentos</h2><p>Organize equipamentos por carrinho e faça retiradas seletivas pelo QR.</p></div>${admin?`<button class="button primary" id="new-cart">Novo carrinho</button>`:""}</div><div class="toolbar workspace-toolbar"><div class="toolbar-cluster"><input id="cart-search" class="search" type="search" value="${esc(state.cartSearch)}" placeholder="Buscar número, nome, local ou equipamento"></div></div><div id="carts"><div class="loading">Carregando carrinhos…</div></div></section>`);
  qs("#new-cart")?.addEventListener("click",()=>openCartForm());
  const {data,error}=await supabase.rpc("cart_scan_catalog_v2");
  const h=qs("#carts"); if(error){h.innerHTML=`<div class="empty"><strong>Erro ao carregar.</strong><span>${esc(errText(error))}</span></div>`;return}
  let rows=smartFilter(data||[],state.cartSearch,c=>[c.cart_name,`carrinho ${c.cart_number}`,c.location_text,c.notes,(c.equipment_codes||[]).join(" "),`${c.item_count} equipamentos`]);
  if(!rows.length){h.innerHTML=`<div class="empty"><strong>Nenhum carrinho encontrado.</strong><span>O administrador pode cadastrar os lotes usados pela escola.</span></div>`;return}
  const perPage=50,total=rows.length,maxPage=Math.max(0,Math.ceil(total/perPage)-1);state.cartPage=Math.min(state.cartPage,maxPage);const from=state.cartPage*perPage;const page=rows.slice(from,from+perPage);
  h.innerHTML=`<div class="data-list">${page.map(c=>{const record={id:c.cart_id,number:c.cart_number,name:c.cart_name||"",qr_token:c.qr_token,location_text:c.location_text||"",capacity:c.capacity||null,notes:c.notes||"",equipment_codes:c.equipment_codes||[],is_active:c.is_active};return `<button class="data-row cart-row" type="button" data-cart-token="${esc(c.qr_token)}" data-cart-record='${esc(JSON.stringify(record))}'><div class="data-main"><strong>${esc(c.cart_name||`Carrinho ${c.cart_number}`)}</strong><span>${Number(c.item_count||0)} equipamento(s)${c.capacity?` de ${Number(c.capacity)} vagas`:""}${c.location_text?` · ${esc(c.location_text)}`:""}</span></div><span class="status status-available">Ativo</span><span class="data-date">#${c.cart_number}</span></button>`}).join("")}</div><div class="pagination"><span>${total} carrinho(s)</span><div><button class="button small" id="cart-prev" ${state.cartPage===0?'disabled':''}>Anterior</button><button class="button small" id="cart-next" ${state.cartPage>=maxPage?'disabled':''}>Próxima</button></div></div>`;
  let timer;qs("#cart-search")?.addEventListener("input",e=>{clearTimeout(timer);timer=setTimeout(()=>{state.cartSearch=e.target.value;state.cartPage=0;renderCarts()},180)});
  qs("#cart-prev")?.addEventListener("click",()=>{state.cartPage--;renderCarts()});qs("#cart-next")?.addEventListener("click",()=>{state.cartPage++;renderCarts()});
  qsa("[data-cart-token]").forEach(b=>b.addEventListener("click",()=>openCart(b.dataset.cartToken)));
}
async function openCart(token) {
  const {data,error}=await supabase.rpc("cart_scan_equipment_list_v2",{p_qr_token:token});if(error)return notify(errText(error),"error");const items=data||[];if(!items.length)return notify("Carrinho vazio ou indisponível.","warning");
  const available=items.filter(x=>x.is_active&&x.status==="available");
  const title=items[0].cart_name||`Carrinho ${items[0].cart_number}`;
  const m=makeModal(`<div class="panel-head"><div><span class="eyebrow">Carrinho ${items[0].cart_number}</span><h2>${esc(title)}</h2><p>${esc(items[0].cart_location||"Local não informado")} · ${items.length}${items[0].cart_capacity?`/${items[0].cart_capacity}`:""} equipamento(s)</p></div><button class="icon-button" data-close>×</button></div><div class="modal-body"><div class="cart-select-toolbar"><label>Quantidade para selecionar<input id="cart-qty" type="number" min="0" max="${Math.min(60,available.length)}" value="${Math.min(available.length,60)}"></label><div><button class="button small" id="cart-none" type="button">Limpar</button><button class="button small" id="cart-all" type="button">Selecionar disponíveis</button></div></div><div class="cart-select-list">${items.map(i=>`<label class="cart-select-row ${i.status!=="available"||!i.is_active?'disabled':''}"><input type="checkbox" data-cart-select value="${esc(i.equipment_id)}" ${i.status==="available"&&i.is_active?'checked':'disabled'}><div><strong>${esc(i.label||i.code)}</strong><span>${esc(schoolGroupLabel(i.school_group))} · ${esc(i.brand)} ${esc(i.model)}${i.location_text?` · ${esc(i.location_text)}`:""}</span></div><span class="status status-${esc(i.status)}">${esc(statusLabel(i.status))}</span></label>`).join("")}</div>${items[0].cart_notes?`<p class="cart-note">${esc(items[0].cart_notes)}</p>`:""}<div class="modal-actions"><button class="button ghost" data-cart-qr type="button">QR do carrinho</button><button class="button ghost" data-cart-qrs type="button">Baixar QRs do carrinho</button>${available.length?`<button class="button primary" data-batch type="button">Retirar selecionados</button>`:""}</div></div>`,true);
  const checks=()=>qsa("[data-cart-select]",m).filter(x=>!x.disabled);
  const applyQty=n=>checks().forEach((c,i)=>c.checked=i<n);
  qs("#cart-qty",m)?.addEventListener("input",e=>applyQty(Math.max(0,Math.min(60,Number(e.target.value||0)))));
  qs("#cart-none",m)?.addEventListener("click",()=>{checks().forEach(c=>c.checked=false);qs("#cart-qty",m).value=0});
  qs("#cart-all",m)?.addEventListener("click",()=>{const n=Math.min(60,checks().length);applyQty(n);qs("#cart-qty",m).value=n;if(checks().length>60)notify("Uma retirada em lote aceita até 60 equipamentos por vez.","warning")});
  qs("[data-cart-qr]",m)?.addEventListener("click",()=>openQrModal(token,title,`${items.length} equipamentos`));
  qs("[data-cart-qrs]",m)?.addEventListener("click",()=>downloadCartQrZip(token,title,items));
  qs("[data-batch]",m)?.addEventListener("click",()=>{const selected=new Set(checks().filter(c=>c.checked).map(c=>c.value));const chosen=items.filter(i=>selected.has(i.equipment_id));if(!chosen.length)return notify("Selecione ao menos um equipamento.","warning");if(chosen.length>60)return notify("Selecione no máximo 60 equipamentos por retirada.","warning");m.remove();openCheckoutModal(chosen)});
}
async function openCartForm(item=null){
  let record=item;
  if(item?.qr_token && (!item.equipment_codes || !item.equipment_codes.length)){const {data}=await supabase.rpc("cart_scan_equipment_list_v2",{p_qr_token:item.qr_token});record={...item,equipment_codes:(data||[]).map(x=>x.code)}}
  const m=makeModal(`<div class="panel-head"><div><span class="eyebrow">Administração</span><h2>${record?"Editar":"Novo"} carrinho</h2></div><button class="icon-button" data-close>×</button></div><div class="modal-body"><form id="cart-form" class="form-grid"><label>Número<input name="number" type="number" min="1" required value="${esc(record?.number||"")}"></label><label>Nome<input name="name" maxlength="120" value="${esc(record?.name||"")}" placeholder="Ex.: Carrinho 1"></label><label>Localização<input name="location_text" maxlength="160" value="${esc(record?.location_text||"")}" placeholder="Ex.: Sala maker"></label><label>Capacidade<input name="capacity" type="number" min="1" max="200" value="${esc(record?.capacity||"")}" placeholder="Ex.: 36"></label><label class="span-2">Códigos dos equipamentos<textarea name="codes" required placeholder="CB-001
CB-002
CB-003">${esc((record?.equipment_codes||[]).join("\n"))}</textarea></label><label class="span-2">Observações<textarea name="notes" maxlength="1200" placeholder="Informações operacionais do carrinho">${esc(record?.notes||"")}</textarea></label><div class="modal-actions span-2"><button class="button" data-close type="button">Cancelar</button><button class="button primary" type="submit">Salvar carrinho</button></div></form></div>`,true);
  qs("#cart-form",m).addEventListener("submit",async e=>{e.preventDefault();const b=qs('button[type="submit"]',e.currentTarget);setBusy(b,true,"Salvando…");const f=new FormData(e.currentTarget);const codes=[...new Set(String(f.get("codes")||"").split(/[\n,;]+/).map(x=>x.trim()).filter(Boolean))];const {error}=await supabase.rpc("save_equipment_cart_v2",{p_cart_id:record?.id?Number(record.id):null,p_number:Number(f.get("number")),p_name:f.get("name").trim()||null,p_equipment_codes:codes,p_location_text:f.get("location_text").trim()||null,p_capacity:f.get("capacity")?Number(f.get("capacity")):null,p_notes:f.get("notes").trim()||null});setBusy(b,false);if(error)return notify(errText(error),"error");notify(record?"Carrinho atualizado.":"Carrinho criado.","success");m.remove();renderCarts()})
}
async function deactivateCart(record){const ok=await confirmAction({title:"Desativar carrinho?",message:`${record.name||`Carrinho ${record.number}`} deixará de aparecer para operação, mas o histórico será preservado.`,confirmText:"Desativar",danger:true});if(!ok)return;const {error}=await supabase.from("equipment_carts").update({is_active:false}).eq("id",Number(record.id));if(error)return notify(errText(error),"error");notify("Carrinho desativado.","success");renderCarts()}

async function renderMaintenance(){if(state.profile.role!=="admin")return navigate("dashboard");state.view="maintenance";const filterCount=activeFilterCount([state.maintenanceStatus]);shell(`<section class="panel workspace-panel"><div class="panel-head workspace-head"><div><span class="eyebrow">Oficina</span><h2>Histórico de manutenção</h2><p>Ocorrências técnicas e intervenções ficam organizadas em uma única linha do tempo.</p></div></div><div class="toolbar workspace-toolbar"><div class="toolbar-cluster"><input id="maintenance-search" class="search" type="search" value="${esc(state.maintenanceSearch)}" placeholder="Buscar equipamento, título ou observação"><button class="filter-button ${filterCount ? 'has-active active' : ''}" id="maintenance-filter-toggle" type="button" aria-expanded="${filterCount ? 'true' : 'false'}">${icon("filter")}<span>Filtros</span>${filterBadge(filterCount)}</button></div></div><div class="filter-drawer" id="maintenance-filter-panel"><div class="filter-grid"><label>Status<select id="maintenance-status"><option value="">Todos</option><option value="open" ${state.maintenanceStatus==='open'?'selected':''}>Aberta</option><option value="resolved" ${state.maintenanceStatus==='resolved'?'selected':''}>Resolvida</option></select></label></div><div class="filter-actions"><button class="button small ghost" id="maintenance-filter-clear" type="button">Limpar filtros</button><button class="button primary small" id="maintenance-filter-apply" type="button">Aplicar</button></div></div><div id="maintenance"><div class="loading">Carregando…</div></div></section>`);const {data,error}=await supabase.from("maintenance_events").select("id,equipment_id,title,notes,resolution,status,opened_at,closed_at,equipments(code,label,brand,model)").order("opened_at",{ascending:false}).limit(300);const h=qs("#maintenance");if(error){h.innerHTML=`<div class="empty"><strong>Erro.</strong><span>${esc(errText(error))}</span></div>`;return}let rows=data||[];rows=smartFilter(rows,state.maintenanceSearch,x=>[x.title,x.notes,x.resolution,x.equipments?.label,x.equipments?.code,x.equipments?.brand,x.equipments?.model,statusLabel(x.status)]);if(state.maintenanceStatus)rows=rows.filter(x=>x.status===state.maintenanceStatus);if(!rows.length){h.innerHTML=`<div class="empty"><strong>Nenhuma manutenção registrada.</strong><span>Abra um equipamento e escolha Manutenção.</span></div>`;}else{h.innerHTML=`<div class="data-list">${rows.map(x=>`<div class="data-row"><div class="data-main"><strong>${esc(x.equipments?.label||x.equipments?.code)} · ${esc(x.title)}</strong><span>${esc(x.equipments?.brand||"")} ${esc(x.equipments?.model||"")} · aberta ${esc(dt(x.opened_at))}</span></div><span class="status status-${esc(x.status)}">${esc(statusLabel(x.status))}</span><div class="row-actions">${x.status==="open"?`<button class="button primary small" data-resolve="${x.id}">Concluir</button>`:""}</div></div>`).join("")}</div>`;qsa("[data-resolve]").forEach(b=>b.addEventListener("click",()=>resolveMaintenance(Number(b.dataset.resolve))));}let timer;qs("#maintenance-search")?.addEventListener("input",e=>{clearTimeout(timer);timer=setTimeout(()=>{state.maintenanceSearch=e.target.value;renderMaintenance()},180)});wireFilterToggle("maintenance-filter-toggle", "maintenance-filter-panel");qs("#maintenance-filter-apply")?.addEventListener("click",()=>{state.maintenanceStatus=qs("#maintenance-status")?.value||"";renderMaintenance()});qs("#maintenance-filter-clear")?.addEventListener("click",()=>{state.maintenanceStatus="";renderMaintenance()});}
function resolveMaintenance(id){const m=makeModal(`<div class="panel-head"><div><span class="eyebrow">Manutenção</span><h2>Concluir manutenção</h2></div><button class="icon-button" data-close>×</button></div><div class="modal-body"><form id="resolve-form" class="auth-form"><label>Resolução<textarea name="resolution" maxlength="1200" placeholder="O que foi feito"></textarea></label><div class="modal-actions"><button class="button" data-close type="button">Cancelar</button><button class="button primary" type="submit">Concluir</button></div></form></div>`);qs("#resolve-form",m).addEventListener("submit",async e=>{e.preventDefault();const b=qs('button[type="submit"]',e.currentTarget);setBusy(b,true,"Concluindo…");const f=new FormData(e.currentTarget);const {error}=await supabase.rpc("resolve_maintenance",{p_event_id:id,p_resolution:f.get("resolution").trim()||null});setBusy(b,false);if(error)return notify(errText(error),"error");notify("Manutenção concluída.","success");m.remove();renderMaintenance()})}

async function renderAdmin(){if(state.profile.role!=="admin")return navigate("dashboard");state.view="admin";shell(`<section class="admin-workspace"><div class="admin-titlebar"><div><span class="eyebrow">Administração</span><h2>Central administrativa</h2><p>Aprovação de contas, cargos, capacidade e ferramentas do inventário.</p></div></div><div class="split admin-grid"><section class="panel admin-users"><div class="panel-head"><div><span class="eyebrow">Pessoas</span><h2>Usuários e acessos</h2></div></div><div id="users"><div class="loading">Carregando usuários…</div></div></section><div class="stack admin-side"><section class="panel"><div class="panel-head"><div><span class="eyebrow">Armazenamento</span><h2>Capacidade do banco</h2></div></div><div id="capacity"><div class="loading">Medindo…</div></div></section><section class="panel"><div class="panel-head"><div><span class="eyebrow">Ferramentas</span><h2>Inventário</h2></div></div><div class="panel-pad quick-grid"><div class="quick-card"><strong>Importar planilha</strong><span>Valida CSV/XLSX no navegador.</span><button class="button small" id="admin-import">Importar</button></div><div class="quick-card"><strong>Exportar inventário</strong><span>Gera uma planilha do cadastro atual.</span><button class="button small" id="admin-export">Exportar</button></div><div class="quick-card"><strong>QRs para impressão</strong><span>Folha dos equipamentos ativos.</span><button class="button small" id="admin-qrs">Imprimir</button></div><div class="quick-card"><strong>QRs em arquivos</strong><span>Baixa todos os QR Codes em um ZIP.</span><button class="button small" id="admin-download-qrs">Baixar todos</button></div><div class="quick-card"><strong>Auditoria</strong><span>Consulte alterações e operações registradas.</span><button class="button small" id="admin-audit">Abrir auditoria</button></div></div></section></div></div></section>`);qs("#admin-import")?.addEventListener("click",openImportModal);qs("#admin-export")?.addEventListener("click",exportEquipments);qs("#admin-qrs")?.addEventListener("click",printQrBatch);qs("#admin-download-qrs")?.addEventListener("click",downloadAllEquipmentQrs);qs("#admin-audit")?.addEventListener("click",()=>navigate("audit"));await Promise.all([loadAdminUsers(),loadCapacity()]);}
async function loadAdminUsers(){const {data,error}=await supabase.rpc("admin_user_list_safe");const h=qs("#users");if(!h)return;if(error){h.innerHTML=`<div class="empty"><strong>Erro ao carregar usuários.</strong><span>${esc(errText(error))}</span></div>`;return}const now=Date.now();h.innerHTML=`<div class="data-list">${(data||[]).map(u=>{const banned=Boolean(u.banned_until&&new Date(u.banned_until).getTime()>now);const rec={id:u.id,full_name:u.full_name,role:u.role,masked_email:u.masked_email,is_active:u.is_active,is_banned:banned,banned_until:u.banned_until};return `<button class="data-row user-row" type="button" data-user='${esc(JSON.stringify(rec))}'><div class="data-main"><strong>${esc(u.full_name||"Usuário")}</strong><span>${esc(u.masked_email||"—")} · ${esc(roleLabel(u.role))}</span></div><span class="status ${!u.is_active?'status-maintenance':banned?'status-cancelled':'status-available'}">${!u.is_active?'Pendente/removido':banned?'Banido':'Ativo'}</span><span class="data-date">${esc(dateOnly(u.created_at))}</span></button>`}).join("")}</div>`;qsa("[data-user]").forEach(b=>b.addEventListener("click",()=>openUserForm(JSON.parse(b.dataset.user))));}
function openUserForm(u){const m=makeModal(`<div class="panel-head"><div><span class="eyebrow">Usuário</span><h2>${esc(u.full_name)}</h2><p>${esc(u.masked_email||"")}</p></div><button class="icon-button" data-close>×</button></div><div class="modal-body"><form id="user-form" class="auth-form"><label>Nome<input name="full_name" required maxlength="120" value="${esc(u.full_name)}"></label><label>Cargo<select name="role">${["student","teacher","admin"].map(r=>`<option value="${r}" ${u.role===r?"selected":""}>${roleLabel(r)}</option>`).join("")}</select></label><div class="user-access-actions">${!u.is_active?`<button class="button primary" type="button" data-user-action="approve">Aprovar/restaurar acesso</button>`:`<button class="button danger" type="button" data-user-action="remove">Remover acesso</button>`}${u.is_banned?`<button class="button" type="button" data-user-action="unban">Remover banimento</button>`:`<button class="button danger" type="button" data-user-ban>Banir temporariamente</button>`}</div><div class="modal-actions"><button class="button" data-close type="button">Cancelar</button><button class="button primary" type="submit">Salvar nome e cargo</button></div></form></div>`);
  qs("#user-form",m).addEventListener("submit",async e=>{e.preventDefault();const b=qs('button[type="submit"]',e.currentTarget);setBusy(b,true,"Salvando…");const f=new FormData(e.currentTarget);const {error}=await supabase.rpc("admin_update_user",{p_user_id:u.id,p_full_name:f.get("full_name").trim(),p_role:f.get("role")});setBusy(b,false);if(error)return notify(errText(error),"error");notify("Usuário atualizado.","success");m.remove();loadAdminUsers()});
  qs('[data-user-action="approve"]',m)?.addEventListener("click",()=>{m.remove();adminUserAction(u,"approve")});qs('[data-user-action="remove"]',m)?.addEventListener("click",()=>{m.remove();adminUserAction(u,"remove")});qs('[data-user-action="unban"]',m)?.addEventListener("click",()=>{m.remove();adminUserAction(u,"unban")});qs('[data-user-ban]',m)?.addEventListener("click",()=>{m.remove();openBanUser(u)});
}
async function adminUserAction(u,action,hours=null){const labels={approve:"aprovar o acesso",restore:"restaurar o acesso",remove:"remover o acesso",ban:"banir a conta",unban:"remover o banimento"};if(["remove","ban"].includes(action)){const ok=await confirmAction({title:"Confirmar ação administrativa?",message:`Deseja ${labels[action]} de ${u.full_name}? O evento ficará registrado na auditoria.`,confirmText:"Confirmar",danger:true});if(!ok)return}const {data,error}=await supabase.functions.invoke("equipa-admin-users",{body:{action,userId:u.id,hours}});if(error||data?.error)return notify(data?.error||errText(error),"error");notify("Acesso do usuário atualizado.","success");loadAdminUsers()}
function openBanUser(u){const m=makeModal(`<div class="panel-head"><div><span class="eyebrow">Controle de acesso</span><h2>Banir ${esc(u.full_name)}</h2></div><button class="icon-button" data-close>×</button></div><div class="modal-body"><p class="muted">O banimento bloqueia novas autenticações pelo período escolhido. O histórico do usuário é preservado.</p><label>Duração<select id="ban-hours"><option value="24">24 horas</option><option value="168" selected>7 dias</option><option value="720">30 dias</option><option value="876000">Indeterminado</option></select></label><div class="modal-actions"><button class="button" data-close type="button">Cancelar</button><button class="button danger-solid" id="confirm-ban" type="button">Banir usuário</button></div></div>`);qs("#confirm-ban",m)?.addEventListener("click",()=>{const hours=Number(qs("#ban-hours",m).value);m.remove();adminUserAction(u,"ban",hours)})}

async function renderAudit(){if(state.profile.role!=="admin")return navigate("dashboard");state.view="audit";shell(`<section class="panel workspace-panel"><div class="panel-head workspace-head"><div><span class="eyebrow">Rastreabilidade</span><h2>Auditoria</h2><p>Alterações de inventário, movimentações, usuários, reservas, carrinhos e aceite legal.</p></div></div><div class="toolbar workspace-toolbar"><div class="toolbar-cluster"><input class="search" id="audit-search" value="${esc(state.auditSearch)}" placeholder="Buscar pessoa, resumo ou registro"><button class="filter-button" id="audit-filter-toggle" type="button"><span>Filtros</span></button></div></div><div class="filter-drawer" id="audit-filter-panel"><div class="filter-grid"><label>Tipo<select id="audit-entity"><option value="">Todos</option><option value="equipments">Equipamentos</option><option value="withdrawals">Retiradas</option><option value="withdrawal_items">Itens de retirada</option><option value="equipment_carts">Carrinhos</option><option value="reservations">Reservas</option><option value="maintenance_events">Manutenção</option><option value="profiles">Usuários</option><option value="user_access">Acesso de usuários</option><option value="legal_acceptances">Aceites legais</option></select></label><label>Ação<select id="audit-action"><option value="">Todas</option><option value="insert">Criação</option><option value="update">Alteração</option><option value="delete">Exclusão</option><option value="approve">Aprovação</option><option value="remove">Remoção de acesso</option><option value="ban">Banimento</option><option value="unban">Desbanimento</option></select></label></div><div class="filter-actions"><button class="button small ghost" id="audit-clear">Limpar</button><button class="button primary small" id="audit-apply">Aplicar</button></div></div><div id="audit-results"><div class="loading">Carregando auditoria…</div></div></section>`);wireFilterToggle("audit-filter-toggle","audit-filter-panel");qs("#audit-entity").value=state.auditEntity;qs("#audit-action").value=state.auditAction;qs("#audit-apply")?.addEventListener("click",()=>{state.auditEntity=qs("#audit-entity").value;state.auditAction=qs("#audit-action").value;loadAudit()});qs("#audit-clear")?.addEventListener("click",()=>{state.auditEntity="";state.auditAction="";state.auditSearch="";renderAudit()});let timer;qs("#audit-search")?.addEventListener("input",e=>{clearTimeout(timer);timer=setTimeout(()=>{state.auditSearch=e.target.value;loadAudit()},180)});await loadAudit()}
async function loadAudit(){let q=supabase.from("audit_events").select("id,occurred_at,actor_name,action,entity_type,entity_id,summary,details").order("occurred_at",{ascending:false}).limit(500);if(state.auditEntity)q=q.eq("entity_type",state.auditEntity);if(state.auditAction)q=q.eq("action",state.auditAction);const {data,error}=await q;const h=qs("#audit-results");if(!h)return;if(error){h.innerHTML=`<div class="empty"><strong>Erro ao carregar auditoria.</strong><span>${esc(errText(error))}</span></div>`;return}let rows=smartFilter(data||[],state.auditSearch,x=>[x.actor_name,x.action,x.entity_type,x.entity_id,x.summary]);if(!rows.length){h.innerHTML=`<div class="empty"><strong>Nenhum evento.</strong><span>Não há registros compatíveis com os filtros.</span></div>`;return}h.innerHTML=`<div class="data-list">${rows.map(x=>`<button class="data-row" type="button" data-audit='${esc(JSON.stringify(x))}'><div class="data-main"><strong>${esc(x.actor_name||"Sistema")} · ${esc(auditActionLabel(x.action))}</strong><span>${esc(auditEntityLabel(x.entity_type))}${x.entity_id?` · ${esc(x.entity_id)}`:""} · ${esc(x.summary||"")}</span></div><span class="status">${esc(auditActionLabel(x.action))}</span><span class="data-date">${esc(dt(x.occurred_at))}</span></button>`).join("")}</div>`;qsa("[data-audit]").forEach(b=>b.addEventListener("click",()=>openAuditDetail(JSON.parse(b.dataset.audit))))}
function auditActionLabel(v){return({insert:"Criado",update:"Alterado",delete:"Excluído",approve:"Aprovado",restore:"Restaurado",remove:"Acesso removido",deactivate:"Desativado",ban:"Banido",unban:"Desbanido"})[v]||v||"Evento"}
function auditEntityLabel(v){return({equipments:"Equipamento",withdrawals:"Retirada",withdrawal_items:"Item de retirada",equipment_carts:"Carrinho",equipment_cart_items:"Item do carrinho",reservations:"Reserva",maintenance_events:"Manutenção",profiles:"Usuário",user_access:"Acesso de usuário",legal_acceptances:"Aceite legal"})[v]||v||"Registro"}
function openAuditDetail(x){const safe=JSON.stringify(x.details||{},null,2);makeModal(`<div class="panel-head"><div><span class="eyebrow">Auditoria</span><h2>${esc(auditActionLabel(x.action))} · ${esc(auditEntityLabel(x.entity_type))}</h2></div><button class="icon-button" data-close>×</button></div><div class="modal-body"><div class="detail-grid">${detail("Responsável",x.actor_name)}${detail("Data",dt(x.occurred_at))}${detail("Registro",x.entity_id)}${detail("Resumo",x.summary)}</div><details class="audit-details"><summary>Detalhes técnicos</summary><pre>${esc(safe)}</pre></details></div>`,true)}

async function loadCapacity(){const {data,error}=await supabase.rpc("admin_capacity_status");const h=qs("#capacity");if(!h)return;if(error){h.innerHTML=`<div class="empty"><strong>Não foi possível medir.</strong><span>${esc(errText(error))}</span></div>`;return}const x=Array.isArray(data)?data[0]:data;h.innerHTML=`<div class="capacity"><div class="capacity-top"><div><span class="eyebrow">Uso atual</span><strong>${Number(x.database_mb).toLocaleString("pt-BR",{maximumFractionDigits:2})} MB</strong></div><span class="status status-${x.policy_state==='normal'?'available':'maintenance'}">${esc(x.policy_state)}</span></div><div class="capacity-track"><div class="capacity-fill" style="width:${Math.min(100,Number(x.percent_of_free_limit))}%"></div></div><small>${Number(x.percent_of_free_limit).toFixed(2)}% de ${x.free_limit_mb} MB · preparar em ${x.prepare_mb} MB · arquivar em ${x.archive_mb} MB · limpeza em ${x.purge_mb} MB</small></div>`;}

function normalizeHeader(v){return String(v||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").trim().toLowerCase().replace(/\s+/g,"_")}
function fieldFromRow(row, names){for(const n of names){const key=Object.keys(row).find(k=>normalizeHeader(k)===n);if(key!==undefined&&String(row[key]??"").trim()!=="")return String(row[key]).trim()}return ""}
function mapImportRows(raw){const seen=new Set();return raw.map((r,i)=>{const code=fieldFromRow(r,["numero","codigo","code","n","id"]);const asset=fieldFromRow(r,["patrimonio","asset_tag","asset"]);const model=fieldFromRow(r,["modelo","model"]);const label=fieldFromRow(r,["nome","label","rotulo"]);const brand=fieldFromRow(r,["marca","brand","fabricante"])||"Não informado";const serial=fieldFromRow(r,["numero_de_serie","numero_serie","serial","serial_number"]);const location=fieldFromRow(r,["local","localizacao","location","location_text"]);const notes=fieldFromRow(r,["observacao","observacoes","notes"]);let group=normalizeHeader(fieldFromRow(r,["tipo","grupo","categoria","school_group"]));group=({chromebook:"chromebook",positivo_novo:"positivo_novo",positivos_novos:"positivo_novo",positivo_tecnico:"positivo_tecnico",positivos_tecnico:"positivo_tecnico",positivo_antigo:"positivo_antigo",positivos_antigos:"positivo_antigo",thinkpad:"thinkpad_lenovo",thinkpad_lenovo:"thinkpad_lenovo",lenovo:"thinkpad_lenovo",tablet:"tablet",tablete:"tablet",tabletes:"tablet"})[group]||group||null;if(group&&!['chromebook','positivo_novo','positivo_tecnico','positivo_antigo','thinkpad_lenovo','tablet','outro'].includes(group))group='outro';let status=normalizeHeader(fieldFromRow(r,["estado","status"])||"available");status=({disponivel:"available",em_uso:"in_use",manutencao:"maintenance",indisponivel:"unavailable"})[status]||status;if(!["available","in_use","maintenance","unavailable"].includes(status))status="available";const errors=[];if(!code)errors.push("Número/código obrigatório");if(!model)errors.push("Modelo obrigatório");if(code&&seen.has(code.toLowerCase()))errors.push("Código duplicado no arquivo");if(code)seen.add(code.toLowerCase());return{line:i+2,code,asset_tag:asset||null,brand,model,label:label||null,school_group:group,serial_number:serial||null,location_text:location||null,notes:notes||null,status,is_active:true,errors}})}
function openImportModal(){const m=makeModal(`<div class="panel-head"><div><span class="eyebrow">Importação</span><h2>CSV ou Excel</h2></div><button class="icon-button" data-close>×</button></div><div class="modal-body"><p class="muted">Colunas reconhecidas: Número/Código, Patrimônio, Grupo/Tipo, Modelo, Nome, Marca, Número de série, Localização, Observações e Estado. O arquivo é processado somente no navegador.</p><input id="import-file" type="file" accept=".csv,.xlsx,.xls"><div id="import-preview" style="margin-top:14px"></div></div>`,true);qs("#import-file",m).addEventListener("change",async e=>{const file=e.target.files?.[0];if(!file)return;if(file.size>config.importMaxBytes)return notify("Arquivo maior que 5 MB.","error");try{await ensureXLSXLib();const buf=await file.arrayBuffer();const wb=window.XLSX.read(buf,{type:"array"});const raw=window.XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]],{defval:""});const rows=mapImportRows(raw);showImportPreview(m,rows)}catch(error){notify(`Não foi possível ler o arquivo: ${error.message}`,"error")}})}
function showImportPreview(modal,rows){const valid=rows.filter(r=>!r.errors.length);const host=qs("#import-preview",modal);host.innerHTML=`<div class="import-preview"><table class="preview-table"><thead><tr><th>Linha</th><th>Código</th><th>Grupo</th><th>Modelo</th><th>Nome</th><th>Estado</th><th>Validação</th></tr></thead><tbody>${rows.slice(0,200).map(r=>`<tr><td>${r.line}</td><td>${esc(r.code||"—")}</td><td>${esc(schoolGroupLabel(r.school_group))}</td><td>${esc(r.model||"—")}</td><td>${esc(r.label||"—")}</td><td>${esc(statusLabel(r.status))}</td><td class="${r.errors.length?"preview-error":""}">${esc(r.errors.join("; ")||"OK")}</td></tr>`).join("")}</tbody></table></div><div class="modal-actions"><span class="muted">${valid.length} válido(s) de ${rows.length}</span><button class="button primary" id="confirm-import" ${valid.length?"":"disabled"}>Importar válidos</button></div>`;qs("#confirm-import",modal)?.addEventListener("click",()=>performImport(modal,valid));}
async function performImport(modal,rows){const b=qs("#confirm-import",modal);setBusy(b,true,"Importando…");let inserted=0,skipped=0;try{for(let i=0;i<rows.length;i+=100){const chunk=rows.slice(i,i+100);const codes=chunk.map(r=>r.code);const {data:existing,error:e1}=await supabase.from("equipments").select("code").in("code",codes);if(e1)throw e1;const set=new Set((existing||[]).map(x=>x.code.toLowerCase()));const payload=chunk.filter(r=>!set.has(r.code.toLowerCase())).map(({line,errors,...r})=>({...r,created_by:state.profile.id}));skipped+=chunk.length-payload.length;if(payload.length){const {error}=await supabase.from("equipments").insert(payload);if(error)throw error;inserted+=payload.length}}notify(`${inserted} equipamento(s) importado(s)${skipped?` · ${skipped} duplicado(s) ignorado(s)`:""}.`,"success");modal.remove();renderEquipment()}catch(error){notify(errText(error),"error")}finally{setBusy(b,false)}}
async function fetchAllEquipments(limit=10000){const all=[];for(let from=0;from<limit;from+=500){const {data,error}=await supabase.from("equipments").select("code,asset_tag,brand,model,label,school_group,serial_number,location_text,notes,status,is_active,qr_token,created_at,updated_at").order("code").range(from,from+499);if(error)throw error;all.push(...(data||[]));if((data||[]).length<500)break}return all}
async function exportEquipments(){try{await ensureXLSXLib();const rows=await fetchAllEquipments();const sheet=window.XLSX.utils.json_to_sheet(rows.map(x=>({Numero:x.code,Patrimonio:x.asset_tag||"",Grupo:schoolGroupLabel(x.school_group),Marca:x.brand,Modelo:x.model,Nome:x.label||"",NumeroSerie:x.serial_number||"",Localizacao:x.location_text||"",Observacoes:x.notes||"",Estado:statusLabel(x.status),Ativo:x.is_active?"Sim":"Não",QR:x.qr_token,Criado:x.created_at,Atualizado:x.updated_at})));const wb=window.XLSX.utils.book_new();window.XLSX.utils.book_append_sheet(wb,sheet,"Equipamentos");window.XLSX.writeFile(wb,`Equipa-equipamentos-${new Date().toISOString().slice(0,10)}.xlsx`)}catch(error){notify(errText(error),"error")}}
function safeFileName(v="qr"){return String(v||"qr").normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-z0-9._-]+/gi,"-").replace(/-+/g,"-").replace(/^-|-$/g,"").slice(0,90)||"qr"}
async function qrPngBlob(text,size=420){await ensureQRCodeLib();const holder=document.createElement("div");holder.style.cssText="position:fixed;left:-10000px;top:-10000px;width:1px;height:1px;overflow:hidden";document.body.append(holder);new window.QRCode(holder,{text,width:size,height:size,correctLevel:window.QRCode.CorrectLevel.M});await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));const canvas=holder.querySelector("canvas");const img=holder.querySelector("img");let blob;if(canvas)blob=await new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(new Error("Falha ao gerar QR")),"image/png"));else if(img?.src){blob=await (await fetch(img.src)).blob()}holder.remove();return blob}
function downloadBlob(blob,name){const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),1000)}
async function downloadQrZip(entries,fileName){if(!entries?.length)return notify("Nenhum QR disponível.","warning");await ensureJSZipLib();const zip=new window.JSZip();const folder=zip.folder("QR-Codes");for(let i=0;i<entries.length;i++){const e=entries[i];folder.file(`${safeFileName(e.name)}.png`,await qrPngBlob(e.url));if(i%15===0)await new Promise(r=>setTimeout(r,0))}const blob=await zip.generateAsync({type:"blob",compression:"DEFLATE",compressionOptions:{level:6}});downloadBlob(blob,`${safeFileName(fileName)}.zip`);notify(`${entries.length} QR Code(s) preparados.`,"success")}
async function downloadAllEquipmentQrs(){const rows=(await fetchAllEquipments()).filter(x=>x.is_active&&x.qr_token);await downloadQrZip(rows.map(x=>({name:`${x.code}-${x.label||x.model}`,url:qrUrl(x.qr_token)})),`Equipa-QRs-equipamentos-${new Date().toISOString().slice(0,10)}`)}
async function downloadCartQrZip(token,title,items){const entries=[{name:`Carrinho-${title}`,url:qrUrl(token)},...items.filter(x=>x.qr_token).map(x=>({name:`${x.code}-${x.label||x.model}`,url:qrUrl(x.qr_token)}))];await downloadQrZip(entries,`Equipa-QRs-${title}`)}
async function printQrBatch(){try{await ensureQRCodeLib();const {data,error}=await supabase.from("equipments").select("code,label,brand,model,qr_token").eq("is_active",true).order("code").limit(200);if(error)throw error;const m=makeModal(`<div class="printable"><div class="panel-head"><div><span class="eyebrow">Impressão</span><h2>QR Codes · ${data.length} equipamento(s)</h2></div><button class="icon-button" data-close>×</button></div><div class="modal-body"><div id="qr-batch" style="display:grid;grid-template-columns:repeat(3,1fr);gap:14px"></div><div class="modal-actions"><button class="button primary" id="print-batch">Imprimir</button></div></div></div>`,true);const h=qs("#qr-batch",m);data.forEach((e,i)=>{const card=document.createElement("div");card.style.cssText="border:1px solid #ddd;border-radius:10px;padding:12px;text-align:center;break-inside:avoid";card.innerHTML=`<div id="qrb-${i}" style="display:grid;place-items:center"></div><strong style="display:block;margin-top:8px">${esc(e.label||e.code)}</strong><small>${esc(e.code)} · ${esc(e.model)}</small>`;h.append(card);new window.QRCode(qs(`#qrb-${i}`,card),{text:qrUrl(e.qr_token),width:112,height:112,correctLevel:window.QRCode.CorrectLevel.M})});qs("#print-batch",m).addEventListener("click",()=>window.print());if(data.length===200)notify("A impressão em lote foi limitada aos primeiros 200 equipamentos para proteger o navegador.","warning")}catch(error){notify(errText(error),"error")}}

function parseQrToken(raw = "") {
  const value = String(raw || "").trim();
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (uuidPattern.test(value)) return value;
  try {
    const url = new URL(value);
    const token = url.searchParams.get("qr") || url.searchParams.get("e");
    return uuidPattern.test(token || "") ? token : null;
  } catch { return null; }
}
async function openScannedToken(token) {
  const scan = await scanPublic(token);
  if (!scan) return notify("QR inválido, inativo ou não reconhecido pelo Equipa.", "error");
  if (scan.kind === "cart") {
    state.view = "carts";
    await renderCarts();
    return openCart(token);
  }
  const { data, error } = await supabase.from("equipments").select("id").eq("qr_token", token).maybeSingle();
  if (error || !data) return notify("Equipamento não encontrado.", "error");
  state.view = "equipment";
  await renderEquipment();
  return openEquipment(data.id);
}
async function openMobileQrScanner() {
  let jsQR;
  try { jsQR = await ensureJsQRLib(); }
  catch (error) { return notify(error.message, "error"); }
  if (!navigator.mediaDevices?.getUserMedia) return notify("Este navegador não oferece acesso à câmera para leitura de QR.", "error");
  const back = document.createElement("div");
  back.className = "modal-backdrop scanner-backdrop";
  back.innerHTML = `<section class="mobile-scanner" role="dialog" aria-modal="true"><header class="scanner-head"><div><span class="eyebrow">Leitor Equipa</span><h2>Aponte para o QR Code</h2></div><button class="scanner-close" type="button" aria-label="Fechar">×</button></header><div class="scanner-stage"><video class="scanner-video" autoplay muted playsinline></video><canvas class="scanner-canvas" aria-hidden="true"></canvas><div class="scanner-frame"><i></i><i></i><i></i><i></i></div><div class="scanner-line"></div></div><p class="scanner-help">Mantenha o código dentro da área marcada. A leitura acontece automaticamente.</p></section>`;
  document.body.append(back);
  const video = qs(".scanner-video", back);
  const canvas = qs(".scanner-canvas", back);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  let stream = null;
  let raf = 0;
  let stopped = false;
  let lastScan = 0;
  const cleanup = () => {
    if (stopped) return;
    stopped = true;
    cancelAnimationFrame(raf);
    stream?.getTracks().forEach(track => track.stop());
    back.remove();
  };
  qs(".scanner-close", back)?.addEventListener("click", cleanup);
  back.addEventListener("click", e => { if (e.target === back) cleanup(); });
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
    video.srcObject = stream;
    await video.play();
  } catch (error) {
    cleanup();
    return notify("Não foi possível acessar a câmera. Verifique a permissão do navegador.", "error");
  }
  const tick = async now => {
    if (stopped) return;
    raf = requestAnimationFrame(tick);
    if (now - lastScan < 120 || video.readyState < 2) return;
    lastScan = now;
    const vw = video.videoWidth, vh = video.videoHeight;
    if (!vw || !vh) return;
    const maxW = 720;
    const scale = Math.min(1, maxW / vw);
    canvas.width = Math.max(1, Math.floor(vw * scale));
    canvas.height = Math.max(1, Math.floor(vh * scale));
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const result = jsQR(image.data, image.width, image.height, { inversionAttempts: "dontInvert" });
    const token = result?.data ? parseQrToken(result.data) : null;
    if (!token) return;
    if (navigator.vibrate) navigator.vibrate(45);
    cleanup();
    await openScannedToken(token);
  };
  raf = requestAnimationFrame(tick);
}

async function handleScanAfterLogin(){const token=scanTokenFromUrl();if(!token)return false;const scan=await scanPublic(token);if(!scan){notify("QR inválido ou inativo.","error");return false}state.pendingScan=scan;if(scan.kind==="cart"){state.view="carts";await renderCarts();await openCart(token);return true}const {data,error}=await supabase.from("equipments").select("id").eq("qr_token",token).maybeSingle();if(error||!data)return false;state.view="equipment";await renderEquipment();await openEquipment(data.id);return true}
const STARTUP_TIMEOUT_MS = 12000;
let authInitGeneration = 0;
let authSubscription = null;
let bootRunning = false;

function withTimeout(promise, ms = STARTUP_TIMEOUT_MS, label = "operação") {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Tempo limite excedido ao carregar ${label}.`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function showBootLoader() {
  app.innerHTML = `<main class="boot" aria-label="Carregando"><div class="iphone-loader"><i></i></div></main>`;
}

function renderStartupError(error) {
  console.error("Equipa startup:", error);
  window.__equipaBootReady?.();
  app.innerHTML = `<main class="boot boot-error"><div class="startup-error-card"><strong>Não foi possível abrir o Equipa.</strong><span>${esc(errText(error))}</span><div class="startup-error-actions"><button class="button primary" id="startup-retry" type="button">Tentar novamente</button><button class="button ghost" id="startup-signout" type="button">Abrir login</button></div></div></main>`;
  qs("#startup-retry")?.addEventListener("click", () => boot());
  qs("#startup-signout")?.addEventListener("click", async () => {
    try { await withTimeout(supabase.auth.signOut(), 6000, "saída da conta"); } catch {}
    state.session = null;
    state.profile = null;
    renderAuth(null);
    window.__equipaBootReady?.();
  });
}

async function initSession(session) {
  if (!session?.user?.id) throw new Error("Sessão inválida. Entre novamente.");
  state.session = session;
  try {
    await withTimeout(loadProfile(), STARTUP_TIMEOUT_MS, "perfil escolar");
  } catch (error) {
    const message = String(error?.message || error || "");
    if (/perfil|row|not found|PGRST116/i.test(message)) {
      try { await withTimeout(supabase.auth.signOut(), 6000, "saída da conta"); } catch {}
      state.session = null;
      state.profile = null;
      renderAuth(null);
      notify("Sua conta existe, mas o perfil escolar ainda não foi criado.", "error");
      window.__equipaBootReady?.();
      return;
    }
    throw error;
  }

  const { data: allowed, error: accessError } = await withTimeout(
    supabase.rpc("equipa_access_allowed"), STARTUP_TIMEOUT_MS, "permissões da conta"
  );
  if (accessError) throw accessError;
  if (allowed !== true) {
    renderPendingApproval();
    window.__equipaBootReady?.();
    return;
  }

  // Não aplicamos timeout enquanto o usuário está lendo/aceitando os documentos.
  if (!(await ensureLegalAcceptance())) {
    window.__equipaBootReady?.();
    return;
  }

  const handledScan = await withTimeout(handleScanAfterLogin(), STARTUP_TIMEOUT_MS, "QR Code inicial");
  if (!handledScan) await withTimeout(renderDashboard(), STARTUP_TIMEOUT_MS, "visão geral");
  window.__equipaBootReady?.();
}

function scheduleSessionInit(sessionNow) {
  const generation = ++authInitGeneration;
  setTimeout(() => {
    if (generation !== authInitGeneration) return;
    showBootLoader();
    initSession(sessionNow).catch(renderStartupError);
  }, 0);
}

function installAuthListener() {
  authSubscription?.unsubscribe?.();
  const result = supabase.auth.onAuthStateChange((event, sessionNow) => {
    if (event === "TOKEN_REFRESHED" && sessionNow) {
      state.session = sessionNow;
      return;
    }
    if (event === "SIGNED_OUT" || !sessionNow) {
      authInitGeneration++;
      state.session = null;
      state.profile = null;
      renderAuth(null);
      window.__equipaBootReady?.();
      return;
    }
    if (event === "SIGNED_IN" && (!state.session || state.session.user?.id !== sessionNow.user?.id)) {
      scheduleSessionInit(sessionNow);
    }
  });
  authSubscription = result?.data?.subscription || result?.subscription || null;
}

async function boot() {
  if (bootRunning) return;
  bootRunning = true;
  try {
    installGlobalContextMenus();

    // O login nasce localmente; a rede nunca é requisito para sair do loading inicial.
    renderAuth(null);
    window.__equipaBootReady?.();
    installAuthListener();

    const { data, error } = await withTimeout(supabase.auth.getSession(), 8000, "sessão");
    if (error) {
      console.warn("Não foi possível restaurar a sessão; mantendo tela de login.", error);
      notify("Não foi possível restaurar a sessão anterior. Entre novamente.", "warning");
      return;
    }

    const session = data?.session || null;
    if (!session) return;

    showBootLoader();
    await initSession(session);
  } catch (error) {
    renderStartupError(error);
  } finally {
    bootRunning = false;
  }
}

boot();
