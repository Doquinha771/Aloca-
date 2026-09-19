import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const json = (body: unknown, status = 200, origin = "*") =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Vary": "Origin",
      "Cache-Control": "no-store"
    }
  });

Deno.serve(async (req) => {
  const origin = req.headers.get("origin") || "*";
  if (req.method === "OPTIONS") return json({ ok: true }, 200, origin);
  if (req.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405, origin);

  try {
    const url = Deno.env.get("SUPABASE_URL");
    const publishableBag = Deno.env.get("SUPABASE_PUBLISHABLE_KEYS");
    const secretBag = Deno.env.get("SUPABASE_SECRET_KEYS");
    const publishable = publishableBag ? JSON.parse(publishableBag).default : Deno.env.get("SUPABASE_ANON_KEY");
    const secret = secretBag ? JSON.parse(secretBag).default : Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const authHeader = req.headers.get("Authorization") || "";

    if (!url || !publishable || !secret || !authHeader.startsWith("Bearer ")) {
      return json({ error: "UNAUTHORIZED" }, 401, origin);
    }

    const userClient = createClient(url, publishable, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false, autoRefreshToken: false }
    });
    const token = authHeader.slice(7);
    const { data: userData, error: userError } = await userClient.auth.getUser(token);
    const caller = userData?.user;
    if (userError || !caller) return json({ error: "UNAUTHORIZED" }, 401, origin);

    const admin = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: callerProfile, error: profileError } = await admin
      .from("profiles")
      .select("id,full_name,role,is_active")
      .eq("id", caller.id)
      .single();

    if (profileError || !callerProfile || callerProfile.role !== "admin" || !callerProfile.is_active) {
      return json({ error: "ADMIN_REQUIRED" }, 403, origin);
    }

    const body = await req.json().catch(() => ({}));
    const action = String(body?.action || "");
    const targetUserId = String(body?.userId || "");
    if (!/^[0-9a-f-]{36}$/i.test(targetUserId)) return json({ error: "INVALID_USER_ID" }, 400, origin);
    if (targetUserId === caller.id && ["ban", "remove", "deactivate"].includes(action)) {
      return json({ error: "SELF_ACTION_FORBIDDEN" }, 400, origin);
    }

    const { data: targetProfile, error: targetError } = await admin
      .from("profiles")
      .select("id,full_name,role,is_active")
      .eq("id", targetUserId)
      .single();
    if (targetError || !targetProfile) return json({ error: "USER_NOT_FOUND" }, 404, origin);

    let summary = "";
    const details: Record<string, unknown> = {};

    if (action === "approve" || action === "restore") {
      const { error: authError } = await admin.auth.admin.updateUserById(targetUserId, { ban_duration: "0s" });
      if (authError) throw authError;
      const { error } = await admin.from("profiles").update({ is_active: true, disabled_at: null, updated_at: new Date().toISOString() }).eq("id", targetUserId);
      if (error) throw error;
      summary = action === "approve" ? "Conta aprovada" : "Acesso restaurado";
    } else if (action === "ban") {
      const hours = Math.max(1, Math.min(Number(body?.hours || 168), 876000));
      const { error } = await admin.auth.admin.updateUserById(targetUserId, { ban_duration: `${hours}h` });
      if (error) throw error;
      summary = "Conta banida";
      details.hours = hours;
    } else if (action === "unban") {
      const { error } = await admin.auth.admin.updateUserById(targetUserId, { ban_duration: "0s" });
      if (error) throw error;
      summary = "Banimento removido";
    } else if (action === "remove" || action === "deactivate") {
      const { error: authError } = await admin.auth.admin.updateUserById(targetUserId, { ban_duration: "876000h" });
      if (authError) throw authError;
      const { error } = await admin.from("profiles").update({ is_active: false, disabled_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", targetUserId);
      if (error) throw error;
      summary = "Acesso removido preservando histórico";
    } else {
      return json({ error: "INVALID_ACTION" }, 400, origin);
    }

    await admin.from("audit_events").insert({
      actor_id: caller.id,
      actor_name: callerProfile.full_name,
      action,
      entity_type: "user_access",
      entity_id: targetUserId,
      summary,
      details: { ...details, target_name: targetProfile.full_name, target_role: targetProfile.role }
    });

    return json({ ok: true, action, userId: targetUserId }, 200, origin);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "INTERNAL_ERROR" }, 500, req.headers.get("origin") || "*");
  }
});
