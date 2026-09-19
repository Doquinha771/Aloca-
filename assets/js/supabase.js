import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.116.0/+esm";

const config = window.DASEIN_CONFIG ?? {};

export const isConfigured = Boolean(
  config.supabaseUrl &&
  config.supabasePublishableKey &&
  !config.supabaseUrl.startsWith("COLE_AQUI") &&
  !config.supabasePublishableKey.startsWith("COLE_AQUI")
);

export const supabase = isConfigured
  ? createClient(config.supabaseUrl, config.supabasePublishableKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true
      }
    })
  : null;

export { config };
