(function () {
"use strict";
/*
 * Equipa Supabase browser client (local, dependency-free)
 * Implements only the Supabase surfaces used by Equipa:
 * Auth, PostgREST table queries, RPC and Edge Functions.
 * No service/secret key is present here. The browser uses only the publishable key.
 */

const config = window.EQUIPA_CONFIG;

if (!config?.supabaseUrl || !config?.supabasePublishableKey) {
  throw new Error("Configuração do Supabase ausente.");
}

const API_URL = String(config.supabaseUrl).replace(/\/$/, "");
const API_KEY = String(config.supabasePublishableKey);
const PROJECT_REF = (() => {
  try { return new URL(API_URL).hostname.split(".")[0] || "equipa"; }
  catch { return "equipa"; }
})();
const STORAGE_KEY = `sb-${PROJECT_REF}-auth-token`;
const listeners = new Set();
let memorySession = null;
let refreshTimer = null;
const NETWORK_TIMEOUT_MS = 12000;

async function fetchWithTimeout(url, options = {}, timeoutMs = NETWORK_TIMEOUT_MS) {
  const controller = new AbortController();
  const externalSignal = options.signal;
  let externalAbort;
  if (externalSignal) {
    if (externalSignal.aborted) controller.abort(externalSignal.reason);
    else {
      externalAbort = () => controller.abort(externalSignal.reason);
      externalSignal.addEventListener("abort", externalAbort, { once: true });
    }
  }
  const timer = setTimeout(() => controller.abort(new DOMException("Tempo limite de rede excedido.", "TimeoutError")), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
    if (externalSignal && externalAbort) externalSignal.removeEventListener("abort", externalAbort);
  }
}

function safeJsonParse(value) {
  if (!value) return null;
  try { return JSON.parse(value); } catch { return null; }
}

function readStoredSession() {
  if (memorySession) return memorySession;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = safeJsonParse(raw);
    if (!parsed) return null;
    // Supabase-js uses this same storage key. Accept both a direct session and
    // compatibility wrappers that may contain currentSession/session.
    const candidate = parsed.currentSession || parsed.session || parsed;
    if (candidate?.access_token && candidate?.refresh_token) {
      memorySession = normalizeSession(candidate);
      return memorySession;
    }
  } catch {}
  return null;
}

function writeStoredSession(session) {
  memorySession = session || null;
  try {
    if (session) localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {}
  scheduleRefresh(session);
}

function userFromAccessToken(token) {
  try {
    const part = String(token || "").split(".")[1];
    if (!part) return null;
    const base64 = part.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(part.length / 4) * 4, "=");
    const payload = JSON.parse(atob(base64));
    if (!payload?.sub) return null;
    return { id: payload.sub, email: payload.email || null, role: payload.role || "authenticated" };
  } catch { return null; }
}

function normalizeSession(raw) {
  if (!raw?.access_token) return null;
  const expiresIn = Number(raw.expires_in || 3600);
  const expiresAt = Number(raw.expires_at || Math.floor(Date.now() / 1000) + expiresIn);
  return {
    access_token: raw.access_token,
    refresh_token: raw.refresh_token || "",
    token_type: raw.token_type || "bearer",
    expires_in: expiresIn,
    expires_at: expiresAt,
    user: raw.user || userFromAccessToken(raw.access_token)
  };
}

function emitAuth(event, session) {
  for (const callback of [...listeners]) {
    try { callback(event, session); } catch (error) { console.error("Equipa auth listener:", error); }
  }
}

function scheduleRefresh(session) {
  if (refreshTimer) clearTimeout(refreshTimer);
  refreshTimer = null;
  if (!session?.refresh_token || !session?.expires_at) return;
  const delay = Math.max(15_000, (session.expires_at * 1000) - Date.now() - 60_000);
  refreshTimer = setTimeout(() => {
    refreshSession(session.refresh_token).catch(() => {});
  }, Math.min(delay, 2_147_000_000));
}

function errorFromPayload(payload, fallback = "Falha na comunicação com o servidor.") {
  if (payload instanceof Error) return payload;
  const message = payload?.message || payload?.msg || payload?.error_description || payload?.error || payload?.hint || fallback;
  const error = new Error(String(message));
  if (payload?.code) error.code = payload.code;
  if (payload?.details) error.details = payload.details;
  if (payload?.hint) error.hint = payload.hint;
  return error;
}

async function parseResponse(response) {
  if (response.status === 204 || response.status === 205) return null;
  const text = await response.text();
  if (!text) return null;
  try { return JSON.parse(text); } catch { return text; }
}

function authHeaders(session = readStoredSession()) {
  const headers = { apikey: API_KEY };
  if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`;
  return headers;
}

async function authFetch(path, { method = "POST", body, session, headers = {} } = {}) {
  const response = await fetchWithTimeout(`${API_URL}/auth/v1${path}`, {
    method,
    headers: {
      apikey: API_KEY,
      "Content-Type": "application/json",
      ...((session?.access_token) ? { Authorization: `Bearer ${session.access_token}` } : {}),
      ...headers
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store"
  });
  const payload = await parseResponse(response);
  if (!response.ok) throw errorFromPayload(payload, `Falha de autenticação (${response.status}).`);
  return payload;
}

async function refreshSession(refreshToken) {
  if (!refreshToken) return null;
  try {
    const payload = await authFetch("/token?grant_type=refresh_token", { body: { refresh_token: refreshToken } });
    const session = normalizeSession(payload);
    if (!session) throw new Error("Sessão renovada inválida.");
    writeStoredSession(session);
    emitAuth("TOKEN_REFRESHED", session);
    return session;
  } catch (error) {
    writeStoredSession(null);
    emitAuth("SIGNED_OUT", null);
    throw error;
  }
}

function sessionFromUrl() {
  try {
    const hash = new URLSearchParams(location.hash.replace(/^#/, ""));
    const accessToken = hash.get("access_token");
    const refreshToken = hash.get("refresh_token");
    if (!accessToken || !refreshToken) return null;
    const expiresIn = Number(hash.get("expires_in") || 3600);
    const session = normalizeSession({
      access_token: accessToken,
      refresh_token: refreshToken,
      expires_in: expiresIn,
      token_type: hash.get("token_type") || "bearer"
    });
    history.replaceState(null, document.title, `${location.pathname}${location.search}`);
    return session;
  } catch { return null; }
}

class QueryBuilder {
  constructor(client, table) {
    this.client = client;
    this.table = table;
    this.method = "GET";
    this.columns = "*";
    this.body = undefined;
    this.filters = [];
    this.orders = [];
    this.limitValue = null;
    this.offsetValue = null;
    this.countMode = null;
    this.headOnly = false;
    this.singleMode = null;
  }

  select(columns = "*", options = {}) {
    this.columns = columns || "*";
    this.countMode = options?.count || this.countMode;
    this.headOnly = Boolean(options?.head);
    if (this.method === "GET" && this.headOnly) this.method = "HEAD";
    return this;
  }
  insert(value) { this.method = "POST"; this.body = value; return this; }
  update(value) { this.method = "PATCH"; this.body = value; return this; }
  delete() { this.method = "DELETE"; return this; }
  eq(column, value) { this.filters.push([column, `eq.${formatFilterValue(value)}`]); return this; }
  or(expression) { this.filters.push(["or", `(${String(expression)})`]); return this; }
  in(column, values) {
    const encoded = (values || []).map(v => `"${String(v).replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`).join(",");
    this.filters.push([column, `in.(${encoded})`]);
    return this;
  }
  order(column, options = {}) { this.orders.push(`${column}.${options?.ascending === false ? "desc" : "asc"}`); return this; }
  limit(value) { this.limitValue = Math.max(0, Number(value) || 0); return this; }
  range(from, to) {
    this.offsetValue = Math.max(0, Number(from) || 0);
    this.limitValue = Math.max(0, (Number(to) || 0) - this.offsetValue + 1);
    return this;
  }
  single() { this.singleMode = "single"; return this; }
  maybeSingle() { this.singleMode = "maybe"; return this; }

  then(resolve, reject) { return this.execute().then(resolve, reject); }
  catch(reject) { return this.execute().catch(reject); }
  finally(callback) { return this.execute().finally(callback); }

  async execute() {
    try {
      const params = new URLSearchParams();
      if (this.columns && (this.method === "GET" || this.method === "HEAD")) params.set("select", this.columns);
      for (const [key, value] of this.filters) params.append(key, value);
      if (this.orders.length) params.set("order", this.orders.join(","));
      if (this.limitValue !== null) params.set("limit", String(this.limitValue));
      if (this.offsetValue !== null) params.set("offset", String(this.offsetValue));

      const headers = {
        ...authHeaders(),
        "Accept": "application/json"
      };
      const prefer = [];
      if (this.countMode) prefer.push(`count=${this.countMode}`);
      if (["POST", "PATCH", "DELETE"].includes(this.method)) prefer.push("return=representation");
      if (prefer.length) headers.Prefer = prefer.join(",");
      if (this.body !== undefined) headers["Content-Type"] = "application/json";

      let url = `${API_URL}/rest/v1/${encodeURIComponent(this.table)}`;
      const query = params.toString();
      if (query) url += `?${query}`;

      const response = await fetchWithTimeout(url, {
        method: this.method,
        headers,
        body: this.body === undefined ? undefined : JSON.stringify(this.body),
        cache: "no-store"
      });
      const payload = this.method === "HEAD" ? null : await parseResponse(response);
      let count = null;
      const contentRange = response.headers.get("content-range");
      if (contentRange?.includes("/")) {
        const tail = contentRange.split("/").pop();
        if (tail && tail !== "*") count = Number(tail);
      }

      if (!response.ok) return { data: null, error: errorFromPayload(payload, `Erro de banco (${response.status}).`), count };

      let data = payload;
      if (this.singleMode) {
        const rows = Array.isArray(payload) ? payload : (payload == null ? [] : [payload]);
        if (this.singleMode === "single" && rows.length !== 1) {
          const error = new Error("Resultado único não encontrado.");
          error.code = "PGRST116";
          return { data: null, error, count };
        }
        if (this.singleMode === "maybe" && rows.length > 1) {
          const error = new Error("Mais de um resultado encontrado.");
          error.code = "PGRST116";
          return { data: null, error, count };
        }
        data = rows[0] || null;
      }
      return { data, error: null, count };
    } catch (error) {
      return { data: null, error: errorFromPayload(error), count: null };
    }
  }
}

