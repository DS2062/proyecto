(() => {
  "use strict";

  /* ========================================================================
     Configuración y estado
     ======================================================================== */

  const API_BASE = (() => {
    const configurada = window.QUEUELAB_API_BASE;
    if (typeof configurada === "string" && configurada.trim()) {
      return configurada.trim().replace(/\/+$/, "");
    }
    if (window.location.protocol === "file:") {
      return "http://127.0.0.1:5000";
    }
    return "";
  })();

  const MODELO_FINITO = "mmc_finito";
  const MAX_TASA = 1e9;
  const MAX_C = 500;
  const MAX_N = 10000;
  const MAX_NMAX = 10000;
  const MAX_INDICE_PROBABILIDAD = 1000000000;
  const MAX_PUNTOS_GRAFICA = 180;
  const MODULO_HISTORIAL = "mmc";

  const state = {
    calculo: null,
    probabilidad: null,
    charts: { absoluta: null, acumulada: null },
    chartsDirty: true,
    historialCargado: false,
    historialCargando: false,
    historialOffset: 0,
    historialLimite: 25,
    historialTotal: 0,
    historialPendiente: null,
    generandoPDF: false,
    fuentesPDF: null,
    iframeImpresion: null,
  };

  const formato6 = new Intl.NumberFormat("es-MX", {
    maximumFractionDigits: 6,
  });

  const formatoPorcentaje = new Intl.NumberFormat("es-MX", {
    maximumFractionDigits: 2,
  });

  const formatoPorcentaje4 = new Intl.NumberFormat("es-MX", {
    maximumFractionDigits: 4,
  });

  const formatoFecha = new Intl.DateTimeFormat("es-MX", {
    dateStyle: "long",
    timeStyle: "short",
  });

  const formatoFechaCorta = new Intl.DateTimeFormat("es-MX", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });

  const formatoHora = new Intl.DateTimeFormat("es-MX", {
    hour: "2-digit",
    minute: "2-digit",
  });

  class ApiError extends Error {
    constructor(mensaje, campo = null, estado = 0) {
      super(mensaje);
      this.name = "ApiError";
      this.campo = campo;
      this.estado = estado;
    }
  }

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

  /* ========================================================================
     Utilidades
     ======================================================================== */

  function esperar(ms) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
  }

  function escaparHTML(valor) {
    return String(valor ?? "").replace(/[&<>"']/g, (caracter) => {
      const mapa = {
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      };
      return mapa[caracter];
    });
  }

  function numero(valor) {
    const convertido = Number(valor);
    return Number.isFinite(convertido) ? convertido : null;
  }

  function fmtNumero(valor) {
    const convertido = numero(valor);
    if (convertido === null) return "—";
    if (convertido !== 0 && Math.abs(convertido) < 0.000001) {
      return convertido.toExponential(3).replace(".", ",");
    }
    return formato6.format(convertido);
  }

  function fmtAcumulada(valor) {
    const convertido = numero(valor);
    if (convertido === null) return "—";
    return formato6.format(convertido);
  }

  function fmtPorcentaje(valor, decimales = 2) {
    const convertido = numero(valor);
    if (convertido === null) return "—";
    const formato = decimales >= 4 ? formatoPorcentaje4 : formatoPorcentaje;
    return `${formato.format(convertido * 100)} %`;
  }

  function formatearFecha(iso) {
    const fecha = new Date(iso);
    if (Number.isNaN(fecha.getTime())) return String(iso ?? "—");
    return formatoFecha.format(fecha);
  }

  function formatearFechaCorta(iso) {
    const fecha = new Date(iso);
    if (Number.isNaN(fecha.getTime())) return { fecha: String(iso ?? "—"), hora: "" };
    return {
      fecha: formatoFechaCorta.format(fecha).replace(".", ""),
      hora: formatoHora.format(fecha),
    };
  }

  function esModeloFinito(modelo = $("#modelo")?.value) {
    return modelo === MODELO_FINITO;
  }

  function activarTab(idBoton) {
    const boton = document.getElementById(idBoton);
    if (!boton || !window.bootstrap?.Tab) return;
    window.bootstrap.Tab.getOrCreateInstance(boton).show();
  }

  function idsCamposConfig() {
    return ["lambda", "mu", "c", "N", "nMax"];
  }

  function feedbackConfig(id) {
    return document.getElementById(
      `feedback${id.charAt(0).toUpperCase()}${id.slice(1)}`
    );
  }

  function limpiarErrorCampo(input) {
    if (!input) return;
    input.classList.remove("is-invalid");
    input.removeAttribute("aria-invalid");
    const feedback = feedbackConfig(input.id);
    if (feedback) feedback.classList.remove("d-block");
  }

  function marcarErrorCampo(campo, mensaje) {
    const input = document.getElementById(campo);
    if (!input) {
      mostrarErrorFormulario(mensaje);
      return;
    }
    input.classList.add("is-invalid");
    input.setAttribute("aria-invalid", "true");
    const feedback = feedbackConfig(campo);
    if (feedback) {
      feedback.textContent = mensaje;
      feedback.classList.add("d-block");
    }
    input.focus({ preventScroll: false });
  }

  function mostrarErrorFormulario(mensaje) {
    const alerta = $("#formError");
    alerta.textContent = mensaje;
    alerta.classList.remove("d-none");
  }

  function limpiarErroresFormulario() {
    $("#formError").classList.add("d-none");
    idsCamposConfig().forEach((id) => limpiarErrorCampo(document.getElementById(id)));
    $("#modelo").classList.remove("is-invalid");
  }

  function setBotonCargando(boton, cargando, textoCargando = "Procesando…") {
    if (!boton) return;
    if (cargando) {
      if (!boton.dataset.htmlOriginal) {
        boton.dataset.htmlOriginal = boton.innerHTML;
      }
      boton.disabled = true;
      boton.setAttribute("aria-busy", "true");
      boton.innerHTML = `
        <span class="spinner-border spinner-border-sm" aria-hidden="true"></span>
        <span>${escaparHTML(textoCargando)}</span>
      `;
    } else {
      if (boton.dataset.htmlOriginal) {
        boton.innerHTML = boton.dataset.htmlOriginal;
        delete boton.dataset.htmlOriginal;
      }
      boton.disabled = false;
      boton.removeAttribute("aria-busy");
    }
  }

  function actualizarBotonesReporte() {
    ["btnPDF"].forEach((id) => {
      const boton = document.getElementById(id);
      if (boton) boton.disabled = !state.calculo;
    });
  }

  function notificar(mensaje, tipo = "success", retardo = 4200) {
    const contenedor = $("#toastContainer");
    if (!contenedor || !window.bootstrap?.Toast) {
      console[tipo === "danger" ? "error" : "info"](mensaje);
      return;
    }
    const iconos = { success: "✓", danger: "!", warning: "!", info: "i" };
    const clases = {
      success: "text-bg-success",
      danger: "text-bg-danger",
      warning: "text-bg-warning",
      info: "text-bg-primary",
    };
    const toast = document.createElement("div");
    toast.className = `toast align-items-center border-0 ${clases[tipo] || clases.info}`;
    toast.setAttribute("role", "alert");
    toast.setAttribute("aria-live", "assertive");
    toast.setAttribute("aria-atomic", "true");
    toast.innerHTML = `
      <div class="d-flex">
        <div class="toast-body">
          <span class="toast-icon" aria-hidden="true">${iconos[tipo] || "i"}</span>
          <span class="toast-text"></span>
        </div>
        <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast" aria-label="Cerrar"></button>
      </div>
    `;
    toast.querySelector(".toast-text").textContent = mensaje;
    contenedor.appendChild(toast);
    toast.addEventListener("hidden.bs.toast", () => toast.remove(), { once: true });
    window.bootstrap.Toast.getOrCreateInstance(toast, {
      delay: tipo === "danger" ? 6000 : retardo,
    }).show();
  }

  /* ========================================================================
     Cliente HTTP
     ======================================================================== */

  async function apiFetch(ruta, opciones = {}) {
    const { method = "GET", body = null, timeout = 30000 } = opciones;
    const controlador = new AbortController();
    const temporizador = window.setTimeout(() => controlador.abort(), timeout);

    try {
      const respuesta = await fetch(`${API_BASE}${ruta}`, {
        method,
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
        signal: controlador.signal,
      });

      let datos = null;
      try {
        datos = await respuesta.json();
      } catch {
        datos = null;
      }

      if (!respuesta.ok) {
        throw new ApiError(
          datos?.error || `El servidor respondió con el código ${respuesta.status}.`,
          datos?.campo || null,
          respuesta.status
        );
      }
      if (!datos) {
        throw new ApiError("El servidor devolvió una respuesta vacía o no válida.");
      }
      return datos;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      if (error.name === "AbortError") {
        throw new ApiError("La solicitud tardó demasiado. Verifica el servidor e inténtalo de nuevo.");
      }
      throw new ApiError(
        "No se pudo conectar con el servidor. Asegúrate de que el backend Flask esté en ejecución."
      );
    } finally {
      window.clearTimeout(temporizador);
    }
  }

  /* ========================================================================
     Inicialización y eventos
     ======================================================================== */

  function iniciar() {
    configurarChartDefaults();
    actualizarModeloUI();
    configurarEventos();
    actualizarBotonesReporte();
    void cargarHistorial({ silent: true });

    const modal = document.getElementById("guiaMMC");
    modal?.addEventListener("hidden.bs.modal", () => {
      $("#btnGuiaMMC")?.focus();
    });
  }

  function paletaGraficas() {
    const oscuro = document.documentElement.dataset.tema === "oscuro";
    return {
      tick: oscuro ? "#94a3b8" : "#8491a5",
      grid: oscuro ? "#263449" : "#edf1f7",
      tooltipBg: oscuro ? "#020617" : "#0f172a",
      tooltipBorder: oscuro
        ? "rgba(148, 163, 184, 0.35)"
        : "rgba(148, 163, 184, 0.25)",
      pointBorder: oscuro ? "#0f172a" : "#ffffff",
    };
  }

  function configurarChartDefaults() {
    if (!window.Chart) return;
    const familia = getComputedStyle(document.body).fontFamily;
    window.Chart.defaults.font.family = familia;
    window.Chart.defaults.color = paletaGraficas().tick;
    window.Chart.defaults.font.size = 12;
  }

  function manejarCambioTema() {
    configurarChartDefaults();
    if (!state.calculo) return;
    destruirGraficas();
    const panel = $("#pane-distribucion");
    if (panel?.classList.contains("active")) {
      void asegurarGraficas(false);
    }
  }

  function sugerirCapacidad() {
    const inputN = $("#N");
    if (!inputN || inputN.value.trim()) return;
    const c = Number($("#c")?.value) || 3;
    inputN.value = String(Math.max(c, 10));
  }

  function configurarEventos() {
    document.addEventListener("simulab:tema", manejarCambioTema);

    $("#modelo").addEventListener("change", () => {
      limpiarErrorCampo($("#modelo"));
      actualizarModeloUI();
      if (esModeloFinito()) sugerirCapacidad();
    });

    $("#formCalculo").addEventListener("submit", manejarSubmitCalculo);
    $("#btnLimpiar").addEventListener("click", limpiarAplicacion);
    $("#btnEjemplo").addEventListener("click", cargarEjemplo);

    idsCamposConfig().forEach((id) => {
      const input = document.getElementById(id);
      input.addEventListener("input", () => limpiarErrorCampo(input));
      input.addEventListener("change", () => {
        limpiarErrorCampo(input);
        if (id === "c") {
          const c = Number(input.value);
          const inputN = $("#N");
          if (Number.isInteger(c) && c > 0) {
            inputN.min = String(c);
            if (Number(inputN.value) && Number(inputN.value) < c) {
              inputN.value = String(c);
            }
          }
        }
      });
    });

    $("#btnPDF").addEventListener("click", generarPDF);
    $("#btnIrDistribucion").addEventListener("click", () => activarTab("tab-distribucion"));

    $("#tab-distribucion").addEventListener("shown.bs.tab", () => {
      if (state.calculo) void asegurarGraficas(false);
    });

    $("#tab-historial").addEventListener("shown.bs.tab", () => {
      if (!state.historialCargado) void cargarHistorial();
    });

    $("#tipoProbabilidad").addEventListener("change", actualizarTipoProbabilidad);
    $("#formProbabilidad").addEventListener("submit", manejarSubmitProbabilidad);
    $("#btnLimpiarProbabilidad").addEventListener("click", () => {
      resetProbabilityUI({ limpiarCampos: true });
    });

    ["probK", "probA", "probB"].forEach((id) => {
      const input = document.getElementById(id);
      input.addEventListener("input", () => limpiarErrorProbabilidad(input));
    });

    $("#btnRefrescarHistorial").addEventListener("click", async () => {
      const boton = $("#btnRefrescarHistorial");
      boton.disabled = true;
      await cargarHistorial({ silent: false, offset: state.historialOffset });
      boton.disabled = false;
    });

    $("#btnHistorialAnterior").addEventListener("click", () => {
      if (state.historialCargando || state.historialOffset <= 0) return;
      void cargarHistorial({
        offset: Math.max(0, state.historialOffset - state.historialLimite),
      });
    });

    $("#btnHistorialSiguiente").addEventListener("click", () => {
      if (state.historialCargando) return;
      const siguiente = state.historialOffset + state.historialLimite;
      if (siguiente >= state.historialTotal) return;
      void cargarHistorial({ offset: siguiente });
    });

    $("#tablaHistorial").addEventListener("click", manejarAccionHistorial);
  }

  function actualizarModeloUI() {
    const finito = esModeloFinito();
    const grupoN = $("#grupoN");
    const grupoNMax = $("#grupoNMax");
    const inputN = $("#N");
    const inputNMax = $("#nMax");
    const inputC = $("#c");

    grupoN.classList.toggle("d-none", !finito);
    grupoNMax.classList.toggle("d-none", finito);
    inputN.disabled = !finito;
    inputNMax.disabled = finito;
    inputN.required = finito;
    inputNMax.required = !finito;

    const c = Number(inputC.value);
    if (finito && Number.isInteger(c) && c > 0) {
      inputN.min = String(c);
    } else {
      inputN.min = "1";
    }
  }

  /* ========================================================================
     Validación y envío del formulario
     ======================================================================== */

  function leerNumeroInput(input, etiqueta, invalido) {
    const texto = input.value.trim();
    if (!texto) {
      invalido(etiqueta + " es obligatorio.");
      return null;
    }
    const valor = Number(texto);
    if (!Number.isFinite(valor)) {
      invalido(etiqueta + " debe ser un número válido.");
      return null;
    }
    return valor;
  }

  function leerEnteroInput(input, etiqueta, minimo, maximo, invalido) {
    const texto = input.value.trim();
    if (!texto || !/^\d+$/.test(texto)) {
      invalido(etiqueta + " debe ser un entero.");
      return null;
    }
    const valor = Number(texto);
    if (!Number.isSafeInteger(valor) || valor < minimo || valor > maximo) {
      invalido(`${etiqueta} debe estar entre ${minimo} y ${maximo}.`);
      return null;
    }
    return valor;
  }

  function validarFormulario() {
    limpiarErroresFormulario();
    const modelo = $("#modelo").value;
    const finito = modelo === MODELO_FINITO;
    let primerCampo = null;
    let valido = true;

    const marcar = (campo, mensaje) => {
      valido = false;
      if (!primerCampo) primerCampo = campo;
      marcarErrorCampo(campo, mensaje);
    };

    const lambda = leerNumeroInput($("#lambda"), "λ (lambda)", (mensaje) =>
      marcar("lambda", mensaje)
    );
    if (lambda !== null) {
      if (lambda <= 0) marcar("lambda", "λ (lambda) debe ser mayor que 0.");
      else if (lambda > MAX_TASA) marcar("lambda", "λ (lambda) debe ser menor o igual a 1,000,000,000.");
    }

    const mu = leerNumeroInput($("#mu"), "μ (mu)", (mensaje) => marcar("mu", mensaje));
    if (mu !== null) {
      if (mu <= 0) marcar("mu", "μ (mu) debe ser mayor que 0.");
      else if (mu > MAX_TASA) marcar("mu", "μ (mu) debe ser menor o igual a 1,000,000,000.");
    }

    const c = leerEnteroInput($("#c"), "c (servidores)", 1, MAX_C, (mensaje) =>
      marcar("c", mensaje)
    );

    let N = null;
    let nMax = null;

    if (finito) {
      N = leerEnteroInput($("#N"), "N (capacidad)", c || 1, MAX_N, (mensaje) =>
        marcar("N", mensaje)
      );
      if (c !== null && N !== null && N < c) {
        marcar("N", `N debe ser mayor o igual que c (${c}).`);
      }
    } else {
      nMax = leerEnteroInput($("#nMax"), "nMax (corte)", 1, MAX_NMAX, (mensaje) =>
        marcar("nMax", mensaje)
      );
      if (lambda !== null && mu !== null && c !== null && mu > 0 && c > 0) {
        const factor = lambda / (c * mu);
        if (factor >= 1) {
          marcar(
            "c",
            `El modelo sin límite requiere λ < c·μ (ρ/c < 1). Con estos valores ρ/c = ${fmtNumero(factor)}.`
          );
        }
      }
    }

    if (!valido) {
      if (primerCampo) document.getElementById(primerCampo)?.focus();
      return null;
    }

    return {
      modelo,
      lambda,
      mu,
      c,
      N: finito ? N : null,
      nMax: finito ? null : nMax,
    };
  }

  async function manejarSubmitCalculo(evento) {
    evento.preventDefault();
    const payload = validarFormulario();
    if (!payload) return;

    const boton = $("#btnCalcular");
    setBotonCargando(boton, true, "Calculando…");
    try {
      const respuesta = await apiFetch("/api/calcular", {
        method: "POST",
        body: payload,
      });
      aplicarCalculo(respuesta.calculo);
      activarTab("tab-resultados");
      state.historialCargado = false;
      notificar("Cálculo M/M/c realizado y guardado correctamente.", "success");
      void cargarHistorial({ silent: true, offset: 0 });
    } catch (error) {
      const mensaje = error.message || "No se pudo realizar el cálculo.";
      if (error instanceof ApiError && error.campo) {
        if (["lambda", "mu", "c", "N", "nMax", "modelo"].includes(error.campo)) {
          marcarErrorCampo(error.campo, mensaje);
        }
      }
      mostrarErrorFormulario(mensaje);
      notificar(mensaje, "danger");
    } finally {
      setBotonCargando(boton, false);
    }
  }

  function cargarEjemplo() {
    $("#modelo").value = "mmc_infinito";
    $("#lambda").value = "18";
    $("#mu").value = "10";
    $("#c").value = "3";
    $("#N").value = "";
    $("#nMax").value = "50";
    limpiarErroresFormulario();
    actualizarModeloUI();
    notificar("Ejemplo cargado. Presiona Calcular para resolverlo.", "info");
    $("#lambda").focus();
  }

  function limpiarAplicacion() {
    $("#formCalculo").reset();
    $("#N").value = "";
    $("#nMax").value = "50";
    limpiarErroresFormulario();
    actualizarModeloUI();

    state.calculo = null;
    state.probabilidad = null;
    destruirGraficas();
    actualizarBotonesReporte();
    document.body.classList.remove("con-calculo");

    $("#estadoVacio").classList.remove("d-none");
    $("#resultadosContenido").classList.add("d-none");
    $("#distribucionVacia").classList.remove("d-none");
    $("#distribucionContenido").classList.add("d-none");
    $("#probabilidadNoDisponible").classList.remove("d-none");
    $("#probabilidadCalculadora").classList.add("d-none");
    $("#tablaResultados").innerHTML = "";
    $("#tablaDistribucion").innerHTML = "";
    $("#interpretacion").innerHTML = "";
    $("#advertenciasResultado").innerHTML = "";
    $("#contextoProbabilidad").textContent = "Cálculo vigente";
    $("#printModelo").textContent = "—";
    $("#printFecha").textContent = "";
    resetProbabilityUI({ limpiarCampos: true });
    activarTab("tab-resultados");
    notificar("Formulario y resultados limpiados.", "info");
  }

  /* ========================================================================
     Render de resultados
     ======================================================================== */

  function aplicarCalculo(calculo) {
    if (!calculo) return;
    state.calculo = calculo;
    state.probabilidad = null;
    state.chartsDirty = true;
    destruirGraficas();

    document.body.classList.add("con-calculo");
    $("#estadoVacio").classList.add("d-none");
    $("#resultadosContenido").classList.remove("d-none");
    $("#distribucionVacia").classList.add("d-none");
    $("#distribucionContenido").classList.remove("d-none");

    renderResultados(calculo);
    renderDistribucion(calculo);
    configurarProbabilidad(calculo);
    actualizarBotonesReporte();
  }

  function lecturasSistemaMMC(calculo) {
    const parametros = calculo.parametros || {};
    const resultados = calculo.resultados || {};
    const finito = calculo.modelo === MODELO_FINITO;
    const utilizacion = Number(resultados.utilizacion ?? 0);

    const items = [
      {
        html: `En promedio hay <strong>${fmtNumero(resultados.Ls)}</strong> clientes en el sistema y <strong>${fmtNumero(resultados.Lq)}</strong> esperando en cola.`,
        texto: `En promedio hay ${fmtNumero(resultados.Ls)} clientes en el sistema y ${fmtNumero(resultados.Lq)} esperando en cola.`,
      },
      {
        html: `Un cliente permanece <strong>${fmtNumero(resultados.Ws)}</strong> unidades de tiempo en el sistema; de ellas, <strong>${fmtNumero(resultados.Wq)}</strong> corresponden a la espera.`,
        texto: `Un cliente permanece ${fmtNumero(resultados.Ws)} unidades de tiempo en el sistema; de ellas, ${fmtNumero(resultados.Wq)} corresponden a la espera.`,
      },
      {
        html: `De los <strong>${escaparHTML(parametros.c)}</strong> servidores, en promedio <strong>${fmtNumero(resultados.servidores_activos)}</strong> están ocupados y <strong>${fmtNumero(resultados.servidores_inactivos)}</strong> libres. La utilización media es <strong>${fmtPorcentaje(utilizacion)}</strong>.`,
        texto: `De los ${parametros.c} servidores, en promedio ${fmtNumero(resultados.servidores_activos)} están ocupados y ${fmtNumero(resultados.servidores_inactivos)} libres. La utilización media es ${fmtPorcentaje(utilizacion)}.`,
      },
    ];

    if (finito) {
      items.push(
        {
          html: `La capacidad es <strong>N = ${escaparHTML(parametros.N)}</strong>; la probabilidad de encontrar el sistema lleno es <strong>${fmtNumero(resultados.pN)}</strong> (${fmtPorcentaje(resultados.pN)}).`,
          texto: `La capacidad es N = ${parametros.N}; la probabilidad de encontrar el sistema lleno es ${fmtNumero(resultados.pN)} (${fmtPorcentaje(resultados.pN)}).`,
        },
        {
          html: `Ingresan <strong>${fmtNumero(resultados.lambda_efectiva)}</strong> clientes por unidad de tiempo y se rechazan <strong>${fmtNumero(resultados.lambda_perdida)}</strong>.`,
          texto: `Ingresan ${fmtNumero(resultados.lambda_efectiva)} clientes por unidad de tiempo y se rechazan ${fmtNumero(resultados.lambda_perdida)}.`,
        }
      );
    } else {
      items.push({
        html: `La cola es ilimitada y el sistema es estable porque <strong>ρ/c = ${fmtNumero(resultados.rho_c)} &lt; 1</strong>.`,
        texto: `La cola es ilimitada y el sistema es estable porque ρ/c = ${fmtNumero(resultados.rho_c)} < 1.`,
      });
    }

    return items;
  }

  function renderResultados(calculo) {
    const parametros = calculo.parametros || {};
    const resultados = calculo.resultados || {};

    $("#calculoId").textContent = `Cálculo #${calculo.id ?? "—"}`;
    $("#calculoFecha").textContent = formatearFecha(calculo.timestamp);
    $("#badgeModelo").textContent = calculo.modelo_etiqueta || "M/M/c";
    $("#kpiRho").textContent = fmtNumero(resultados.rho);
    $("#kpiP0").textContent = fmtNumero(resultados.p0);
    $("#kpiLs").textContent = fmtNumero(resultados.Ls);
    $("#kpiLq").textContent = fmtNumero(resultados.Lq);
    $("#kpiWs").textContent = fmtNumero(resultados.Ws);
    $("#kpiWq").textContent = fmtNumero(resultados.Wq);
    $("#kpiActivos").textContent = fmtNumero(resultados.servidores_activos);
    $("#kpiInactivos").textContent = fmtNumero(resultados.servidores_inactivos);

    const finito = calculo.modelo === MODELO_FINITO;
    const extras = $("#metricasFinitas");
    if (finito) {
      extras.classList.remove("d-none");
      $("#kpiLambdaEf").textContent = fmtNumero(resultados.lambda_efectiva);
      $("#kpiLambdaPerdida").textContent = fmtNumero(resultados.lambda_perdida);
      $("#kpiPN").textContent = fmtNumero(resultados.pN);
      $("#kpiUtilizacion").textContent = fmtNumero(resultados.utilizacion);
    } else {
      extras.classList.add("d-none");
    }

    const contenedorAdvertencias = $("#advertenciasResultado");
    contenedorAdvertencias.innerHTML = "";
    (calculo.advertencias || []).forEach((advertencia) => {
      const alerta = document.createElement("div");
      alerta.className = "alert alert-warning mb-2";
      alerta.setAttribute("role", "status");
      alerta.textContent = advertencia;
      contenedorAdvertencias.appendChild(alerta);
    });

    const filas = [
      ["Servidores en paralelo", "c", parametros.c],
      ["Intensidad de tráfico", "ρ = λ/μ", resultados.rho],
      ["Factor de utilización", "ρ/c", resultados.rho_c],
      ["Probabilidad de sistema vacío", "P₀", resultados.p0],
      ["Número promedio en el sistema", "Lₛ", resultados.Ls],
      ["Número promedio en cola", "Lq", resultados.Lq],
      ["Tiempo promedio en el sistema", "Wₛ", resultados.Ws],
      ["Tiempo promedio en cola", "Wq", resultados.Wq],
      ["Servidores inactivos promedio", "cᵢ", resultados.servidores_inactivos],
      ["Servidores activos promedio", "cₐ", resultados.servidores_activos],
      ["Utilización real de los servidores", "(c − cᵢ)/c", resultados.utilizacion],
    ];

    if (finito) {
      filas.push(
        ["Tasa efectiva de llegada", "λ efectiva", resultados.lambda_efectiva],
        ["Tasa de llegada rechazada", "λ perdida", resultados.lambda_perdida],
        ["Probabilidad de bloqueo", "pN", resultados.pN]
      );
    }

    $("#tablaResultados").innerHTML = filas
      .map(
        ([nombre, simbolo, valor]) => `
          <tr>
            <td class="metric-name">${escaparHTML(nombre)}</td>
            <td class="metric-symbol-cell">${escaparHTML(simbolo)}</td>
            <td class="text-end value-cell">${fmtNumero(valor)}</td>
          </tr>
        `
      )
      .join("");

    $("#interpretacion").innerHTML = lecturasSistemaMMC(calculo)
      .map((item) => `<li>${item.html}</li>`)
      .join("");

    $("#printModelo").textContent = calculo.modelo_etiqueta || "M/M/c";
    $("#printFecha").textContent = formatearFecha(calculo.timestamp);
  }

  function renderDistribucion(calculo) {
    const distribucion = calculo.distribucion || [];
    $("#distTablaConteo").textContent = `${distribucion.length} ${
      distribucion.length === 1 ? "fila" : "filas"
    }`;

    const ultima = distribucion[distribucion.length - 1];

    const fragmento = document.createDocumentFragment();
    distribucion.forEach((fila) => {
      const tr = document.createElement("tr");
      const n = Number(fila.n);
      const p = Number(fila.p);

      const tdN = document.createElement("td");
      tdN.textContent = String(n);

      const tdP = document.createElement("td");
      tdP.className = "text-end p-value";
      tdP.textContent = fmtNumero(p);

      const tdAcumulada = document.createElement("td");
      tdAcumulada.className = "text-end";
      tdAcumulada.textContent = fmtAcumulada(fila.acumulada);

      const tdSignificado = document.createElement("td");
      tdSignificado.className = "row-meaning d-none d-sm-table-cell";
      tdSignificado.textContent = significadoFila(n, p);

      tr.append(tdN, tdP, tdAcumulada, tdSignificado);
      fragmento.appendChild(tr);
    });
    $("#tablaDistribucion").replaceChildren(fragmento);

    const notas = [];
    if (distribucion.length > MAX_PUNTOS_GRAFICA) {
      notas.push(
        `La tabla contiene ${distribucion.length} filas; las gráficas muestran una muestra representativa de ${MAX_PUNTOS_GRAFICA} puntos.`
      );
    }
    const limiteTabla = calculo.modelo === MODELO_FINITO
      ? Number(calculo.parametros?.N)
      : Number(calculo.parametros?.nMax);
    if (
      calculo.modelo !== MODELO_FINITO &&
      ultima &&
      Number.isFinite(limiteTabla) &&
      Number(ultima.n) < limiteTabla
    ) {
      notas.push(
        `La tabla se detuvo en n = ${ultima.n} porque la acumulada es ${fmtAcumulada(ultima.acumulada)}, prácticamente 1.`
      );
    }
    const notaDistribucion = $("#distNota");
    notaDistribucion.textContent = notas.join(" ");
    notaDistribucion.classList.toggle("d-none", notas.length === 0);

    state.chartsDirty = true;
    destruirGraficas();
    if ($("#pane-distribucion").classList.contains("active")) {
      void asegurarGraficas(false);
    }
  }

  function significadoFila(n, p) {
    if (n === 0) return "Sistema vacío";
    if (!Number.isFinite(p) || p < 0.0000005) return "Probabilidad despreciable";
    if (n === 1) return "Un cliente en el sistema";
    return `${n} clientes en el sistema`;
  }

  /* ========================================================================
     Gráficas con Chart.js
     ======================================================================== */

  function muestrearDistribucion(distribucion, maximo = MAX_PUNTOS_GRAFICA) {
    if (distribucion.length <= maximo) return distribucion.slice();
    const resultado = [distribucion[0]];
    const paso = (distribucion.length - 1) / (maximo - 1);
    for (let i = 1; i < maximo - 1; i += 1) {
      const indice = Math.round(i * paso);
      if (indice > 0 && indice < distribucion.length - 1) {
        resultado.push(distribucion[indice]);
      }
    }
    resultado.push(distribucion[distribucion.length - 1]);
    return resultado;
  }

  function destruirGraficas() {
    if (state.charts.absoluta) {
      state.charts.absoluta.destroy();
      state.charts.absoluta = null;
    }
    if (state.charts.acumulada) {
      state.charts.acumulada.destroy();
      state.charts.acumulada = null;
    }
    state.chartsDirty = true;
  }

  function opcionesTooltip(etiqueta, formateador = fmtNumero) {
    const paleta = paletaGraficas();
    return {
      backgroundColor: paleta.tooltipBg,
      titleColor: "#f8fafc",
      bodyColor: "#cbd5e1",
      borderColor: paleta.tooltipBorder,
      borderWidth: 1,
      padding: 10,
      cornerRadius: 8,
      displayColors: false,
      titleFont: { size: 12, weight: "600" },
      bodyFont: { size: 12 },
      callbacks: {
        title: (items) => `n = ${items[0]?.label ?? ""}`,
        label: (context) => `${etiqueta} = ${formateador(context.parsed.y)}`,
      },
    };
  }

  function opcionesEjeX() {
    return {
      grid: { display: false },
      border: { display: false },
      ticks: {
        color: paletaGraficas().tick,
        maxRotation: 0,
        autoSkip: true,
        maxTicksLimit: 12,
        font: { size: 11 },
      },
    };
  }

  function opcionesEjeY(esAcumulada) {
    return {
      beginAtZero: true,
      suggestedMax: esAcumulada ? 1 : undefined,
      max: esAcumulada ? 1 : undefined,
      grid: { color: paletaGraficas().grid, drawTicks: false },
      border: { display: false },
      ticks: {
        color: paletaGraficas().tick,
        padding: 7,
        font: { size: 11 },
        maxTicksLimit: 6,
        callback: (valor) => {
          const numeroValor = Number(valor);
          if (esAcumulada) return fmtAcumulada(numeroValor);
          return new Intl.NumberFormat("es-MX", {
            maximumFractionDigits: 2,
          }).format(numeroValor);
        },
      },
    };
  }

  function renderGraficas() {
    if (!state.calculo) return false;
    if (!window.Chart) {
      notificar("Chart.js no está disponible; no se pudieron dibujar las gráficas.", "danger");
      return false;
    }

    const distribucionOriginal = state.calculo.distribucion || [];
    if (!distribucionOriginal.length) return false;

    destruirGraficas();
    const distribucion = muestrearDistribucion(distribucionOriginal);
    const etiquetas = distribucion.map((fila) => String(fila.n));
    const valores = distribucion.map((fila) => Number(fila.p));
    const acumuladas = distribucion.map((fila) => Number(fila.acumulada));
    const maximoP = Math.max(...valores.filter(Number.isFinite), 0.01);

    const canvasAbsoluta = $("#graficaAbsoluta");
    const canvasAcumulada = $("#graficaAcumulada");
    if (!canvasAbsoluta || !canvasAcumulada) return false;

    const contextoAbsoluta = canvasAbsoluta.getContext("2d");
    const gradienteAbsoluta = contextoAbsoluta.createLinearGradient(0, 0, 0, 290);
    gradienteAbsoluta.addColorStop(0, "rgba(79, 70, 229, 0.88)");
    gradienteAbsoluta.addColorStop(1, "rgba(79, 70, 229, 0.32)");

    const contextoAcumulada = canvasAcumulada.getContext("2d");
    const gradienteAcumulada = contextoAcumulada.createLinearGradient(0, 0, 0, 290);
    gradienteAcumulada.addColorStop(0, "rgba(8, 145, 178, 0.24)");
    gradienteAcumulada.addColorStop(1, "rgba(8, 145, 178, 0.01)");

    try {
      state.charts.absoluta = new window.Chart(canvasAbsoluta, {
        type: "bar",
        data: {
          labels: etiquetas,
          datasets: [
            {
              data: valores,
              backgroundColor: gradienteAbsoluta,
              hoverBackgroundColor: "#4338ca",
              borderWidth: 0,
              borderRadius: 4,
              maxBarThickness: 34,
              categoryPercentage: distribucion.length > 70 ? 1 : 0.86,
              barPercentage: distribucion.length > 70 ? 1 : 0.9,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: { duration: 320 },
          interaction: { mode: "index", intersect: false },
          plugins: {
            legend: { display: false },
            tooltip: opcionesTooltip("p(n)"),
          },
          scales: {
            x: opcionesEjeX(),
            y: {
              ...opcionesEjeY(false),
              suggestedMax: Math.min(1, Math.max(0.08, maximoP * 1.18)),
            },
          },
        },
      });

      state.charts.acumulada = new window.Chart(canvasAcumulada, {
        type: "line",
        data: {
          labels: etiquetas,
          datasets: [
            {
              data: acumuladas,
              borderColor: "#0891b2",
              backgroundColor: gradienteAcumulada,
              borderWidth: 2.2,
              fill: true,
              tension: 0.28,
              pointRadius: distribucion.length > 70 ? 0 : 2.2,
              pointHoverRadius: 4,
              pointBackgroundColor: "#0891b2",
              pointBorderColor: paletaGraficas().pointBorder,
              pointBorderWidth: 1.5,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: { duration: 320 },
          interaction: { mode: "index", intersect: false },
          plugins: {
            legend: { display: false },
            tooltip: opcionesTooltip("P(X ≤ n)", fmtAcumulada),
          },
          scales: {
            x: opcionesEjeX(),
            y: opcionesEjeY(true),
          },
        },
      });

      state.chartsDirty = false;
      return true;
    } catch (error) {
      console.error("Error al dibujar gráficas:", error);
      notificar("No se pudieron dibujar las gráficas.", "danger");
      destruirGraficas();
      return false;
    }
  }

  async function asegurarGraficas(forzar = false) {
    if (!state.calculo) return false;
    const panel = $("#pane-distribucion");
    const visible = panel.classList.contains("active");

    if (!visible) {
      if (!forzar) return false;
      activarTab("tab-distribucion");
      await esperar(100);
    }

    if (state.chartsDirty || !state.charts.absoluta || !state.charts.acumulada) {
      const dibujadas = renderGraficas();
      if (!dibujadas) return false;
    }

    await esperar(380);
    state.charts.absoluta?.resize();
    state.charts.acumulada?.resize();
    await esperar(90);
    return true;
  }

  function obtenerImagenesGraficas() {
    if (!state.charts.absoluta || !state.charts.acumulada) {
      throw new Error("No se pudieron preparar las gráficas del reporte.");
    }
    return {
      absoluta: state.charts.absoluta.toBase64Image("image/png", 1),
      acumulada: state.charts.acumulada.toBase64Image("image/png", 1),
    };
  }

  async function obtenerGraficasParaReporte() {
    const pestanaActiva = $("#mainTabs .nav-link.active");
    const idActiva = pestanaActiva?.id || "tab-resultados";
    const listo = await asegurarGraficas(true);
    if (!listo) throw new Error("No se pudieron preparar las gráficas del reporte.");
    const imagenes = obtenerImagenesGraficas();
    if (idActiva !== "tab-distribucion") activarTab(idActiva);
    return imagenes;
  }

  /* ========================================================================
     Calculadora de probabilidades
     ======================================================================== */

  function configurarProbabilidad(calculo) {
    $("#probabilidadNoDisponible").classList.add("d-none");
    $("#probabilidadCalculadora").classList.remove("d-none");

    const parametros = calculo.parametros || {};
    const finito = calculo.modelo === MODELO_FINITO;
    const maximo = finito ? Number(parametros.N) : MAX_INDICE_PROBABILIDAD;
    const contexto = [
      calculo.modelo_etiqueta,
      `λ = ${fmtNumero(parametros.lambda)}`,
      `μ = ${fmtNumero(parametros.mu)}`,
      `c = ${parametros.c}`,
      finito ? `N = ${parametros.N}` : "cola ilimitada",
    ].join(" · ");
    $("#contextoProbabilidad").textContent = `Cálculo #${calculo.id} · ${contexto}`;

    ["probK", "probA", "probB"].forEach((id) => {
      document.getElementById(id).max = String(maximo);
    });

    resetProbabilityUI({ limpiarCampos: true });
  }

  function resetProbabilityUI({ limpiarCampos = false } = {}) {
    state.probabilidad = null;
    $("#probabilidadVacia").classList.remove("d-none");
    $("#probabilidadResultado").classList.add("d-none");
    $("#probabilidadError").classList.add("d-none");
    $("#probFormula").textContent = "";
    $("#probDescripcion").textContent = "";
    $("#probValor").textContent = "";
    $("#probPorcentaje").textContent = "";
    $("#probDetalle").textContent = "";
    ["probK", "probA", "probB"].forEach((id) => limpiarErrorProbabilidad(document.getElementById(id)));

    if (limpiarCampos) {
      $("#formProbabilidad").reset();
      actualizarTipoProbabilidad();
      $("#probabilidadError").classList.add("d-none");
    }
  }

  function actualizarTipoProbabilidad() {
    const rango = $("#tipoProbabilidad").value === "rango";
    $("#grupoK").classList.toggle("d-none", rango);
    $("#grupoRango").classList.toggle("d-none", !rango);
    $("#probK").required = !rango;
    $("#probA").required = rango;
    $("#probB").required = rango;
    ["probK", "probA", "probB"].forEach((id) =>
      limpiarErrorProbabilidad(document.getElementById(id))
    );
    $("#probabilidadError").classList.add("d-none");
  }

  function feedbackProbabilidad(input) {
    return document.getElementById(
      `feedbackProb${input.id.slice(4).toUpperCase()}`
    );
  }

  function limpiarErrorProbabilidad(input) {
    if (!input) return;
    input.classList.remove("is-invalid");
    input.removeAttribute("aria-invalid");
    const feedback = feedbackProbabilidad(input);
    if (feedback) feedback.classList.remove("d-block");
  }

  function marcarErrorProbabilidad(campo, mensaje) {
    const input = document.getElementById(`prob${campo.toUpperCase()}`);
    if (!input) return;
    input.classList.add("is-invalid");
    input.setAttribute("aria-invalid", "true");
    const feedback = feedbackProbabilidad(input);
    if (feedback) {
      feedback.textContent = mensaje;
      feedback.classList.add("d-block");
    }
    input.focus();
  }

  function leerEnteroProbabilidad(input, etiqueta, maximo) {
    const texto = input.value.trim();
    if (!texto || !/^\d+$/.test(texto)) {
      return { error: `${etiqueta} debe ser un entero mayor o igual que 0.` };
    }
    const valor = Number(texto);
    if (!Number.isSafeInteger(valor) || valor < 0 || valor > maximo) {
      return { error: `${etiqueta} debe estar entre 0 y ${maximo}.` };
    }
    return { valor };
  }

  async function manejarSubmitProbabilidad(evento) {
    evento.preventDefault();
    if (!state.calculo) {
      notificar("Primero calcula un modelo.", "warning");
      return;
    }

    ["probK", "probA", "probB"].forEach((id) =>
      limpiarErrorProbabilidad(document.getElementById(id))
    );
    $("#probabilidadError").classList.add("d-none");

    const calculo = state.calculo;
    const parametros = calculo.parametros || {};
    const finito = calculo.modelo === MODELO_FINITO;
    const maximo = finito ? Number(parametros.N) : MAX_INDICE_PROBABILIDAD;
    const tipo = $("#tipoProbabilidad").value;
    const payload = {
      modelo: calculo.modelo,
      lambda: parametros.lambda,
      mu: parametros.mu,
      c: parametros.c,
      N: parametros.N,
      tipo,
    };

    let valido = true;
    if (tipo === "rango") {
      const resultadoA = leerEnteroProbabilidad($("#probA"), "a", maximo);
      const resultadoB = leerEnteroProbabilidad($("#probB"), "b", maximo);
      if (resultadoA.error) {
        marcarErrorProbabilidad("A", resultadoA.error);
        valido = false;
      }
      if (resultadoB.error) {
        marcarErrorProbabilidad("B", resultadoB.error);
        valido = false;
      }
      if (valido && resultadoA.valor > resultadoB.valor) {
        marcarErrorProbabilidad("A", "El límite a debe ser menor o igual que b.");
        valido = false;
      }
      if (!valido) return;
      payload.a = resultadoA.valor;
      payload.b = resultadoB.valor;
    } else {
      const resultadoK = leerEnteroProbabilidad($("#probK"), "k", maximo);
      if (resultadoK.error) {
        marcarErrorProbabilidad("K", resultadoK.error);
        return;
      }
      payload.k = resultadoK.valor;
    }

    const boton = $("#btnCalcularProbabilidad");
    setBotonCargando(boton, true, "Calculando…");
    try {
      const respuesta = await apiFetch("/api/probabilidad", {
        method: "POST",
        body: payload,
      });
      mostrarResultadoProbabilidad(respuesta);
    } catch (error) {
      const mensaje = error.message || "No se pudo calcular la probabilidad.";
      if (error instanceof ApiError && error.campo) {
        const campo = String(error.campo).toUpperCase();
        if (["K", "A", "B"].includes(campo)) {
          marcarErrorProbabilidad(campo, mensaje);
        }
      }
      const alerta = $("#probabilidadError");
      alerta.textContent = mensaje;
      alerta.classList.remove("d-none");
      notificar(mensaje, "danger");
    } finally {
      setBotonCargando(boton, false);
    }
  }

  function mostrarResultadoProbabilidad(resultado) {
    state.probabilidad = resultado;
    $("#probabilidadVacia").classList.add("d-none");
    $("#probabilidadResultado").classList.remove("d-none");
    $("#probabilidadError").classList.add("d-none");

    $("#probDescripcion").textContent = resultado.descripcion;
    $("#probValor").textContent = fmtNumero(resultado.probabilidad);
    $("#probPorcentaje").textContent = fmtPorcentaje(resultado.probabilidad, 4);
    $("#probFormula").textContent = formulaProbabilidad(state.calculo, resultado);
    const parametros = state.calculo?.parametros || {};
    $("#probDetalle").textContent = `Cálculo #${state.calculo?.id ?? "—"} · λ = ${fmtNumero(
      parametros.lambda
    )} · μ = ${fmtNumero(parametros.mu)} · c = ${parametros.c}${
      state.calculo?.modelo === MODELO_FINITO ? ` · N = ${parametros.N}` : ""
    }. Las unidades de tiempo corresponden a λ y μ.`;
  }

  function formulaProbabilidad(calculo, resultado) {
    if (!calculo) return "";
    const tipo = resultado.tipo;
    const entradas = resultado.entradas || {};
    const rho = fmtNumero(calculo.resultados?.rho);
    const factor = fmtNumero(calculo.resultados?.rho_c);
    const finito = calculo.modelo === MODELO_FINITO;

    if (tipo === "menor_igual") {
      return finito
        ? `P(X ≤ ${entradas.k}) = Σ p(n), n = 0…${entradas.k} · p(n) usa ρ = ${rho} y c = ${calculo.parametros.c}`
        : `P(X ≤ ${entradas.k}) = Σ p(n), n = 0…${entradas.k} · para n ≥ c, p(n) = p(c)·(${factor})^(n−c)`;
    }
    if (tipo === "mayor_igual") {
      return finito
        ? `P(X ≥ ${entradas.k}) = Σ p(n), n = ${entradas.k}…${calculo.parametros.N}`
        : `P(X ≥ ${entradas.k}) = Σ p(n), n = ${entradas.k}…∞ · cola geométrica de razón ρ/c = ${factor}`;
    }
    return `P(${entradas.a} ≤ X ≤ ${entradas.b}) = Σ p(n), n = ${entradas.a}…${entradas.b}`;
  }

  /* ========================================================================
     Historial
     ======================================================================== */

  async function cargarHistorial({ silent = false, offset = state.historialOffset } = {}) {
    if (state.historialCargando) {
      state.historialPendiente = { silent, offset };
      return;
    }
    state.historialCargando = true;

    const cargando = $("#historialCargando");
    if (!silent) {
      cargando.classList.remove("d-none");
      $("#historialVacio").classList.add("d-none");
      $("#historialTablaWrap").classList.add("d-none");
      $("#historialPaginacion").classList.add("d-none");
    }

    try {
      let objetivo = Math.max(0, Number(offset) || 0);
      if (state.historialTotal > 0 && objetivo >= state.historialTotal) {
        objetivo = Math.max(
          0,
          (Math.ceil(state.historialTotal / state.historialLimite) - 1) *
            state.historialLimite
        );
      }
      let respuesta = await apiFetch(
        `/api/historial?modulo=${MODULO_HISTORIAL}&limite=${state.historialLimite}&offset=${objetivo}`
      );
      const total = Number(respuesta.total) || 0;
      if (total > 0 && objetivo >= total) {
        objetivo = Math.max(
          0,
          (Math.ceil(total / state.historialLimite) - 1) * state.historialLimite
        );
        respuesta = await apiFetch(
          `/api/historial?modulo=${MODULO_HISTORIAL}&limite=${state.historialLimite}&offset=${objetivo}`
        );
      }
      state.historialOffset = objetivo;
      renderHistorial(respuesta);
      state.historialCargado = true;
    } catch (error) {
      if (!silent) {
        notificar(error.message || "No se pudo cargar el historial.", "danger");
      }
    } finally {
      state.historialCargando = false;
      cargando.classList.add("d-none");
      const pendiente = state.historialPendiente;
      state.historialPendiente = null;
      if (pendiente) void cargarHistorial(pendiente);
    }
  }

  function renderHistorial(respuesta) {
    const calculos = respuesta.calculos || [];
    const total = Number(respuesta.total) || 0;
    const limite = Number(respuesta.limite) || state.historialLimite;
    const offset = Number(respuesta.offset) || 0;
    state.historialTotal = total;
    state.historialOffset = offset;

    $("#historialCount").textContent = String(total);
    $("#historialInfo").textContent = total
      ? `${total} ${total === 1 ? "cálculo M/M/c guardado" : "cálculos M/M/c guardados"} en la base de datos.`
      : "Los resultados M/M/c se guardan automáticamente en SQLite.";

    const vacio = $("#historialVacio");
    const tabla = $("#historialTablaWrap");
    const paginacion = $("#historialPaginacion");

    if (!calculos.length) {
      vacio.classList.remove("d-none");
      tabla.classList.add("d-none");
      paginacion.classList.add("d-none");
      $("#historialPie").textContent = "";
      $("#tablaHistorial").innerHTML = "";
      return;
    }

    vacio.classList.add("d-none");
    tabla.classList.remove("d-none");

    $("#tablaHistorial").innerHTML = calculos
      .map((calculo) => {
        const fecha = formatearFechaCorta(calculo.timestamp);
        const parametros = calculo.parametros || {};
        const resultados = calculo.resultados || {};
        const finito = calculo.modelo === MODELO_FINITO;
        return `
          <tr>
            <td class="history-date">
              <strong>${escaparHTML(fecha.fecha)}</strong>
              <small>${escaparHTML(fecha.hora)} · #${calculo.id}</small>
            </td>
            <td>
              <span class="history-model">${escaparHTML(
                finito ? "M/M/c finito" : "M/M/c infinito"
              )}</span>
            </td>
            <td class="text-end">${fmtNumero(parametros.lambda)}</td>
            <td class="text-end">${fmtNumero(parametros.mu)}</td>
            <td class="text-end">${escaparHTML(parametros.c)}</td>
            <td class="text-end">${finito ? escaparHTML(parametros.N) : "—"}</td>
            <td class="text-end">${fmtNumero(resultados.rho)}</td>
            <td class="text-end">${fmtNumero(resultados.Lq)}</td>
            <td>
              <div class="history-actions">
                <button type="button" class="btn-table-action" data-accion="ver" data-id="${calculo.id}" title="Abrir cálculo" aria-label="Abrir cálculo #${calculo.id}">
                  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="2.6" stroke="currentColor" stroke-width="2"/></svg>
                </button>
                <button type="button" class="btn-table-action danger" data-accion="eliminar" data-id="${calculo.id}" title="Eliminar cálculo" aria-label="Eliminar cálculo #${calculo.id}">
                  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
                </button>
              </div>
            </td>
          </tr>
        `;
      })
      .join("");

    const paginas = Math.max(1, Math.ceil(total / limite));
    const paginaActual = Math.floor(offset / limite) + 1;
    $("#historialPagina").textContent = `Página ${paginaActual} de ${paginas}`;
    $("#btnHistorialAnterior").disabled = offset <= 0;
    $("#btnHistorialSiguiente").disabled = offset + calculos.length >= total;
    paginacion.classList.toggle("d-none", paginas <= 1);
    $("#historialPie").textContent = `Mostrando ${offset + 1}–${
      offset + calculos.length
    } de ${total} ${total === 1 ? "cálculo" : "cálculos"}.`;
  }

  async function manejarAccionHistorial(evento) {
    const boton = evento.target.closest("[data-accion]");
    if (!boton) return;
    const id = Number(boton.dataset.id);
    if (!Number.isInteger(id)) return;

    if (boton.dataset.accion === "ver") {
      await abrirCalculoHistorial(id);
    } else if (boton.dataset.accion === "eliminar") {
      await eliminarCalculoHistorial(id);
    }
  }

  async function abrirCalculoHistorial(id) {
    try {
      const respuesta = await apiFetch(
        `/api/calculo/${id}?modulo=${MODULO_HISTORIAL}`
      );
      const calculo = respuesta.calculo;
      sincronizarFormulario(calculo);
      aplicarCalculo(calculo);
      activarTab("tab-resultados");
      notificar(`Cálculo #${id} cargado desde el historial.`, "success");
    } catch (error) {
      notificar(error.message || "No se pudo abrir el cálculo.", "danger");
    }
  }

  function sincronizarFormulario(calculo) {
    const parametros = calculo.parametros || {};
    $("#modelo").value = calculo.modelo;
    $("#lambda").value = parametros.lambda ?? "";
    $("#mu").value = parametros.mu ?? "";
    $("#c").value = parametros.c ?? "";
    $("#N").value = parametros.N ?? "";
    $("#nMax").value = parametros.nMax ?? 50;
    actualizarModeloUI();
    limpiarErroresFormulario();
  }

  async function eliminarCalculoHistorial(id) {
    const confirmado = window.confirm(
      `¿Eliminar el cálculo M/M/c #${id} del historial? Esta acción no se puede deshacer.`
    );
    if (!confirmado) return;

    try {
      await apiFetch(`/api/calculo/${id}?modulo=${MODULO_HISTORIAL}`, {
        method: "DELETE",
      });
      notificar(`Cálculo #${id} eliminado.`, "success");
      state.historialCargado = false;
      await cargarHistorial({ silent: true });
    } catch (error) {
      notificar(error.message || "No se pudo eliminar el cálculo.", "danger");
    }
  }

  /* ========================================================================
     Generación de PDF
     ======================================================================== */

  function arrayBufferABase64(buffer) {
    const bytes = new Uint8Array(buffer);
    const tamanoBloque = 0x8000;
    let binario = "";
    for (let i = 0; i < bytes.length; i += tamanoBloque) {
      binario += String.fromCharCode.apply(
        null,
        bytes.subarray(i, i + tamanoBloque)
      );
    }
    return window.btoa(binario);
  }

  function textoPlanoPDF(texto) {
    return String(texto ?? "")
      .replace(/ρ/g, "rho")
      .replace(/λ/g, "lambda")
      .replace(/μ/g, "mu")
      .replace(/≤/g, "<=")
      .replace(/≥/g, ">=")
      .replace(/∞/g, "inf")
      .replace(/Σ/g, "Sum")
      .replace(/₀/g, "0")
      .replace(/ₛ/g, "s")
      .replace(/ᵢ/g, "i")
      .replace(/ₐ/g, "a")
      .replace(/−/g, "-")
      .replace(/·/g, "-");
  }

  async function cargarFuentesPDF() {
    if (state.fuentesPDF !== null) return state.fuentesPDF;
    try {
      const base = new URL("/vendor/fonts/", window.location.origin);
      const [normal, negrita] = await Promise.all(
        ["DejaVuSans.ttf", "DejaVuSans-Bold.ttf"].map(async (archivo) => {
          const respuesta = await fetch(new URL(archivo, base));
          if (!respuesta.ok) throw new Error(`No se pudo cargar ${archivo}`);
          return arrayBufferABase64(await respuesta.arrayBuffer());
        })
      );
      state.fuentesPDF = { normal, negrita };
    } catch (error) {
      console.warn("Se usará la fuente estándar del PDF:", error);
      state.fuentesPDF = false;
    }
    return state.fuentesPDF;
  }

  function registrarFuentesPDF(doc, fuentes) {
    if (!fuentes) return false;
    try {
      doc.addFileToVFS("DejaVuSans.ttf", fuentes.normal);
      doc.addFont("DejaVuSans.ttf", "DejaVu", "normal");
      doc.addFileToVFS("DejaVuSans-Bold.ttf", fuentes.negrita);
      doc.addFont("DejaVuSans-Bold.ttf", "DejaVu", "bold");
      doc.setFont("DejaVu", "normal");
      return true;
    } catch (error) {
      console.warn("No se pudieron registrar las fuentes del PDF:", error);
      return false;
    }
  }

  let fondoCabeceraPDF;

  function cargarFondoCabeceraPDF() {
    if (fondoCabeceraPDF !== undefined) return Promise.resolve(fondoCabeceraPDF);

    return new Promise((resolve) => {
      const imagen = new Image();
      imagen.decoding = "async";

      imagen.onload = () => {
        try {
          const ancho = 1800;
          const alto = Math.round((ancho * 32) / 210);
          const canvas = document.createElement("canvas");
          canvas.width = ancho;
          canvas.height = alto;
          const ctx = canvas.getContext("2d");
          if (!ctx) throw new Error("El navegador no permite dibujar el fondo.");

          const anchoOriginal = imagen.naturalWidth || 1800;
          const altoOriginal = imagen.naturalHeight || 360;
          const altoDibujo = altoOriginal * (ancho / anchoOriginal);
          const recorte = Math.max(0, altoDibujo - alto);
          ctx.drawImage(imagen, 0, -recorte * 0.42, ancho, altoDibujo);

          const velo = ctx.createLinearGradient(0, 0, ancho, 0);
          velo.addColorStop(0, "rgba(2, 8, 26, 0.92)");
          velo.addColorStop(0.46, "rgba(4, 18, 52, 0.52)");
          velo.addColorStop(1, "rgba(2, 9, 27, 0.84)");
          ctx.fillStyle = velo;
          ctx.fillRect(0, 0, ancho, alto);

          const brillo = ctx.createRadialGradient(
            ancho * 0.88,
            0,
            0,
            ancho * 0.88,
            0,
            ancho * 0.42
          );
          brillo.addColorStop(0, "rgba(34, 211, 238, 0.22)");
          brillo.addColorStop(1, "rgba(34, 211, 238, 0)");
          ctx.fillStyle = brillo;
          ctx.fillRect(0, 0, ancho, alto);

          fondoCabeceraPDF = canvas.toDataURL("image/png");
          resolve(fondoCabeceraPDF);
        } catch (error) {
          console.warn("No se pudo preparar el fondo de la cabecera del PDF:", error);
          fondoCabeceraPDF = null;
          resolve(null);
        }
      };

      imagen.onerror = () => {
        console.warn("No se pudo cargar el fondo de la cabecera del PDF.");
        fondoCabeceraPDF = null;
        resolve(null);
      };

      imagen.src = new URL("/navbar-bg.svg", window.location.origin).href;
    });
  }

  function dibujarLecturaPDF(doc, fuente, unicode, calculo, inicioY, anchoPagina) {
    const margen = 14;
    const relleno = 5;
    const ancho = anchoPagina - margen * 2;
    const sangria = 5.4;
    const anchoTexto = ancho - relleno * 2 - sangria;
    const tamano = 8.4;
    const altoLinea = 4.05;
    const separacion = 2.4;

    const items = lecturasSistemaMMC(calculo).map(({ texto }) =>
      unicode ? texto : textoPlanoPDF(texto)
    );

    doc.setFont(fuente, "normal");
    doc.setFontSize(tamano);
    const lineas = items.map((texto) => doc.splitTextToSize(texto, anchoTexto));
    const altoTexto = lineas.reduce(
      (total, filas) => total + filas.length * altoLinea + separacion,
      0
    );
    const alto = relleno * 2 + 8 + altoTexto - separacion;

    doc.setFillColor(17, 28, 49);
    doc.setDrawColor(34, 50, 80);
    doc.setLineWidth(0.25);
    doc.roundedRect(margen, inicioY, ancho, alto, 3, 3, "FD");

    const iconoX = margen + relleno;
    const iconoY = inicioY + relleno;
    doc.setFillColor(26, 47, 70);
    doc.roundedRect(iconoX, iconoY, 7, 7, 1.5, 1.5, "F");
    doc.setDrawColor(34, 211, 238);
    doc.setLineWidth(0.35);
    doc.circle(iconoX + 3.5, iconoY + 2.9, 1.35, "S");
    doc.line(iconoX + 2.85, iconoY + 4.55, iconoX + 4.15, iconoY + 4.55);
    doc.line(iconoX + 3.15, iconoY + 5.25, iconoX + 3.85, iconoY + 5.25);

    doc.setFont(fuente, "bold");
    doc.setFontSize(10.5);
    doc.setTextColor(248, 250, 252);
    doc.text("Lectura del sistema", iconoX + 10, iconoY + 5);

    let cursorY = inicioY + relleno + 10;
    lineas.forEach((filas) => {
      doc.setFillColor(34, 211, 238);
      doc.circle(margen + relleno + 1.3, cursorY - 1.2, 0.62, "F");
      doc.setFont(fuente, "normal");
      doc.setFontSize(tamano);
      doc.setTextColor(179, 193, 214);
      filas.forEach((linea, indice) => {
        doc.text(linea, margen + relleno + sangria, cursorY + indice * altoLinea);
      });
      cursorY += filas.length * altoLinea + separacion;
    });

    return inicioY + alto;
  }

  function etiquetaPDF(calculo, unicode) {
    if (unicode) return calculo.modelo_etiqueta;
    return calculo.modelo === MODELO_FINITO
      ? "M/M/c:(DG/N/inf)"
      : "M/M/c:(DG/inf/inf)";
  }

  function construirPDF(calculo, probabilidad, imagenes, usarFuentes, fondoCabecera) {
    const jsPDF = window.jspdf?.jsPDF;
    if (!jsPDF) throw new Error("jsPDF no está disponible.");
    if (typeof document.createElement("canvas").getContext !== "function") {
      throw new Error("El navegador no soporta la generación del PDF.");
    }

    const doc = new jsPDF({
      orientation: "portrait",
      unit: "mm",
      format: "a4",
      compress: true,
    });

    const unicode = Boolean(usarFuentes && registrarFuentesPDF(doc, state.fuentesPDF));
    const fuente = unicode ? "DejaVu" : "helvetica";
    const simbolos = unicode
      ? {
          rho: "ρ",
          lambda: "λ",
          mu: "μ",
          p0: "P₀",
          ls: "Lₛ",
          lq: "Lq",
          ws: "Wₛ",
          wq: "Wq",
          inactivos: "cᵢ",
          activos: "cₐ",
          utilizacion: "ρ/c",
        }
      : {
          rho: "rho",
          lambda: "lambda",
          mu: "mu",
          p0: "P0",
          ls: "Ls",
          lq: "Lq",
          ws: "Ws",
          wq: "Wq",
          inactivos: "c inactivos",
          activos: "c activos",
          utilizacion: "rho/c",
        };

    const resultados = calculo.resultados || {};
    const parametros = calculo.parametros || {};
    const finito = calculo.modelo === MODELO_FINITO;
    const anchoPagina = doc.internal.pageSize.getWidth();
    const fecha = formatearFecha(calculo.timestamp);
    const modeloTxt = etiquetaPDF(calculo, unicode);

    doc.setProperties({
      title: `Simulab · Cálculo M/M/c #${calculo.id ?? ""}`,
      subject: "Reporte de análisis de línea de espera M/M/c",
      author: "Simulab",
      creator: "Simulab",
    });

    // Cabecera
    doc.setFillColor(15, 23, 42);
    doc.rect(0, 0, anchoPagina, 32, "F");
    if (fondoCabecera) {
      try {
        doc.addImage(
          fondoCabecera,
          "PNG",
          0,
          0,
          anchoPagina,
          32,
          undefined,
          "FAST"
        );
      } catch (error) {
        console.warn("No se pudo insertar el fondo de la cabecera:", error);
      }
    }
    doc.setTextColor(255, 255, 255);
    doc.setFont(fuente, "bold");
    doc.setFontSize(18);
    doc.text("Simulab", 14, 14);
    doc.setFont(fuente, "normal");
    doc.setFontSize(9);
    doc.setTextColor(226, 232, 240);
    doc.text(fecha, anchoPagina - 14, 14, { align: "right" });

    const finLectura = dibujarLecturaPDF(
      doc,
      fuente,
      unicode,
      calculo,
      38,
      anchoPagina
    );

    let yContenido = finLectura + 10;
    if (yContenido > 235) {
      doc.addPage();
      yContenido = 20;
    }

    doc.setTextColor(15, 23, 42);
    doc.setFont(fuente, "bold");
    doc.setFontSize(16);
    doc.text("Análisis de línea de espera M/M/c", 14, yContenido);
    doc.setFont(fuente, "normal");
    doc.setFontSize(9);
    doc.setTextColor(100, 116, 139);
    doc.text(modeloTxt, 14, yContenido + 7);

    const estilosTabla = {
      theme: "grid",
      styles: {
        font: fuente,
        fontSize: 8,
        cellPadding: 2.1,
        lineColor: [226, 232, 240],
        lineWidth: 0.1,
        textColor: [30, 41, 59],
        overflow: "linebreak",
      },
      headStyles: {
        fillColor: [79, 70, 229],
        textColor: [255, 255, 255],
        fontStyle: "bold",
        fontSize: 7.4,
      },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      margin: { left: 14, right: 14, bottom: 18 },
      showHead: "everyPage",
    };

    const parametrosPDF = [
      ["Modelo", modeloTxt],
      ["Fecha y hora", fecha],
      [simbolos.lambda, fmtNumero(parametros.lambda)],
      [simbolos.mu, fmtNumero(parametros.mu)],
      [`c (${unicode ? "servidores" : "servidores"})`, String(parametros.c ?? "—")],
    ];
    if (finito) {
      parametrosPDF.push(["N (capacidad)", String(parametros.N ?? "—")]);
    } else {
      parametrosPDF.push(["nMax (corte de tabla)", String(parametros.nMax ?? "—")]);
    }

    doc.autoTable({
      ...estilosTabla,
      startY: yContenido + 12,
      head: [["Parámetros del sistema", "Valor"]],
      body: parametrosPDF,
      columnStyles: { 0: { cellWidth: 72 }, 1: { cellWidth: "auto" } },
    });

    let y = doc.lastAutoTable.finalY + 9;
    if (y > 230) {
      doc.addPage();
      y = 20;
    }
    doc.setFont(fuente, "bold");
    doc.setFontSize(12);
    doc.setTextColor(15, 23, 42);
    doc.text("Métricas del sistema", 14, y);

    const filasMetricas = [
      ["Servidores en paralelo", "c", String(parametros.c ?? "—")],
      ["Intensidad de tráfico", `${simbolos.rho} = ${simbolos.lambda}/${simbolos.mu}`, fmtNumero(resultados.rho)],
      ["Factor de utilización", simbolos.utilizacion, fmtNumero(resultados.rho_c)],
      ["Probabilidad de sistema vacío", simbolos.p0, fmtNumero(resultados.p0)],
      ["Número promedio en el sistema", simbolos.ls, fmtNumero(resultados.Ls)],
      ["Número promedio en cola", simbolos.lq, fmtNumero(resultados.Lq)],
      ["Tiempo promedio en el sistema", simbolos.ws, fmtNumero(resultados.Ws)],
      ["Tiempo promedio en cola", simbolos.wq, fmtNumero(resultados.Wq)],
      ["Servidores inactivos promedio", simbolos.inactivos, fmtNumero(resultados.servidores_inactivos)],
      ["Servidores activos promedio", simbolos.activos, fmtNumero(resultados.servidores_activos)],
      ["Utilización real de los servidores", "(c - ci)/c", fmtNumero(resultados.utilizacion)],
    ];
    if (finito) {
      filasMetricas.push(
        ["Tasa efectiva de llegada", `${simbolos.lambda} efectiva`, fmtNumero(resultados.lambda_efectiva)],
        ["Tasa de llegada rechazada", `${simbolos.lambda} perdida`, fmtNumero(resultados.lambda_perdida)],
        ["Probabilidad de bloqueo", "pN", fmtNumero(resultados.pN)]
      );
    }

    doc.autoTable({
      ...estilosTabla,
      startY: y + 3,
      head: [["Métrica", "Símbolo", "Valor"]],
      body: filasMetricas,
      columnStyles: {
        0: { cellWidth: 106 },
        1: { cellWidth: 40 },
        2: { halign: "right" },
      },
    });

    y = doc.lastAutoTable.finalY + 4;
    doc.setFont(fuente, "normal");
    doc.setFontSize(7.4);
    doc.setTextColor(100, 116, 139);
    doc.text("Los tiempos se expresan en las mismas unidades de tiempo que λ y μ.", 14, y);

    // Gráficas
    y += 12;
    if (y > 175) {
      doc.addPage();
      y = 20;
    }
    doc.setFont(fuente, "bold");
    doc.setFontSize(12);
    doc.setTextColor(15, 23, 42);
    doc.text("Gráficas de distribución", 14, y);

    const columnasGraficas = [
      { dataUrl: imagenes.absoluta, titulo: "Probabilidad absoluta p(n)" },
      {
        dataUrl: imagenes.acumulada,
        titulo: unicode
          ? "Probabilidad acumulada P(X ≤ n)"
          : "Probabilidad acumulada P(X <= n)",
      },
    ];
    const separacionGraficas = 8;
    const anchoColumna = (anchoPagina - 28 - separacionGraficas) / 2;
    const altoMaximo = 78;
    const yGraficas = y + 4;
    let altoGraficas = 0;

    columnasGraficas.forEach(({ dataUrl, titulo }, indice) => {
      if (!dataUrl) return;
      let propiedades;
      try {
        propiedades = doc.getImageProperties(dataUrl);
      } catch {
        return;
      }
      let ancho = anchoColumna;
      let alto = (ancho * propiedades.height) / propiedades.width;
      if (alto > altoMaximo) {
        alto = altoMaximo;
        ancho = (alto * propiedades.width) / propiedades.height;
      }
      const x = 14 + indice * (anchoColumna + separacionGraficas) + (anchoColumna - ancho) / 2;
      doc.setFont(fuente, "bold");
      doc.setFontSize(9);
      doc.setTextColor(51, 65, 85);
      doc.text(titulo, x + ancho / 2, yGraficas, { align: "center" });
      doc.addImage(
        dataUrl,
        "PNG",
        x,
        yGraficas + 3,
        ancho,
        alto,
        undefined,
        "FAST"
      );
      altoGraficas = Math.max(altoGraficas, alto);
    });

    y = yGraficas + 3 + altoGraficas + 7;

    // Tabla de distribución
    y += 2;
    const filasDistribucion = (calculo.distribucion || []).map((fila) => [
      String(fila.n),
      fmtNumero(fila.p),
      fmtAcumulada(fila.acumulada),
    ]);
    const altoFilaAprox = 5.9;
    const filasQueCaben = Math.floor((280 - (y + 6)) / altoFilaAprox);
    if (filasQueCaben < Math.min(filasDistribucion.length, 15)) {
      doc.addPage();
      y = 20;
    }
    doc.setFont(fuente, "bold");
    doc.setFontSize(12);
    doc.setTextColor(15, 23, 42);
    doc.text("Tabla de distribución de probabilidad", 14, y);

    doc.autoTable({
      ...estilosTabla,
      startY: y + 3,
      head: [["n", "p(n)", "P(X ≤ n)"]],
      body: filasDistribucion,
      styles: { ...estilosTabla.styles, fontSize: 7.3, cellPadding: 1.6 },
      columnStyles: {
        0: { cellWidth: 28 },
        1: { halign: "right" },
        2: { halign: "right" },
      },
    });

    if (probabilidad) {
      y = doc.lastAutoTable.finalY + 9;
      if (y > 245) {
        doc.addPage();
        y = 20;
      }
      doc.setFont(fuente, "bold");
      doc.setFontSize(12);
      doc.setTextColor(15, 23, 42);
      doc.text("Probabilidad consultada", 14, y);
      doc.autoTable({
        ...estilosTabla,
        startY: y + 3,
        head: [["Evento", "Probabilidad"]],
        body: [
          [
            probabilidad.descripcion,
            `${fmtNumero(probabilidad.probabilidad)}  (${fmtPorcentaje(
              probabilidad.probabilidad,
              4
            )})`,
          ],
        ],
        columnStyles: { 1: { halign: "right", cellWidth: 65 } },
      });
    }

    return doc;
  }

  async function generarPDF() {
    if (!state.calculo) {
      notificar("Calcula un modelo antes de generar el PDF.", "warning");
      return;
    }
    if (state.generandoPDF) return;

    state.generandoPDF = true;
    const boton = $("#btnPDF");
    setBotonCargando(boton, true, "Generando PDF…");

    try {
      const [fuentes, imagenes, fondoCabecera] = await Promise.all([
        cargarFuentesPDF(),
        obtenerGraficasParaReporte(),
        cargarFondoCabeceraPDF(),
      ]);
      const doc = construirPDF(
        state.calculo,
        state.probabilidad,
        imagenes,
        Boolean(fuentes),
        fondoCabecera
      );
      const ahora = new Date();
      const marca = `${ahora.getFullYear()}${String(ahora.getMonth() + 1).padStart(
        2,
        "0"
      )}${String(ahora.getDate()).padStart(2, "0")}_${String(
        ahora.getHours()
      ).padStart(2, "0")}${String(ahora.getMinutes()).padStart(2, "0")}`;
      const tipo = state.calculo.modelo === MODELO_FINITO ? "finito" : "infinito";
      doc.save(`Simulab_MMc_${tipo}_${marca}.pdf`);
      notificar("PDF generado correctamente.", "success");
    } catch (error) {
      console.error("Error al generar el PDF:", error);
      notificar(error.message || "No se pudo generar el PDF.", "danger");
    } finally {
      state.generandoPDF = false;
      setBotonCargando(boton, false);
      actualizarBotonesReporte();
    }
  }

  function construirReporteImpresion(calculo, probabilidad, imagenes) {
    const parametros = calculo.parametros || {};
    const resultados = calculo.resultados || {};
    const finito = calculo.modelo === MODELO_FINITO;
    const fecha = formatearFecha(calculo.timestamp);
    const modelo = calculo.modelo_etiqueta || "M/M/c";

    const kpis = [
      ["ρ", "Intensidad de tráfico", fmtNumero(resultados.rho)],
      ["P₀", "Sistema vacío", fmtNumero(resultados.p0)],
      ["Lₛ", "En el sistema", fmtNumero(resultados.Ls)],
      ["Lq", "En cola", fmtNumero(resultados.Lq)],
      ["Wₛ", "Tiempo total", fmtNumero(resultados.Ws)],
      ["Wq", "Tiempo en cola", fmtNumero(resultados.Wq)],
      ["cₐ", "Servidores activos", fmtNumero(resultados.servidores_activos)],
      ["cᵢ", "Servidores inactivos", fmtNumero(resultados.servidores_inactivos)],
    ];
    if (finito) {
      kpis.push(
        ["λ ef.", "Llegada efectiva", fmtNumero(resultados.lambda_efectiva)],
        ["λ perd.", "Llegada rechazada", fmtNumero(resultados.lambda_perdida)],
        ["pN", "Sistema lleno", fmtNumero(resultados.pN)],
        ["ρ/c", "Utilización real", fmtNumero(resultados.utilizacion)]
      );
    }

    const parametrosTexto = [
      `λ = ${fmtNumero(parametros.lambda)}`,
      `μ = ${fmtNumero(parametros.mu)}`,
      `c = ${escaparHTML(parametros.c ?? "—")}`,
      finito
        ? `N = ${escaparHTML(parametros.N ?? "—")}`
        : `nMax = ${escaparHTML(parametros.nMax ?? "—")}`,
    ].join(" · ");

    const metricas = [
      ["Servidores en paralelo", "c", String(parametros.c ?? "—")],
      ["Intensidad de tráfico", "ρ = λ/μ", fmtNumero(resultados.rho)],
      ["Factor de utilización", "ρ/c", fmtNumero(resultados.rho_c)],
      ["Probabilidad de sistema vacío", "P₀", fmtNumero(resultados.p0)],
      ["Número promedio en el sistema", "Lₛ", fmtNumero(resultados.Ls)],
      ["Número promedio en cola", "Lq", fmtNumero(resultados.Lq)],
      ["Tiempo promedio en el sistema", "Wₛ", fmtNumero(resultados.Ws)],
      ["Tiempo promedio en cola", "Wq", fmtNumero(resultados.Wq)],
      ["Servidores inactivos promedio", "cᵢ", fmtNumero(resultados.servidores_inactivos)],
      ["Servidores activos promedio", "cₐ", fmtNumero(resultados.servidores_activos)],
      ["Utilización real de los servidores", "(c − cᵢ)/c", fmtNumero(resultados.utilizacion)],
    ];
    if (finito) {
      metricas.push(
        ["Tasa efectiva de llegada", "λ efectiva", fmtNumero(resultados.lambda_efectiva)],
        ["Tasa de llegada rechazada", "λ perdida", fmtNumero(resultados.lambda_perdida)],
        ["Probabilidad de bloqueo", "pN", fmtNumero(resultados.pN)]
      );
    }

    const filasKPI = kpis
      .map(
        ([simbolo, nombre, valor]) => `
          <div class="kpi">
            <span class="kpi-simbolo">${escaparHTML(simbolo)}</span>
            <span class="kpi-valor">${escaparHTML(valor)}</span>
            <span class="kpi-nombre">${escaparHTML(nombre)}</span>
          </div>`
      )
      .join("");

    const lectura = lecturasSistemaMMC(calculo)
      .map(({ texto }) => `<li>${escaparHTML(texto)}</li>`)
      .join("");

    const filasMetricas = metricas
      .map(
        ([nombre, simbolo, valor]) => `
          <tr>
            <td>${escaparHTML(nombre)}</td>
            <td class="simbolo">${escaparHTML(simbolo)}</td>
            <td class="num">${escaparHTML(valor)}</td>
          </tr>`
      )
      .join("");

    const filasDistribucion = (calculo.distribucion || [])
      .map(
        (fila) => `
          <tr>
            <td>${escaparHTML(fila.n)}</td>
            <td class="num">${fmtNumero(fila.p)}</td>
            <td class="num">${fmtAcumulada(fila.acumulada)}</td>
            <td>${escaparHTML(significadoFila(Number(fila.n), Number(fila.p)))}</td>
          </tr>`
      )
      .join("");

    const graficas = [
      [
        "Probabilidad absoluta",
        "p(n) de encontrar exactamente n clientes",
        "p(n)",
        imagenes.absoluta,
      ],
      [
        "Probabilidad acumulada",
        "P(X ≤ n) de tener hasta n clientes",
        "F(n)",
        imagenes.acumulada,
      ],
    ]
      .map(
        ([titulo, copia, simbolo, src]) =>
          src
            ? `
          <figure class="grafica">
            <figcaption>
              <span>${escaparHTML(titulo)}</span>
              <span class="grafica-simbolo">${escaparHTML(simbolo)}</span>
            </figcaption>
            <p>${escaparHTML(copia)}</p>
            <img src="${src}" alt="${escaparHTML(titulo)}">
          </figure>`
            : ""
      )
      .join("");

    const bloqueProbabilidad = probabilidad
      ? `
      <section class="bloque">
        <h2>Probabilidad consultada</h2>
        <div class="probabilidad">
          <p class="probabilidad-evento">${escaparHTML(probabilidad.descripcion)}</p>
          <p class="probabilidad-valor">${escaparHTML(
            fmtNumero(probabilidad.probabilidad)
          )}</p>
          <p class="probabilidad-pct">${escaparHTML(
            fmtPorcentaje(probabilidad.probabilidad, 4)
          )}</p>
          <p class="probabilidad-formula">${escaparHTML(
            formulaProbabilidad(calculo, probabilidad)
          )}</p>
        </div>
      </section>`
      : "";

    return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<title>Simulab · Reporte M/M/c</title>
<style>
  @page { size: A4 portrait; margin: 12mm 11mm 14mm; }
  * { box-sizing: border-box; }
  html, body {
    margin: 0;
    padding: 0;
    color: #0f172a;
    background: #fff;
    font-family: "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    font-size: 9.5pt;
    line-height: 1.45;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .cabecera {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 5mm;
    margin-bottom: 5mm;
    padding-bottom: 3mm;
    border-bottom: 1.4pt solid #0f172a;
  }
  .marca {
    font-size: 18pt;
    font-weight: 800;
    letter-spacing: -0.03em;
    line-height: 1;
  }
  .contexto {
    flex: 1 1 auto;
    color: #475569;
    font-size: 8pt;
    text-align: center;
  }
  .fecha {
    flex: 0 0 auto;
    color: #475569;
    font-size: 8pt;
    text-align: right;
    white-space: nowrap;
  }
  h1 {
    margin: 0 0 1mm;
    font-size: 15pt;
    letter-spacing: -0.01em;
  }
  h2 {
    margin: 4.5mm 0 2mm;
    color: #1e293b;
    font-size: 10.5pt;
  }
  .meta {
    margin: 0 0 1.5mm;
    color: #64748b;
    font-size: 8pt;
  }
  .parametros {
    margin: 0 0 4mm;
    color: #334155;
    font-size: 8.6pt;
    font-weight: 650;
    font-variant-numeric: tabular-nums;
  }
  .kpis {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 2.5mm;
  }
  .kpi {
    padding: 1.9mm 2.4mm;
    border: 0.6pt solid #dbe3ee;
    border-radius: 2.4mm;
    break-inside: avoid;
    page-break-inside: avoid;
  }
  .kpi-simbolo {
    display: block;
    color: #4f46e5;
    font-family: "Cambria Math", Georgia, serif;
    font-size: 7.4pt;
    font-weight: 700;
  }
  .kpi-valor {
    display: block;
    margin: 0.6mm 0;
    font-size: 12.5pt;
    font-weight: 750;
    font-variant-numeric: tabular-nums;
  }
  .kpi-nombre {
    display: block;
    color: #64748b;
    font-size: 6.9pt;
  }
  .lectura {
    margin-top: 4mm;
    padding: 3mm 4mm;
    background: #f8fafc;
    border: 0.6pt solid #dbe3ee;
    border-radius: 2.4mm;
    break-inside: avoid;
    page-break-inside: avoid;
  }
  .lectura h2 {
    margin: 0 0 1.6mm;
  }
  .lectura ul {
    margin: 0;
    padding-left: 4.2mm;
  }
  .lectura li {
    margin-bottom: 1.1mm;
    color: #334155;
    font-size: 8.4pt;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 8pt;
  }
  thead th {
    padding: 1.8mm 2mm;
    color: #fff;
    background: #4f46e5;
    font-size: 7.4pt;
    font-weight: 700;
    text-align: left;
  }
  tbody th, tbody td {
    padding: 1.15mm 2mm;
    border-bottom: 0.5pt solid #e2e8f0;
  }
  tbody th {
    color: #475569;
    font-weight: 600;
    text-align: left;
  }
  tbody tr:nth-child(even) {
    background: #f8fafc;
  }
  .num { text-align: right; font-variant-numeric: tabular-nums; }
  .simbolo {
    color: #4f46e5;
    font-family: "Cambria Math", Georgia, serif;
    font-weight: 650;
  }
  .nota {
    margin: 2mm 0 0;
    color: #64748b;
    font-size: 7.4pt;
  }
  .pagina-nueva {
    break-before: page;
    page-break-before: always;
  }
  .graficas {
    display: flex;
    gap: 4mm;
    margin-top: 2mm;
  }
  .grafica {
    flex: 1 1 0;
    margin: 0;
    padding: 2.6mm;
    border: 0.6pt solid #dbe3ee;
    border-radius: 2.4mm;
    break-inside: avoid;
    page-break-inside: avoid;
  }
  .grafica figcaption {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 2mm;
    font-size: 8.4pt;
    font-weight: 700;
  }
  .grafica-simbolo {
    padding: 0.4mm 1.6mm;
    color: #4f46e5;
    background: #eef2ff;
    border-radius: 1.4mm;
    font-family: "Cambria Math", Georgia, serif;
    font-size: 7.4pt;
  }
  .grafica p {
    margin: 0.6mm 0 1.6mm;
    color: #64748b;
    font-size: 7.2pt;
  }
  .grafica img {
    display: block;
    width: 100%;
    height: auto;
  }
  .probabilidad {
    padding: 4mm;
    background: #f8fafc;
    border: 0.6pt solid #dbe3ee;
    border-radius: 2.4mm;
    break-inside: avoid;
    page-break-inside: avoid;
  }
  .probabilidad-evento {
    margin: 0;
    color: #4f46e5;
    font-size: 9pt;
    font-weight: 700;
  }
  .probabilidad-valor {
    margin: 1mm 0 0;
    font-size: 22pt;
    font-weight: 750;
    font-variant-numeric: tabular-nums;
  }
  .probabilidad-pct {
    margin: 0;
    color: #475569;
    font-size: 11pt;
    font-weight: 650;
  }
  .probabilidad-formula {
    margin: 2mm 0 0;
    color: #64748b;
    font-size: 8pt;
  }
</style>
</head>
<body>
  <header class="cabecera">
    <span class="marca">Simulab</span>
    <span class="contexto">Reporte de línea de espera M/M/c · ${escaparHTML(modelo)}</span>
    <span class="fecha">${escaparHTML(fecha)}</span>
  </header>

  <section>
    <h1>Resultados del sistema</h1>
    <p class="meta">Cálculo #${escaparHTML(calculo.id ?? "—")} · ${escaparHTML(
      modelo
    )} · ${escaparHTML(fecha)}</p>
    <p class="parametros">${parametrosTexto}</p>

    <div class="kpis">${filasKPI}</div>

    <div class="lectura">
      <h2>Lectura del sistema</h2>
      <ul>${lectura}</ul>
    </div>

    <h2>Detalle del cálculo</h2>
    <table>
      <thead>
        <tr>
          <th scope="col">Métrica</th>
          <th scope="col">Símbolo</th>
          <th scope="col" class="num">Valor</th>
        </tr>
      </thead>
      <tbody>${filasMetricas}</tbody>
    </table>
    <p class="nota">Los tiempos se expresan en las mismas unidades de tiempo que λ y μ.</p>
  </section>

  <section class="pagina-nueva">
    <h1>Distribución de probabilidad</h1>
    <p class="meta">Cálculo #${escaparHTML(calculo.id ?? "—")} · ${escaparHTML(modelo)}</p>

    <div class="graficas">${graficas}</div>

    <h2>Tabla de distribución</h2>
    <table>
      <thead>
        <tr>
          <th scope="col">n</th>
          <th scope="col" class="num">p(n)</th>
          <th scope="col" class="num">P(X ≤ n)</th>
          <th scope="col">Interpretación</th>
        </tr>
      </thead>
      <tbody>${filasDistribucion}</tbody>
    </table>

    ${bloqueProbabilidad}
  </section>
</body>
</html>`;
  }

  async function imprimirDocumento(html) {
    if (state.iframeImpresion) {
      state.iframeImpresion.remove();
      state.iframeImpresion = null;
    }

    const iframe = document.createElement("iframe");
    iframe.setAttribute("aria-hidden", "true");
    iframe.setAttribute("title", "Reporte de impresión");
    iframe.style.cssText =
      "position:fixed;top:0;left:-10000px;width:900px;height:1200px;border:0;";
    const cargado = new Promise((resolve) => {
      iframe.addEventListener("load", resolve, { once: true });
    });
    iframe.srcdoc = html;
    document.body.appendChild(iframe);
    state.iframeImpresion = iframe;

    try {
      await cargado;
      const documento = iframe.contentDocument;
      if (!documento) {
        throw new Error("No se pudo preparar el documento de impresión.");
      }
      await Promise.all(
        Array.from(documento.images).map((imagen) =>
          typeof imagen.decode === "function"
            ? imagen.decode().catch(() => {})
            : Promise.resolve()
        )
      );
      await new Promise((resolve) =>
        window.requestAnimationFrame(() => window.requestAnimationFrame(resolve))
      );

      const ventana = iframe.contentWindow;
      if (!ventana) throw new Error("No se pudo abrir el reporte de impresión.");
      const limpiar = () => {
        if (state.iframeImpresion === iframe) state.iframeImpresion = null;
        iframe.remove();
      };
      ventana.addEventListener("afterprint", limpiar, { once: true });
      window.setTimeout(limpiar, 120000);
      ventana.focus();
      ventana.print();
    } catch (error) {
      iframe.remove();
      if (state.iframeImpresion === iframe) state.iframeImpresion = null;
      throw error;
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", iniciar, { once: true });
  } else {
    iniciar();
  }
})();
