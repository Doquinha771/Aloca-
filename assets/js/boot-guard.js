(function () {
  var app = document.getElementById("app");
  if (!app) return;
  var timer = null;
  var failed = false;
  function escapeHtml(value) {
    return String(value || "").replace(/[&<>"']/g, function (c) {
      return {"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"}[c];
    });
  }
  function clearGuard() { if (timer) clearTimeout(timer); timer = null; }
  function showFailure(message) {
    if (failed) return;
    failed = true;
    clearGuard();
    app.innerHTML = '<main class="boot boot-error"><div class="startup-error-card"><strong>O Equipa não conseguiu iniciar.</strong><span>' + escapeHtml(message || "Falha ao carregar os arquivos do site.") + '</span><div class="startup-error-actions"><button class="button primary" id="boot-guard-reload" type="button">Recarregar</button></div></div></main>';
    var btn = document.getElementById("boot-guard-reload");
    if (btn) btn.addEventListener("click", function () { location.reload(); });
  }
  window.__equipaBootReady = function () { clearGuard(); failed = false; };
  window.addEventListener("error", function (event) {
    var source = event && event.filename || "";
    if (/assets\/js\//.test(source) || /Cliente Supabase/.test(String(event && event.message || ""))) {
      showFailure("Falha ao carregar o aplicativo. Atualize a página para tentar novamente.");
    }
  });
  window.addEventListener("unhandledrejection", function (event) {
    var message = event && event.reason && event.reason.message || String(event && event.reason || "");
    if (app.querySelector(".boot:not(.boot-error)")) showFailure(message || "Falha durante a inicialização.");
  });
  timer = setTimeout(function () {
    if (app.querySelector(".boot:not(.boot-error)")) showFailure("A inicialização demorou mais do que o esperado. Verifique a conexão e recarregue.");
  }, 10000);
})();