function formatFilterValue(value) {
  if (value === null) return "null";
  if (typeof value === "boolean" || typeof value === "number") return String(value);
  return String(value);
}

class EquipaSupabaseClient {
  from(table) { return new QueryBuilder(this, table); }

  async rpc(name, params = {}) {
    try {
      const response = await fetchWithTimeout(`${API_URL}/rest/v1/rpc/${encodeURIComponent(name)}`, {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(params || {}),
        cache: "no-store"
      });
      const payload = await parseResponse(response);
      if (!response.ok) return { data: null, error: errorFromPayload(payload, `Erro de operação (${response.status}).`) };
      return { data: payload, error: null };
    } catch (error) {
      return { data: null, error: errorFromPayload(error) };
    }
  }

  auth = {
    getSession: async () => {
      try {
        const urlSession = sessionFromUrl();
        if (urlSession) writeStoredSession(urlSession);
        let session = urlSession || readStoredSession();
        if (session?.expires_at && session.expires_at * 1000 <= Date.now() + 30_000) {
          if (session.refresh_token) session = await refreshSession(session.refresh_token);
          else { writeStoredSession(null); session = null; }
        }
        return { data: { session: session || null }, error: null };
      } catch (error) {
        writeStoredSession(null);
        return { data: { session: null }, error: errorFromPayload(error) };
      }
    },

    signInWithPassword: async ({ email, password }) => {
      try {
        const payload = await authFetch("/token?grant_type=password", { body: { email, password } });
        const session = normalizeSession(payload);
        if (!session) throw new Error("Resposta de login inválida.");
        writeStoredSession(session);
        emitAuth("SIGNED_IN", session);
        return { data: { user: session.user, session }, error: null };
      } catch (error) {
        return { data: { user: null, session: null }, error: errorFromPayload(error) };
      }
    },

    signUp: async ({ email, password, options = {} }) => {
      try {
        const payload = await authFetch("/signup", { body: { email, password, data: options?.data || {} } });
        let session = null;
        if (payload?.access_token) {
          session = normalizeSession(payload);
          writeStoredSession(session);
          emitAuth("SIGNED_IN", session);
        }
        const user = payload?.user || (payload?.id ? payload : session?.user) || null;
        return { data: { user, session }, error: null };
      } catch (error) {
        return { data: { user: null, session: null }, error: errorFromPayload(error) };
      }
    },

    signOut: async () => {
      const session = readStoredSession();
      let error = null;
      try {
        if (session?.access_token) await authFetch("/logout", { session, body: {} });
      } catch (e) { error = errorFromPayload(e); }
      writeStoredSession(null);
      emitAuth("SIGNED_OUT", null);
      return { error };
    },

    resetPasswordForEmail: async (email, options = {}) => {
      try {
        const query = options?.redirectTo ? `?redirect_to=${encodeURIComponent(options.redirectTo)}` : "";
        await authFetch(`/recover${query}`, { body: { email } });
        return { data: {}, error: null };
      } catch (error) {
        return { data: null, error: errorFromPayload(error) };
      }
    },

    onAuthStateChange: (callback) => {
      listeners.add(callback);
      return { data: { subscription: { unsubscribe: () => listeners.delete(callback) } } };
    }
  };

  functions = {
    invoke: async (name, options = {}) => {
      try {
        const session = readStoredSession();
        if (!session?.access_token) return { data: null, error: new Error("Sessão necessária.") };
        const response = await fetchWithTimeout(`${API_URL}/functions/v1/${encodeURIComponent(name)}`, {
          method: "POST",
          headers: {
            ...authHeaders(session),
            "Content-Type": "application/json",
            Accept: "application/json"
          },
          body: JSON.stringify(options?.body ?? {}),
          cache: "no-store"
        });
        const payload = await parseResponse(response);
        if (!response.ok) return { data: payload, error: errorFromPayload(payload, `Erro da função (${response.status}).`) };
        return { data: payload, error: null };
      } catch (error) {
        return { data: null, error: errorFromPayload(error) };
      }
    }
  };
}

const supabase = new EquipaSupabaseClient();
window.EquipaSupabase = Object.freeze({ supabase, config });

// Keep existing Supabase-js sessions alive when possible.
scheduleRefresh(readStoredSession());

})();
