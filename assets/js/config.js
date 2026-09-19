// A publishable key do Supabase pode ficar no frontend.
// NUNCA coloque sb_secret_*, service_role ou qualquer segredo aqui.
window.DASEIN_CONFIG = Object.freeze({
  supabaseUrl: "COLE_AQUI_A_URL_DO_SUPABASE",
  supabasePublishableKey: "COLE_AQUI_A_PUBLISHABLE_KEY",
  appName: "Dasein",
  termsVersion: "0.1.0",
  pageSize: 20
});
