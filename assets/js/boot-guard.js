(function () {
  const app = document.getElementById("app");
  if (!app) return;
  const timeoutMs = 16000;
  const clear = () => {
    if (window.__equipaBootTimer) clearTimeout(window.__equipaBootTimer);
    window.__equipaBootTimer = null;
  };
  window.__equipaBootReady = clear;
  const observer = new MutationObserver(() => {
    if (!app.querySelector(".boot:not(.boot-error)")) {
      clear();
      observer.disconnect();
    }
  });
  observer.observe(app, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });
  window.__equipaBootTimer = setTimeout(() => {
    const stillBooting = app.querySelector(".boot:not(.boot-error)");
    if (!stillBooting) return;
    app.innerHTML = '<main class="boot boot-error"><div class="startup-error-card"><strong>O Equipa não conseguiu iniciar.</strong><span>O navegador não carregou um dos arquivos necessários. Atualize a página ou limpe o cache do site.</span><div class="startup-error-actions"><button class="button primary" id="boot-guard-reload" type="button">Recarregar</button></div></div></main>';
    document.getElementById("boot-guard-reload")?.addEventListener("click", () => location.reload());
  }, timeoutMs);
})();
