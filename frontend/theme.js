(() => {
  "use strict";

  const CLAVE = "simulab:tema";
  const HTML = document.documentElement;
  const media =
    typeof window.matchMedia === "function"
      ? window.matchMedia("(prefers-color-scheme: dark)")
      : null;

  function normalizar(valor) {
    return valor === "oscuro" || valor === "claro" ? valor : null;
  }

  function temaGuardado() {
    try {
      return normalizar(window.localStorage.getItem(CLAVE));
    } catch {
      return null;
    }
  }

  function temaPreferido() {
    return media?.matches ? "oscuro" : "claro";
  }

  function temaActual() {
    return HTML.dataset.tema === "oscuro" ? "oscuro" : "claro";
  }

  function actualizarBoton() {
    const boton = document.querySelector("[data-tema-toggle]");
    if (!boton) return;
    const oscuro = temaActual() === "oscuro";
    boton.setAttribute("aria-pressed", String(oscuro));
    boton.setAttribute(
      "aria-label",
      oscuro ? "Activar tema claro" : "Activar tema oscuro"
    );
    boton.title = oscuro ? "Cambiar a tema claro" : "Cambiar a tema oscuro";
  }

  function aplicarTema(tema, { persistir = false } = {}) {
    const siguiente = normalizar(tema) || temaPreferido();
    HTML.dataset.tema = siguiente;
    HTML.style.colorScheme = siguiente === "oscuro" ? "dark" : "light";
    if (persistir) {
      try {
        window.localStorage.setItem(CLAVE, siguiente);
      } catch {
        /* El tema sigue funcionando aunque no se pueda guardar. */
      }
    }
    actualizarBoton();
    document.dispatchEvent(
      new CustomEvent("simulab:tema", { detail: { tema: siguiente } })
    );
  }

  function montar() {
    const boton = document.querySelector("[data-tema-toggle]");
    boton?.addEventListener("click", () => {
      aplicarTema(temaActual() === "oscuro" ? "claro" : "oscuro", {
        persistir: true,
      });
    });

    actualizarBoton();

    media?.addEventListener?.("change", (evento) => {
      if (!temaGuardado()) {
        aplicarTema(evento.matches ? "oscuro" : "claro");
      }
    });

    window.addEventListener("storage", (evento) => {
      if (evento.key !== CLAVE) return;
      aplicarTema(normalizar(evento.newValue) || temaPreferido());
    });
  }

  if (!HTML.dataset.tema) {
    aplicarTema(temaGuardado() || temaPreferido());
  } else {
    actualizarBoton();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", montar, { once: true });
  } else {
    montar();
  }
})();
