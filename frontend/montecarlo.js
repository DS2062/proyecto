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

  const MIN_VARIABLES = 1;
  const MAX_VARIABLES = 20;
  const MIN_OBSERVACIONES = 10;
  const MAX_OBSERVACIONES = 50000;
  const MAX_LAMBDA_POISSON = 10000;
  const MAX_PARAMETRO_EXPONENCIAL = 1000000000;
  const MIN_PARAMETRO_EXPONENCIAL = 0.000000001;
  const TAMANO_PAGINA_DATOS = 50;
  const MAX_COLUMNAS_U = 3;
  const MAX_COLUMNAS_MUESTRA = 8;
  const MAX_PUNTOS_GRAFICA = 40;
  const MAX_FILAS_PDF = 18;
  const CONFIANZA_POR_DEFECTO = 0.95;

  const ORDEN_PESTANAS = [
    { id: "tab-resumen", siguiente: "tab-datos", etiqueta: "Ver base de datos" },
    { id: "tab-datos", siguiente: "tab-transformada", etiqueta: "Ver transformada" },
    { id: "tab-transformada", siguiente: "tab-graficas", etiqueta: "Ver gráficas" },
    { id: "tab-graficas", siguiente: "tab-historial", etiqueta: "Ver historial" },
    { id: "tab-historial", siguiente: "tab-resumen", etiqueta: "Volver al resumen" },
  ];

  const state = {
    simulacion: null,
    variableActual: 0,
    detalleVariable: null,
    detalleVariableIndice: null,
    detalleVariableCargando: false,
    tokenVariable: 0,
    charts: { distribucion: null, cdf: null, convergencia: null },
    chartsDirty: true,
    datosOffset: 0,
    datosTotal: 0,
    datosCargado: false,
    datosCargando: false,
    tokenDatos: 0,
    mostrarU: false,
    variableU: 0,
    historialCargado: false,
    historialCargando: false,
    historialOffset: 0,
    historialLimite: 10,
    historialTotal: 0,
    generandoPDF: false,
    imprimiendo: false,
    fuentesPDF: null,
    iframeImpresion: null,
  };

  const formato6 = new Intl.NumberFormat("es-MX", {
    maximumFractionDigits: 6,
  });

  const formato4 = new Intl.NumberFormat("es-MX", {
    maximumFractionDigits: 4,
  });

  const formatoEntero = new Intl.NumberFormat("es-MX", {
    maximumFractionDigits: 0,
  });

  const formatoPorcentaje = new Intl.NumberFormat("es-MX", {
    maximumFractionDigits: 2,
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

  function fmtDecimal(valor, decimales = 4) {
    const convertido = numero(valor);
    if (convertido === null) return "—";
    const formato =
      decimales <= 4 ? formato4 : new Intl.NumberFormat("es-MX", {
        maximumFractionDigits: decimales,
      });
    return formato.format(convertido);
  }

  function fmtEntero(valor) {
    const convertido = numero(valor);
    if (convertido === null) return "—";
    return formatoEntero.format(convertido);
  }

  function fmtPorcentaje(valor, decimales = 2) {
    const convertido = numero(valor);
    if (convertido === null) return "—";
    return `${formatoPorcentaje.format(convertido)} %`;
  }

  function formatearFecha(iso) {
    const fecha = new Date(iso);
    if (Number.isNaN(fecha.getTime())) return String(iso ?? "—");
    return formatoFecha.format(fecha);
  }

  function formatearFechaCorta(iso) {
    const fecha = new Date(iso);
    if (Number.isNaN(fecha.getTime())) {
      return { fecha: String(iso ?? "—"), hora: "" };
    }
    return {
      fecha: formatoFechaCorta.format(fecha).replace(".", ""),
      hora: formatoHora.format(fecha),
    };
  }

  function esPoisson(simulacion = state.simulacion) {
    return simulacion?.distribucion === "poisson";
  }

  function etiquetaDistribucion(simulacion = state.simulacion) {
    if (!simulacion) return "Monte Carlo";
    return simulacion.distribucion_etiqueta || (esPoisson(simulacion) ? "Poisson" : "Exponencial");
  }

  function activarTab(idBoton) {
    const boton = document.getElementById(idBoton);
    if (!boton || !window.bootstrap?.Tab) return;
    window.bootstrap.Tab.getOrCreateInstance(boton).show();
  }

  function actualizarBotonSiguiente() {
    const boton = $("#btnSiguienteSeccion");
    const texto = $("#btnSiguienteTexto");
    if (!boton || !texto) return;

    const activo = $("#mainTabs .nav-link.active");
    const paso =
      ORDEN_PESTANAS.find((item) => item.id === activo?.id) || ORDEN_PESTANAS[0];

    texto.textContent = paso.etiqueta;
    boton.dataset.destino = paso.siguiente;
    boton.setAttribute("aria-label", paso.etiqueta);
    boton.classList.toggle("es-retorno", paso.siguiente === "tab-resumen");
  }

  function irASiguienteSeccion() {
    const boton = $("#btnSiguienteSeccion");
    const destino = boton?.dataset.destino;
    if (!destino) return;

    activarTab(destino);

    const encabezado = $("#mainTabs");
    if (encabezado) {
      const reducido = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      encabezado.scrollIntoView({
        behavior: reducido ? "auto" : "smooth",
        block: "start",
      });
    }
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
    const listo = Boolean(state.simulacion);
    ["btnPDF", "btnImprimir"].forEach((id) => {
      const boton = document.getElementById(id);
      if (boton) boton.disabled = !listo;
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
    const { method = "GET", body = null, timeout = 60000 } = opciones;
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
        throw new ApiError(
          "La simulación tardó demasiado. Reduce las observaciones o verifica el servidor."
        );
      }
      throw new ApiError(
        "No se pudo conectar con el servidor. Asegúrate de que el backend Flask esté en ejecución."
      );
    } finally {
      window.clearTimeout(temporizador);
    }
  }

  /* ========================================================================
     Formulario
     ======================================================================== */

  const MAPA_CAMPOS = {
    distribucion: "distribucion",
    num_variables: "numVariables",
    num_observaciones: "numObservaciones",
    modo_parametro: "modoParametro",
    tipo_parametro: "tipoParametroGlobal",
    parametro_global: "parametroGlobal",
    confianza: "confianza",
    semilla: "semilla",
  };

  function feedbackCampo(id) {
    return document.getElementById(
      `feedback${id.charAt(0).toUpperCase()}${id.slice(1)}`
    );
  }

  function limpiarErrorCampo(input) {
    if (!input) return;
    input.classList.remove("is-invalid");
    input.removeAttribute("aria-invalid");
    const feedback = feedbackCampo(input.id);
    if (feedback) feedback.classList.remove("d-block");
  }

  function limpiarErroresFormulario() {
    $("#formError").classList.add("d-none");
    $$(".is-invalid", $("#formSimulacion")).forEach(limpiarErrorCampo);
    $("#variablesError").classList.add("d-none");
    $("#variablesError").textContent = "";
  }

  function mostrarErrorFormulario(mensaje) {
    const alerta = $("#formError");
    alerta.textContent = mensaje;
    alerta.classList.remove("d-none");
  }

  function marcarErrorCampo(campo, mensaje) {
    const id = MAPA_CAMPOS[campo] || campo;
    const input = document.getElementById(id);
    if (!input) {
      if (campo?.startsWith("parametro_v")) {
        const indice = Number(campo.replace("parametro_v", "")) - 1;
        const fila = $(`#variablesPersonalizadas .mc-variable-row[data-indice="${indice}"]`);
        const entrada = fila?.querySelector(".mc-variable-parametro");
        if (entrada) {
          entrada.classList.add("is-invalid");
          entrada.setAttribute("aria-invalid", "true");
          entrada.focus();
        }
        const alerta = $("#variablesError");
        alerta.textContent = mensaje;
        alerta.classList.remove("d-none");
        return;
      }
      mostrarErrorFormulario(mensaje);
      return;
    }

    input.classList.add("is-invalid");
    input.setAttribute("aria-invalid", "true");
    const feedback = feedbackCampo(id);
    if (feedback) {
      feedback.textContent = mensaje;
      feedback.classList.add("d-block");
    }
    input.focus({ preventScroll: false });
  }

  function tipoParametroGlobal() {
    return $("#distribucion").value === "poisson"
      ? "lambda"
      : $("#tipoParametroGlobal").value;
  }

  function actualizarEtiquetaParametroGlobal() {
    const poisson = $("#distribucion").value === "poisson";
    const tipo = tipoParametroGlobal();
    const label = $("#labelParametroGlobal");
    const sufijo = $("#sufijoParametroGlobal");
    const ayuda = $("#ayudaParametroGlobal");
    const input = $("#parametroGlobal");
    const equivalencia = $("#equivalenciaParametro");

    if (poisson) {
      label.innerHTML = 'λ <span class="label-muted">Media de ocurrencia</span>';
      sufijo.textContent = "eventos";
      ayuda.textContent =
        "En Poisson, λ es la media de ocurrencias por intervalo. Debe ser mayor que 0 y como máximo 10,000.";
      input.placeholder = "Ej. 4";
      input.min = String(MIN_PARAMETRO_EXPONENCIAL);
      input.max = String(MAX_LAMBDA_POISSON);
      equivalencia.classList.add("d-none");
      return;
    }

    if (tipo === "media") {
      label.innerHTML = 'b <span class="label-muted">Media del tiempo entre eventos</span>';
      sufijo.textContent = "unidades";
      ayuda.textContent =
        "La media b define la escala del tiempo. El sistema calcula la tasa equivalente λ = 1/b.";
      input.placeholder = "Ej. 2.5";
    } else {
      label.innerHTML = 'λ <span class="label-muted">Tasa de ocurrencia</span>';
      sufijo.textContent = "eventos / unidad";
      ayuda.textContent =
        "La tasa λ indica eventos por unidad de tiempo. El sistema calcula la media equivalente b = 1/λ.";
      input.placeholder = "Ej. 0.4";
    }
    input.min = String(MIN_PARAMETRO_EXPONENCIAL);
    input.max = String(MAX_PARAMETRO_EXPONENCIAL);
    actualizarEquivalencia();
  }

  function actualizarEquivalencia() {
    const contenedor = $("#equivalenciaParametro");
    if ($("#distribucion").value !== "exponencial") {
      contenedor.classList.add("d-none");
      contenedor.innerHTML = "";
      return;
    }
    const valor = Number($("#parametroGlobal").value);
    if (!Number.isFinite(valor) || valor <= 0) {
      contenedor.classList.add("d-none");
      contenedor.innerHTML = "";
      return;
    }
    const tipo = $("#tipoParametroGlobal").value;
    const equivalente = 1 / valor;
    const texto =
      tipo === "media"
        ? `Equivalencia: λ = 1/b = ${fmtDecimal(equivalente, 6)} por unidad de tiempo.`
        : `Equivalencia: b = 1/λ = ${fmtDecimal(equivalente, 6)} unidades de tiempo.`;
    contenedor.textContent = texto;
    contenedor.classList.remove("d-none");
  }

  function etiquetaParametroFila(tipo) {
    return tipo === "tasa" ? "λ" : "b";
  }

  function actualizarFilaVariable(fila) {
    const tipoSelect = fila.querySelector(".mc-variable-tipo");
    const input = fila.querySelector(".mc-variable-parametro");
    const sufijo = fila.querySelector(".mc-variable-sufijo");
    if (!input) return;
    const tipo = tipoSelect?.value || "media";
    input.placeholder = etiquetaParametroFila(tipo);
    if (sufijo) sufijo.textContent = tipo === "tasa" ? "λ" : "b";
  }

  function crearFilaVariable(indice, datos = {}) {
    const poisson = $("#distribucion").value === "poisson";
    const tipo = datos.tipo || "media";
    const fila = document.createElement("div");
    fila.className = "mc-variable-row";
    fila.dataset.indice = String(indice);
    fila.innerHTML = `
      <span class="mc-variable-index" aria-hidden="true">V${indice + 1}</span>
      <input type="text" class="form-control form-control-sm mc-variable-nombre"
        maxlength="40" value="${escaparHTML(datos.nombre || `V${indice + 1}`)}"
        aria-label="Nombre de la variable ${indice + 1}">
      ${
        poisson
          ? ""
          : `<select class="form-select form-select-sm mc-variable-tipo"
               aria-label="Tipo de parámetro de la variable ${indice + 1}">
               <option value="media"${tipo === "media" ? " selected" : ""}>Media b</option>
               <option value="tasa"${tipo === "tasa" ? " selected" : ""}>Tasa λ</option>
             </select>`
      }
      <div class="mc-variable-parametro-wrap">
        <input type="number" step="any" class="form-control form-control-sm mc-variable-parametro"
          min="${poisson ? MIN_PARAMETRO_EXPONENCIAL : MIN_PARAMETRO_EXPONENCIAL}"
          max="${poisson ? MAX_LAMBDA_POISSON : MAX_PARAMETRO_EXPONENCIAL}"
          value="${datos.parametro ?? ""}" placeholder="${etiquetaParametroFila(tipo)}"
          aria-label="Parámetro de la variable ${indice + 1}">
        <span class="mc-variable-sufijo" aria-hidden="true">${etiquetaParametroFila(tipo)}</span>
      </div>
    `;
    actualizarFilaVariable(fila);
    return fila;
  }

  function actualizarFilasVariables({ preservar = true } = {}) {
    const contenedor = $("#variablesPersonalizadas");
    const cantidad = Math.max(
      MIN_VARIABLES,
      Math.min(MAX_VARIABLES, Number($("#numVariables").value) || MIN_VARIABLES)
    );
    const previos = preservar
      ? $$(".mc-variable-row", contenedor).map((fila) => ({
          nombre: fila.querySelector(".mc-variable-nombre")?.value || "",
          tipo: fila.querySelector(".mc-variable-tipo")?.value || "media",
          parametro: fila.querySelector(".mc-variable-parametro")?.value || "",
        }))
      : [];

    const fragmento = document.createDocumentFragment();
    for (let indice = 0; indice < cantidad; indice += 1) {
      fragmento.appendChild(crearFilaVariable(indice, previos[indice] || {}));
    }
    contenedor.replaceChildren(fragmento);
  }

  function actualizarFormularioDistribucion({ preservar = true } = {}) {
    const poisson = $("#distribucion").value === "poisson";
    $("#grupoTipoParametro").classList.toggle("d-none", poisson);
    actualizarEtiquetaParametroGlobal();
    actualizarFilasVariables({ preservar });
  }

  function actualizarModoParametro() {
    const personalizado = $("#modoParametro").value === "personalizado";
    $("#grupoParametroGlobal").classList.toggle("d-none", personalizado);
    $("#grupoVariablesPersonalizadas").classList.toggle("d-none", !personalizado);
    if (personalizado) actualizarFilasVariables({ preservar: true });
  }

  function leerEntero(input, minimo, maximo) {
    const texto = String(input.value ?? "").trim();
    if (!texto || !/^[+-]?\d+$/.test(texto)) return null;
    const valor = Number(texto);
    if (!Number.isInteger(valor) || valor < minimo || valor > maximo) return null;
    return valor;
  }

  function leerParametro(input) {
    const texto = String(input.value ?? "").trim();
    if (!texto) return null;
    const valor = Number(texto);
    return Number.isFinite(valor) ? valor : null;
  }

  function construirSolicitud() {
    const distribucion = $("#distribucion").value;
    const poisson = distribucion === "poisson";

    const inputVariables = $("#numVariables");
    const numVariables = leerEntero(inputVariables, MIN_VARIABLES, MAX_VARIABLES);
    if (numVariables === null) {
      marcarErrorCampo(
        "num_variables",
        `Las variables deben ser un entero entre ${MIN_VARIABLES} y ${MAX_VARIABLES}.`
      );
      return null;
    }

    const inputObservaciones = $("#numObservaciones");
    const numObservaciones = leerEntero(
      inputObservaciones,
      MIN_OBSERVACIONES,
      MAX_OBSERVACIONES
    );
    if (numObservaciones === null) {
      marcarErrorCampo(
        "num_observaciones",
        `Las observaciones deben ser un entero entre ${formatoEntero.format(
          MIN_OBSERVACIONES
        )} y ${formatoEntero.format(MAX_OBSERVACIONES)}.`
      );
      return null;
    }

    const modo = $("#modoParametro").value;
    const confianza = Number($("#confianza").value) || CONFIANZA_POR_DEFECTO;
    const textoSemilla = String($("#semilla").value ?? "").trim();
    let semilla = null;
    if (textoSemilla) {
      if (!/^[+-]?\d+$/.test(textoSemilla)) {
        marcarErrorCampo("semilla", "La semilla debe ser un número entero.");
        return null;
      }
      semilla = Number(textoSemilla);
      if (!Number.isSafeInteger(semilla)) {
        marcarErrorCampo("semilla", "La semilla es demasiado grande.");
        return null;
      }
    }

    const solicitud = {
      distribucion,
      num_variables: numVariables,
      num_observaciones: numObservaciones,
      modo_parametro: modo,
      confianza,
    };
    if (semilla !== null) solicitud.semilla = semilla;

    if (modo === "global") {
      const input = $("#parametroGlobal");
      const valor = leerParametro(input);
      const maximo = poisson ? MAX_LAMBDA_POISSON : MAX_PARAMETRO_EXPONENCIAL;
      if (valor === null || valor <= 0 || valor > maximo) {
        marcarErrorCampo(
          "parametro_global",
          poisson
            ? `λ debe ser mayor que 0 y como máximo ${formatoEntero.format(MAX_LAMBDA_POISSON)}.`
            : "El parámetro debe ser mayor que 0 y menor o igual a 1,000,000,000."
        );
        return null;
      }
      solicitud.parametro_global = valor;
      if (!poisson) solicitud.tipo_parametro_global = $("#tipoParametroGlobal").value;
    } else {
      const filas = $$("#variablesPersonalizadas .mc-variable-row");
      const variables = [];
      for (const fila of filas) {
        const indice = Number(fila.dataset.indice) + 1;
        const nombre = fila.querySelector(".mc-variable-nombre").value.trim();
        const tipo = poisson
          ? "lambda"
          : fila.querySelector(".mc-variable-tipo").value;
        const input = fila.querySelector(".mc-variable-parametro");
        const valor = leerParametro(input);
        const maximo = poisson ? MAX_LAMBDA_POISSON : MAX_PARAMETRO_EXPONENCIAL;
        if (valor === null || valor <= 0 || valor > maximo) {
          input.classList.add("is-invalid");
          input.setAttribute("aria-invalid", "true");
          input.focus();
          const alerta = $("#variablesError");
          alerta.textContent = `Revisa el parámetro de V${indice}: debe ser mayor que 0${
            poisson ? ` y como máximo ${formatoEntero.format(MAX_LAMBDA_POISSON)}` : ""
          }.`;
          alerta.classList.remove("d-none");
          return null;
        }
        variables.push({
          nombre: nombre || `V${indice}`,
          tipo_parametro: tipo,
          parametro: valor,
        });
      }
      solicitud.variables = variables;
    }

    return solicitud;
  }

  async function manejarSubmitSimulacion(evento) {
    evento.preventDefault();
    limpiarErroresFormulario();
    const solicitud = construirSolicitud();
    if (!solicitud) return;

    const boton = $("#btnSimular");
    setBotonCargando(boton, true, "Simulando…");
    try {
      const respuesta = await apiFetch("/api/montecarlo/simular", {
        method: "POST",
        body: solicitud,
        timeout: 240000,
      });
      aplicarSimulacion(respuesta.simulacion);
      state.historialCargado = false;
      void cargarHistorial({ silent: true });
      notificar("Simulación realizada y guardada correctamente.", "success");
    } catch (error) {
      if (error.campo) {
        marcarErrorCampo(error.campo, error.message);
      } else {
        mostrarErrorFormulario(error.message);
      }
      notificar(error.message, "danger");
    } finally {
      setBotonCargando(boton, false);
    }
  }

  function cargarEjemplo() {
    $("#distribucion").value = "poisson";
    $("#numVariables").value = "3";
    $("#numObservaciones").value = "1000";
    $("#modoParametro").value = "global";
    $("#tipoParametroGlobal").value = "media";
    $("#parametroGlobal").value = "4";
    $("#confianza").value = "0.95";
    $("#semilla").value = "";
    limpiarErroresFormulario();
    actualizarFormularioDistribucion({ preservar: false });
    actualizarModoParametro();
    notificar("Ejemplo cargado. Presiona Simular para generar la base.", "info");
    $("#parametroGlobal").focus();
  }

  function limpiarAplicacion({ silencioso = false } = {}) {
    $("#formSimulacion").reset();
    $("#numVariables").value = "3";
    $("#numObservaciones").value = "1000";
    $("#modoParametro").value = "global";
    $("#confianza").value = "0.95";
    $("#distribucion").value = "poisson";
    limpiarErroresFormulario();
    actualizarFormularioDistribucion({ preservar: false });
    actualizarModoParametro();

    state.simulacion = null;
    state.detalleVariable = null;
    state.detalleVariableIndice = null;
    state.variableActual = 0;
    state.datosCargado = false;
    state.datosOffset = 0;
    state.chartsDirty = true;
    destruirGraficas();

    $("#estadoVacio").classList.remove("d-none");
    $("#resumenContenido").classList.add("d-none");
    $("#datosVacio").classList.remove("d-none");
    $("#datosContenido").classList.add("d-none");
    $("#transformadaVacia").classList.remove("d-none");
    $("#transformadaContenido").classList.add("d-none");
    $("#graficasVacio").classList.remove("d-none");
    $("#graficasContenido").classList.add("d-none");
    $("#tablaResumen").innerHTML = "";
    $("#tablaDatos").innerHTML = "";
    $("#tablaTransformada").innerHTML = "";
    $("#interpretacion").innerHTML = "";
    $("#advertenciasSimulacion").innerHTML = "";
    $("#printModelo").textContent = "—";
    $("#printFecha").textContent = "";
    actualizarBotonesReporte();
    activarTab("tab-resumen");
    if (!silencioso) notificar("Formulario y resultados limpiados.", "info");
  }

  /* ========================================================================
     Render del resumen
     ======================================================================== */

  function aplicarSimulacion(simulacion) {
    if (!simulacion) return;
    state.simulacion = simulacion;
    state.variableActual = 0;
    state.detalleVariable = null;
    state.detalleVariableIndice = null;
    state.datosCargado = false;
    state.datosOffset = 0;
    state.tokenDatos += 1;
    state.chartsDirty = true;
    state.variableU = 0;
    destruirGraficas();

    $("#estadoVacio").classList.add("d-none");
    $("#resumenContenido").classList.remove("d-none");
    $("#datosVacio").classList.add("d-none");
    $("#datosContenido").classList.remove("d-none");
    $("#transformadaVacia").classList.add("d-none");
    $("#transformadaContenido").classList.remove("d-none");
    $("#graficasVacio").classList.add("d-none");
    $("#graficasContenido").classList.remove("d-none");

    $("#simulacionId").textContent = `Simulación #${simulacion.id ?? 0}`;
    $("#simulacionFecha").textContent = formatearFecha(simulacion.timestamp);
    $("#badgeDistribucion").textContent = etiquetaDistribucion(simulacion);
    $("#printModelo").textContent = `${etiquetaDistribucion(simulacion)} · ${
      simulacion.num_variables
    } variables · ${fmtEntero(simulacion.num_observaciones)} observaciones`;
    $("#printFecha").textContent = formatearFecha(simulacion.timestamp);

    renderResumen(simulacion);
    prepararSelectores(simulacion);
    sincronizarFormulario(simulacion);
    actualizarBotonesReporte();
    actualizarBotonSiguiente();

    if ($("#pane-datos").classList.contains("active")) {
      void cargarDatos({ offset: 0 });
    }
    if ($("#pane-transformada").classList.contains("active")) {
      void asegurarDetalleVariable(state.variableActual, { forzar: true });
    }
    if ($("#pane-graficas").classList.contains("active")) {
      void asegurarGraficas(true);
    }
  }

  function modoParametroTexto(simulacion) {
    if (simulacion.modo_parametro === "personalizado") {
      return "parámetros personalizados por variable";
    }
    const global = simulacion.parametro_global || {};
    if (simulacion.distribucion === "poisson") {
      return `parámetro global λ = ${fmtNumero(global.parametro)}`;
    }
    if (global.tipo_parametro === "tasa") {
      return `parámetro global λ = ${fmtNumero(global.parametro)} (b = ${fmtDecimal(
        global.media,
        6
      )})`;
    }
    return `parámetro global b = ${fmtNumero(global.parametro)} (λ = ${fmtDecimal(
      global.tasa,
      6
    )})`;
  }

  function renderResumen(simulacion) {
    const variables = simulacion.variables || [];
    const global = simulacion.resumen_global || {};

    $("#kpiObservaciones").textContent = fmtEntero(simulacion.num_observaciones);
    $("#kpiVariables").textContent = fmtEntero(simulacion.num_variables);
    $("#kpiConfianza").textContent = fmtPorcentaje(
      (Number(simulacion.confianza) || CONFIANZA_POR_DEFECTO) * 100,
      0
    );
    $("#kpiSemilla").textContent = fmtEntero(simulacion.semilla);

    $("#resumenConfiguracion").textContent = `${etiquetaDistribucion(
      simulacion
    )} · ${simulacion.num_variables} variables · ${fmtEntero(
      simulacion.num_observaciones
    )} observaciones · ${modoParametroTexto(simulacion)} · nivel de confianza ${fmtPorcentaje(
      (Number(simulacion.confianza) || CONFIANZA_POR_DEFECTO) * 100,
      0
    )}.`;

    $("#tablaResumen").innerHTML = variables
      .map((variable) => {
        const dentro =
          Number(variable.ic_inferior) <= Number(variable.media_teorica) &&
          Number(variable.media_teorica) <= Number(variable.ic_superior);
        return `
          <tr>
            <th scope="row">${escaparHTML(variable.nombre)}</th>
            <td>${escaparHTML(variable.parametro_etiqueta || "—")}</td>
            <td class="num">${fmtNumero(variable.media_teorica)}</td>
            <td class="num">${fmtNumero(variable.media_simulada)}</td>
            <td class="num">${fmtNumero(variable.desviacion_teorica)}</td>
            <td class="num">${fmtNumero(variable.desviacion_simulada)}</td>
            <td class="num">${fmtNumero(variable.error_tipico)}</td>
            <td class="num">${fmtPorcentaje(variable.error_relativo_pct)}</td>
            <td class="num">${fmtNumero(variable.minimo)}</td>
            <td class="num">${fmtNumero(variable.maximo)}</td>
            <td class="num">
              <span class="mc-ic ${dentro ? "mc-ic-ok" : "mc-ic-fuera"}">
                [${fmtNumero(variable.ic_inferior)}, ${fmtNumero(variable.ic_superior)}]
                <span class="visually-hidden">${dentro ? "contiene la media teórica" : "no contiene la media teórica"}</span>
              </span>
            </td>
          </tr>`;
      })
      .join("");

    renderInterpretacion(simulacion);
    renderAdvertencias(simulacion);
  }

  function lecturasSimulacion(simulacion) {
    const variables = simulacion.variables || [];
    const global = simulacion.resumen_global || {};
    const nivel = fmtPorcentaje((Number(simulacion.confianza) || 0.95) * 100, 0);
    const bullets = [];

    bullets.push(
      `Se generaron ${fmtEntero(simulacion.num_observaciones)} observaciones para ${
        simulacion.num_variables
      } variable${simulacion.num_variables === 1 ? "" : "s"} con distribución ${etiquetaDistribucion(
        simulacion
      )}.`
    );
    bullets.push(
      `La media simulada promedio es ${fmtNumero(
        global.media_simulada_promedio
      )}, frente a una media teórica promedio de ${fmtNumero(
        global.media_teorica_promedio
      )}; el error relativo promedio es ${fmtPorcentaje(
        global.error_relativo_promedio_pct
      )}.`
    );
    bullets.push(
      `El intervalo de confianza al ${nivel} contiene la media teórica en ${fmtEntero(
        global.variables_en_intervalo
      )} de ${fmtEntero(simulacion.num_variables)} variables (cobertura ${fmtPorcentaje(
        global.cobertura_ic_pct
      )}).`
    );

    if (variables.length) {
      const peor = [...variables].sort(
        (a, b) => Number(b.error_relativo_pct) - Number(a.error_relativo_pct)
      )[0];
      bullets.push(
        `La variable con mayor error relativo es ${peor.nombre} (${fmtPorcentaje(
          peor.error_relativo_pct
        )}); al aumentar las observaciones, la media simulada tiende a la teórica.`
      );
    }

    if (simulacion.distribucion === "poisson") {
      bullets.push(
        "En Poisson, la media y la varianza teóricas son iguales a λ, por lo que la desviación teórica es √λ."
      );
    } else {
      bullets.push(
        "En Exponencial, la media y la desviación estándar teóricas son iguales a b; cada valor se obtuvo con x = −b · ln(u)."
      );
    }
    bullets.push(
      `La semilla ${fmtEntero(
        simulacion.semilla
      )} reproduce exactamente esta base de datos si se repite la misma configuración.`
    );

    return bullets;
  }

  function renderInterpretacion(simulacion) {
    $("#interpretacion").innerHTML = lecturasSimulacion(simulacion)
      .map((texto) => `<li>${escaparHTML(texto)}</li>`)
      .join("");
  }

  function renderAdvertencias(simulacion) {
    const contenedor = $("#advertenciasSimulacion");
    const fuera = (simulacion.variables || []).filter((variable) => {
      return !(
        Number(variable.ic_inferior) <= Number(variable.media_teorica) &&
        Number(variable.media_teorica) <= Number(variable.ic_superior)
      );
    });
    if (!fuera.length) {
      contenedor.innerHTML = "";
      return;
    }
    contenedor.innerHTML = `
      <div class="alert alert-warning mc-alert" role="status">
        <strong>Revisa la convergencia.</strong>
        La media teórica queda fuera del intervalo de confianza en
        ${fuera.map((variable) => escaparHTML(variable.nombre)).join(", ")}.
        Aumenta las observaciones o cambia la semilla para estabilizar la estimación.
      </div>`;
  }

  function prepararSelectores(simulacion) {
    const variables = simulacion.variables || [];
    const opciones = variables
      .map(
        (variable, indice) =>
          `<option value="${indice}">${escaparHTML(variable.nombre)} · ${escaparHTML(
            variable.parametro_etiqueta || ""
          )}</option>`
      )
      .join("");

    ["#variableTransformada", "#variableGraficas"].forEach((selector) => {
      const select = $(selector);
      select.innerHTML = opciones;
      select.value = String(state.variableActual);
    });

    const selectU = $("#variableU");
    const columnasU = Math.min(MAX_COLUMNAS_U, variables.length);
    selectU.innerHTML = variables
      .slice(0, columnasU)
      .map(
        (variable, indice) =>
          `<option value="${indice}">${escaparHTML(variable.nombre)}</option>`
      )
      .join("");
    selectU.value = String(state.variableU);
    selectU.disabled = !state.mostrarU || columnasU === 0;

    const nombreVariable = variables[state.variableActual]?.nombre || "V1";
    $("#transformadaVariableInfo").textContent = nombreVariable;
    $("#graficasVariableInfo").textContent = nombreVariable;
  }

  function sincronizarFormulario(simulacion) {
    const variables = simulacion.variables || [];
    if (!variables.length) return;
    const primera = variables[0];

    $("#distribucion").value = simulacion.distribucion || "poisson";
    $("#numVariables").value = String(simulacion.num_variables || variables.length);
    $("#numObservaciones").value = String(simulacion.num_observaciones || 1000);
    $("#modoParametro").value =
      simulacion.modo_parametro === "personalizado" ? "personalizado" : "global";
    $("#confianza").value = String(simulacion.confianza || CONFIANZA_POR_DEFECTO);
    $("#semilla").value =
      simulacion.semilla_solicitada === null ||
      simulacion.semilla_solicitada === undefined
        ? String(simulacion.semilla ?? "")
        : String(simulacion.semilla_solicitada);

    const global = simulacion.parametro_global || {};
    if (global.parametro !== undefined) {
      $("#parametroGlobal").value = String(global.parametro);
    } else {
      $("#parametroGlobal").value = String(primera.parametro ?? "");
    }
    if (global.tipo_parametro) {
      $("#tipoParametroGlobal").value =
        global.tipo_parametro === "tasa" ? "tasa" : "media";
    }

    actualizarFormularioDistribucion({ preservar: true });
    actualizarModoParametro();

    if (simulacion.modo_parametro === "personalizado") {
      const filas = $$("#variablesPersonalizadas .mc-variable-row");
      variables.forEach((variable, indice) => {
        const fila = filas[indice];
        if (!fila) return;
        fila.querySelector(".mc-variable-nombre").value = variable.nombre || `V${indice + 1}`;
        const tipo = fila.querySelector(".mc-variable-tipo");
        if (tipo) tipo.value = variable.tipo_parametro === "tasa" ? "tasa" : "media";
        fila.querySelector(".mc-variable-parametro").value = String(variable.parametro ?? "");
        actualizarFilaVariable(fila);
      });
    }
  }

  /* ========================================================================
     Base de datos paginada
     ======================================================================== */

  function fmtValorVariable(valor) {
    if (esPoisson()) return fmtEntero(valor);
    return fmtDecimal(valor, 6);
  }

  async function cargarDatos({ offset = 0 } = {}) {
    if (!state.simulacion || state.datosCargando) return;

    const token = ++state.tokenDatos;
    state.datosCargando = true;
    const aviso = $("#datosConteo");
    if (aviso) aviso.textContent = "Cargando…";

    try {
      const parametros = new URLSearchParams({
        offset: String(Math.max(0, offset)),
        limite: String(TAMANO_PAGINA_DATOS),
        incluir_u: state.mostrarU ? "1" : "0",
        variable_u: String(state.variableU),
      });
      const respuesta = await apiFetch(
        `/api/montecarlo/simulacion/${state.simulacion.id}/datos?${parametros.toString()}`
      );
      if (token !== state.tokenDatos) return;

      state.datosOffset = respuesta.offset;
      state.datosTotal = respuesta.total;
      state.datosCargado = true;
      renderDatos(respuesta);
    } catch (error) {
      if (token !== state.tokenDatos) return;
      if (aviso) aviso.textContent = "0 filas";
      notificar(error.message, "danger");
    } finally {
      if (token === state.tokenDatos) state.datosCargando = false;
    }
  }

  function renderDatos(respuesta) {
    const variables = respuesta.variables || [];
    const filas = respuesta.filas || [];
    const mostrarU = Boolean(respuesta.incluir_u);
    const variableU = Number(respuesta.variable_u ?? state.variableU);
    const nombreU = variables[variableU] || `V${variableU + 1}`;

    const encabezados = [
      '<th scope="col">Observación</th>',
      ...variables.map(
        (nombre) => `<th scope="col" class="text-end">${escaparHTML(nombre)}</th>`
      ),
    ];
    if (mostrarU) {
      encabezados.push(
        `<th scope="col" class="text-end">u · ${escaparHTML(nombreU)}</th>`
      );
    }
    $("#datosEncabezados").innerHTML = encabezados.join("");

    $("#tablaDatos").innerHTML = filas
      .map((fila) => {
        const celdas = [
          `<th scope="row" class="num">${fmtEntero(fila.observacion)}</th>`,
          ...(fila.valores || []).map(
            (valor) => `<td class="num">${fmtValorVariable(valor)}</td>`
          ),
        ];
        if (mostrarU) {
          celdas.push(`<td class="num mc-u">${fmtDecimal(fila.u, 9)}</td>`);
        }
        return `<tr>${celdas.join("")}</tr>`;
      })
      .join("");

    const total = Number(respuesta.total) || 0;
    const inicio = filas.length ? Number(respuesta.offset) + 1 : 0;
    const fin = Number(respuesta.offset) + filas.length;
    const paginas = Math.max(1, Math.ceil(total / TAMANO_PAGINA_DATOS));
    const pagina = Math.floor(Number(respuesta.offset) / TAMANO_PAGINA_DATOS) + 1;

    $("#datosConteo").textContent = `${fmtEntero(total)} filas · página ${pagina} de ${paginas}`;
    $("#datosPagina").textContent = `Página ${pagina} de ${paginas}`;
    $("#datosPie").textContent = `Mostrando ${fmtEntero(inicio)}–${fmtEntero(
      fin
    )} de ${fmtEntero(total)} observaciones · semilla ${fmtEntero(
      state.simulacion?.semilla
    )} · ${etiquetaDistribucion()}`;

    $("#btnDatosPrimera").disabled = pagina <= 1;
    $("#btnDatosAnterior").disabled = pagina <= 1;
    $("#btnDatosSiguiente").disabled = pagina >= paginas;
    $("#btnDatosUltima").disabled = pagina >= paginas;

    const nota = $("#datosNotaU");
    if (mostrarU) {
      nota.textContent = esPoisson()
        ? `La columna u muestra el número pseudoaleatorio de ${nombreU}. Con la transformada inversa se elige el menor k tal que F(k) ≥ u. Solo se registran los números u de las primeras ${Math.min(
            MAX_COLUMNAS_U,
            variables.length
          )} variables para mantener la base ligera.`
        : `La columna u muestra el número pseudoaleatorio de ${nombreU}. Cada valor se obtiene como x = −b · ln(u). Solo se registran los números u de las primeras ${Math.min(
            MAX_COLUMNAS_U,
            variables.length
          )} variables para mantener la base ligera.`;
    } else {
      nota.textContent = esPoisson()
        ? "Activa «Mostrar u» para comprobar el número pseudoaleatorio que genera cada valor de la columna seleccionada."
        : "Activa «Mostrar u» para comprobar el número pseudoaleatorio usado en x = −b · ln(u) para la columna seleccionada.";
    }
  }

  function irAPaginaDatos(offset) {
    if (state.datosCargando || !state.simulacion) return;
    const destino = Math.max(
      0,
      Math.min(
        Math.max(0, state.datosTotal - 1),
        Math.floor(offset / TAMANO_PAGINA_DATOS) * TAMANO_PAGINA_DATOS
      )
    );
    if (destino === state.datosOffset && state.datosCargado) return;
    void cargarDatos({ offset: destino });
  }

  /* ========================================================================
     Transformada y frecuencias
     ======================================================================== */

  async function asegurarDetalleVariable(indice, { forzar = false } = {}) {
    if (!state.simulacion) return null;
    if (
      !forzar &&
      state.detalleVariableIndice === indice &&
      state.detalleVariable
    ) {
      return state.detalleVariable;
    }
    if (state.detalleVariableCargando && state.detalleVariableIndice === indice) {
      return state.detalleVariable;
    }

    const token = ++state.tokenVariable;
    state.detalleVariableCargando = true;
    $("#transformadaNota").textContent = "Cargando tabla…";
    $("#tablaTransformada").innerHTML = "";

    try {
      const respuesta = await apiFetch(
        `/api/montecarlo/simulacion/${state.simulacion.id}/variable/${indice}`
      );
      if (token !== state.tokenVariable) return null;
      state.detalleVariable = respuesta.variable;
      state.detalleVariableIndice = indice;
      renderTransformada(respuesta);
      state.chartsDirty = true;
      if ($("#pane-graficas").classList.contains("active")) {
        void asegurarGraficas(true);
      }
      return respuesta.variable;
    } catch (error) {
      if (token !== state.tokenVariable) return null;
      $("#transformadaNota").textContent = "";
      notificar(error.message, "danger");
      return null;
    } finally {
      if (token === state.tokenVariable) state.detalleVariableCargando = false;
    }
  }

  function renderTransformada(detalle) {
    const variable = detalle.variable;
    const poisson = detalle.distribucion === "poisson";
    const tabla = variable.tabla || [];
    const info = variable.tabla_info || {};

    $("#transformadaVariableInfo").textContent = variable.nombre;
    $("#transformadaNota").textContent = info.nota || "";
    $("#transformadaTitulo").textContent = poisson
      ? "Tabla de transformada inversa"
      : "Tabla de frecuencias por intervalo";
    $("#transformadaSubtitulo").textContent = poisson
      ? "Rango del número pseudoaleatorio u que produce cada valor k de Poisson."
      : "Intervalos de clase, frecuencias observadas y densidad teórica de la Exponencial.";
    $("#transformadaConteo").textContent = `${fmtEntero(tabla.length)} filas`;

    if (poisson) {
      $("#transformadaEncabezados").innerHTML = `
        <tr>
          <th scope="col">k</th>
          <th scope="col" class="text-end">P(X = k)</th>
          <th scope="col" class="text-end">F(k)</th>
          <th scope="col">Intervalo de u</th>
          <th scope="col" class="text-end">Frecuencia</th>
          <th scope="col" class="text-end">Frec. relativa</th>
          <th scope="col" class="text-end">Frec. acumulada</th>
        </tr>`;
      $("#tablaTransformada").innerHTML = tabla
        .map(
          (fila) => `
            <tr>
              <th scope="row">${escaparHTML(fila.etiqueta)}</th>
              <td class="num">${fmtDecimal(fila.p, 8)}</td>
              <td class="num">${fmtDecimal(fila.acumulada, 8)}</td>
              <td class="mc-intervalo">${escaparHTML(fila.intervalo)}</td>
              <td class="num">${fmtEntero(fila.frecuencia)}</td>
              <td class="num">${fmtDecimal(fila.frecuencia_relativa, 6)}</td>
              <td class="num">${fmtDecimal(fila.frecuencia_acumulada, 6)}</td>
            </tr>`
        )
        .join("");
      return;
    }

    $("#transformadaEncabezados").innerHTML = `
      <tr>
        <th scope="col">Intervalo</th>
        <th scope="col" class="text-end">Marca de clase</th>
        <th scope="col" class="text-end">P(intervalo)</th>
        <th scope="col" class="text-end">F(x)</th>
        <th scope="col" class="text-end">Frecuencia</th>
        <th scope="col" class="text-end">Densidad empírica</th>
        <th scope="col" class="text-end">f(x) teórica</th>
      </tr>`;
    $("#tablaTransformada").innerHTML = tabla
      .map(
        (fila) => `
          <tr>
            <th scope="row" class="mc-intervalo">${escaparHTML(fila.intervalo)}</th>
            <td class="num">${fmtDecimal(fila.marca_clase, 6)}</td>
            <td class="num">${fmtDecimal(fila.probabilidad_teorica, 8)}</td>
            <td class="num">${fmtDecimal(fila.acumulada, 8)}</td>
            <td class="num">${fmtEntero(fila.frecuencia)}</td>
            <td class="num">${fmtDecimal(fila.densidad, 6)}</td>
            <td class="num">${fmtDecimal(fila.densidad_teorica, 6)}</td>
          </tr>`
      )
      .join("");
  }

  /* ========================================================================
     Gráficas
     ======================================================================== */

  function paletaGraficas() {
    const oscuro = document.documentElement.dataset.tema === "oscuro";
    return {
      tick: oscuro ? "#f8fafc" : "#8491a5",
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
    if (!state.simulacion) return;
    destruirGraficas();
    if ($("#pane-graficas").classList.contains("active")) {
      void asegurarGraficas(false);
    }
  }

  function destruirGraficas() {
    Object.values(state.charts).forEach((grafica) => {
      try {
        grafica?.destroy();
      } catch {
        /* sin acción */
      }
    });
    state.charts = { distribucion: null, cdf: null, convergencia: null };
    state.chartsDirty = true;
  }

  function tablaParaGraficas(tabla) {
    if (!Array.isArray(tabla) || tabla.length <= 2) return tabla || [];
    const utiles = tabla.filter((fila) => {
      const teorica = numero(fila.p ?? fila.probabilidad_teorica) ?? 0;
      const observada = numero(fila.frecuencia_relativa) ?? 0;
      return teorica > 0.000001 || observada > 0.00001;
    });
    return utiles.length >= 2 ? utiles : tabla;
  }

  function muestrearTabla(tabla, maximo = MAX_PUNTOS_GRAFICA) {
    if (tabla.length <= maximo) return tabla;
    const paso = (tabla.length - 1) / (maximo - 1);
    return Array.from({ length: maximo }, (_, indice) => {
      return tabla[Math.round(indice * paso)];
    });
  }

  function opcionesBase(paleta) {
    return {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      animation: { duration: 420 },
      plugins: {
        legend: {
          position: "top",
          align: "end",
          labels: {
            color: paleta.tick,
            usePointStyle: true,
            boxWidth: 9,
            boxHeight: 9,
            padding: 14,
          },
        },
        tooltip: {
          backgroundColor: paleta.tooltipBg,
          borderColor: paleta.tooltipBorder,
          borderWidth: 1,
          padding: 10,
          cornerRadius: 8,
          titleColor: "#f8fafc",
          bodyColor: "#e2e8f0",
          displayColors: true,
        },
      },
      scales: {
        x: {
          grid: { display: false },
          border: { display: false },
          ticks: {
            color: paleta.tick,
            maxRotation: 0,
            autoSkip: true,
            maxTicksLimit: 12,
            font: { size: 10.5 },
          },
        },
        y: {
          beginAtZero: true,
          grid: { color: paleta.grid, drawTicks: false },
          border: { display: false },
          ticks: {
            color: paleta.tick,
            padding: 6,
            font: { size: 10.5 },
          },
        },
      },
    };
  }

  function renderGraficas() {
    if (!window.Chart) {
      notificar("Chart.js no está disponible para dibujar las gráficas.", "danger");
      return false;
    }
    if (!state.simulacion || !state.detalleVariable) return false;

    destruirGraficas();
    const variable = state.detalleVariable;
    const poisson = esPoisson();
    const tabla = muestrearTabla(tablaParaGraficas(variable.tabla || []));
    const paleta = paletaGraficas();
    const etiquetas = tabla.map((fila) => fila.etiqueta);

    const opcionesDistribucion = opcionesBase(paleta);
    opcionesDistribucion.scales.y.ticks.callback = (valor) => fmtDecimal(valor, 4);
    opcionesDistribucion.plugins.tooltip.callbacks = {
      label: (contexto) =>
        `${contexto.dataset.label}: ${fmtDecimal(contexto.parsed.y, 6)}`,
    };

    const datasetEmpirico = {
      type: "bar",
      label: "Frecuencia relativa simulada",
      data: tabla.map((fila) => fila.frecuencia_relativa),
      backgroundColor: "rgba(79, 70, 229, 0.55)",
      borderColor: "rgba(79, 70, 229, 0.9)",
      borderWidth: 1,
      borderRadius: 3,
      maxBarThickness: 26,
      order: 2,
    };
    const datasetTeorico = {
      type: "line",
      label: poisson ? "P(X = k) teórica" : "P(intervalo) teórica",
      data: tabla.map((fila) => (poisson ? fila.p : fila.probabilidad_teorica)),
      borderColor: "#06b6d4",
      backgroundColor: "#06b6d4",
      borderWidth: 2.2,
      pointRadius: tabla.length > 24 ? 0 : 2.4,
      pointBackgroundColor: "#06b6d4",
      pointBorderColor: paleta.pointBorder,
      pointBorderWidth: 1.2,
      tension: 0.25,
      fill: false,
      order: 1,
    };

    state.charts.distribucion = new window.Chart(
      $("#graficaDistribucion"),
      {
        type: "bar",
        data: { labels: etiquetas, datasets: [datasetEmpirico, datasetTeorico] },
        options: opcionesDistribucion,
      }
    );

    const opcionesCDF = opcionesBase(paleta);
    opcionesCDF.scales.y.max = 1;
    opcionesCDF.scales.y.ticks.callback = (valor) => fmtDecimal(valor, 2);
    opcionesCDF.plugins.tooltip.callbacks = {
      label: (contexto) =>
        `${contexto.dataset.label}: ${fmtDecimal(contexto.parsed.y, 6)}`,
    };

    state.charts.cdf = new window.Chart($("#graficaCDF"), {
      type: "line",
      data: {
        labels: etiquetas,
        datasets: [
          {
            label: "F acumulada simulada",
            data: tabla.map((fila) => fila.frecuencia_acumulada),
            borderColor: "#4f46e5",
            backgroundColor: "rgba(79, 70, 229, 0.12)",
            borderWidth: 2.2,
            pointRadius: tabla.length > 24 ? 0 : 2.2,
            pointBackgroundColor: "#4f46e5",
            pointBorderColor: paleta.pointBorder,
            pointBorderWidth: 1.2,
            tension: 0.2,
            fill: true,
          },
          {
            label: "F(x) teórica",
            data: tabla.map((fila) => fila.acumulada),
            borderColor: "#06b6d4",
            borderWidth: 2,
            borderDash: [5, 4],
            pointRadius: 0,
            tension: 0.2,
            fill: false,
          },
        ],
      },
      options: opcionesCDF,
    });

    const puntos = variable.convergencia || [];
    const opcionesConvergencia = opcionesBase(paleta);
    opcionesConvergencia.scales.y.beginAtZero = false;
    opcionesConvergencia.scales.y.ticks.callback = (valor) => fmtDecimal(valor, 4);
    opcionesConvergencia.plugins.tooltip.callbacks = {
      label: (contexto) =>
        `${contexto.dataset.label}: ${fmtDecimal(contexto.parsed.y, 6)}`,
    };

    state.charts.convergencia = new window.Chart($("#graficaConvergencia"), {
      type: "line",
      data: {
        labels: puntos.map((punto) => punto.n),
        datasets: [
          {
            label: "Media acumulada simulada",
            data: puntos.map((punto) => punto.media),
            borderColor: "#4f46e5",
            backgroundColor: "rgba(79, 70, 229, 0.12)",
            borderWidth: 2.2,
            pointRadius: 0,
            tension: 0.25,
            fill: true,
          },
          {
            label: "Media teórica",
            data: puntos.map((punto) => punto.media_teorica),
            borderColor: "#f59e0b",
            borderWidth: 1.8,
            borderDash: [6, 4],
            pointRadius: 0,
            fill: false,
          },
        ],
      },
      options: opcionesConvergencia,
    });

    $("#subtituloDistribucion").textContent = poisson
      ? "Frecuencia relativa observada y probabilidad teórica P(X = k)."
      : "Frecuencia relativa observada y probabilidad teórica del intervalo de clase.";
    $("#simboloDistribucion").textContent = poisson ? "P(X = k)" : "f(x)";
    $("#graficasNota").textContent = poisson
      ? `Comparación de la tabla de transformada inversa para ${variable.nombre}. Cada barra es la frecuencia observada y la línea la probabilidad de Poisson.`
      : `Histograma de ${variable.tabla_info?.bins ?? 0} intervalos para ${variable.nombre}. La línea compara la probabilidad teórica del intervalo.`;

    state.chartsDirty = false;
    return true;
  }

  async function asegurarGraficas(forzar = false) {
    if (!state.simulacion) return false;
    const panel = $("#pane-graficas");
    if (!panel.classList.contains("active")) {
      if (!forzar) return false;
      activarTab("tab-graficas");
      await esperar(120);
    }

    if (!state.detalleVariable || state.detalleVariableIndice !== state.variableActual) {
      const detalle = await asegurarDetalleVariable(state.variableActual, {
        forzar: true,
      });
      if (!detalle) return false;
    }

    if (state.chartsDirty || !state.charts.distribucion) {
      const dibujadas = renderGraficas();
      if (!dibujadas) return false;
    }

    await esperar(160);
    Object.values(state.charts).forEach((grafica) => grafica?.resize());
    await esperar(90);
    return true;
  }

  function obtenerImagenesGraficas() {
    if (!state.charts.distribucion || !state.charts.cdf) {
      throw new Error("No se pudieron preparar las gráficas del reporte.");
    }
    return {
      distribucion: state.charts.distribucion.toBase64Image("image/png", 1),
      cdf: state.charts.cdf.toBase64Image("image/png", 1),
      convergencia: state.charts.convergencia?.toBase64Image("image/png", 1) || null,
    };
  }

  async function obtenerGraficasParaReporte() {
    const preparadas = await asegurarGraficas(true);
    if (!preparadas) {
      throw new Error("No se pudieron preparar las gráficas del reporte.");
    }
    await esperar(220);
    return obtenerImagenesGraficas();
  }

  /* ========================================================================
     Historial
     ======================================================================== */

  function actualizarConteoHistorial(total) {
    state.historialTotal = Math.max(0, Number(total) || 0);
    const contador = $("#historialCount");
    if (contador) contador.textContent = fmtEntero(state.historialTotal);
    const info = $("#historialInfo");
    if (info) {
      info.textContent = state.historialTotal
        ? `${fmtEntero(state.historialTotal)} ${
            state.historialTotal === 1
              ? "simulación guardada"
              : "simulaciones guardadas"
          } en SQLite.`
        : "Las simulaciones Monte Carlo se guardan automáticamente en SQLite.";
    }
  }

  async function cargarHistorial({ silent = false, offset = state.historialOffset } = {}) {
    if (state.historialCargando) return;
    state.historialCargando = true;

    if (!silent) {
      $("#historialCargando").classList.remove("d-none");
      $("#historialVacio").classList.add("d-none");
      $("#historialTablaWrap").classList.add("d-none");
      $("#historialPaginacion").classList.add("d-none");
    }

    try {
      const parametros = new URLSearchParams({
        limite: String(state.historialLimite),
        offset: String(Math.max(0, Number(offset) || 0)),
      });
      const respuesta = await apiFetch(
        `/api/montecarlo/historial?${parametros.toString()}`
      );
      state.historialCargado = true;
      renderHistorial(respuesta);
    } catch (error) {
      $("#historialCargando").classList.add("d-none");
      if (!silent) notificar(error.message, "danger");
    } finally {
      state.historialCargando = false;
    }
  }

  function renderHistorial(respuesta) {
    const simulaciones = respuesta.simulaciones || [];
    state.historialOffset = Number(respuesta.offset) || 0;
    state.historialTotal = Number(respuesta.total) || 0;
    state.historialLimite = Number(respuesta.limite) || state.historialLimite;
    actualizarConteoHistorial(respuesta.total);

    $("#historialCargando").classList.add("d-none");
    const vacio = simulaciones.length === 0;
    $("#historialVacio").classList.toggle("d-none", !vacio);
    $("#historialTablaWrap").classList.toggle("d-none", vacio);

    const totalPaginas = Math.max(
      1,
      Math.ceil(state.historialTotal / state.historialLimite)
    );
    const pagina = Math.floor(state.historialOffset / state.historialLimite) + 1;
    $("#historialPaginacion").classList.toggle(
      "d-none",
      vacio || state.historialTotal <= state.historialLimite
    );
    $("#historialPagina").textContent = `Página ${pagina} de ${totalPaginas}`;
    $("#btnHistorialAnterior").disabled = pagina <= 1;
    $("#btnHistorialSiguiente").disabled = pagina >= totalPaginas;

    if (vacio) {
      $("#tablaHistorial").innerHTML = "";
      $("#historialPie").textContent = "";
      return;
    }

    $("#tablaHistorial").innerHTML = simulaciones
      .map((simulacion) => {
        const fecha = formatearFechaCorta(simulacion.timestamp);
        const resumen = simulacion.resumen_global || {};
        return `
          <tr>
            <td class="history-date">
              <strong>${escaparHTML(fecha.fecha)}</strong>
              <small>${escaparHTML(fecha.hora)}</small>
            </td>
            <td>
              <span class="model-badge">${escaparHTML(
                simulacion.distribucion_etiqueta ||
                  (simulacion.distribucion === "poisson" ? "Poisson" : "Exponencial")
              )}</span>
            </td>
            <td class="num">${fmtEntero(simulacion.num_variables)}</td>
            <td class="num">${fmtEntero(simulacion.num_observaciones)}</td>
            <td class="num">${fmtEntero(simulacion.semilla)}</td>
            <td class="num">${fmtNumero(resumen.media_simulada_promedio)}</td>
            <td class="num">${fmtPorcentaje(resumen.error_relativo_promedio_pct)}</td>
            <td class="num mc-history-actions">
              <button type="button" class="btn btn-sm btn-outline-primary"
                data-accion="abrir" data-id="${simulacion.id}" aria-label="Abrir simulación ${simulacion.id}">
                Abrir
              </button>
              <button type="button" class="btn btn-sm btn-outline-danger"
                data-accion="eliminar" data-id="${simulacion.id}" aria-label="Eliminar simulación ${simulacion.id}">
                Eliminar
              </button>
            </td>
          </tr>`;
      })
      .join("");

    const inicio = state.historialOffset + 1;
    const fin = state.historialOffset + simulaciones.length;
    $("#historialPie").textContent = `Mostrando ${fmtEntero(inicio)}–${fmtEntero(
      fin
    )} de ${fmtEntero(state.historialTotal)} simulaciones guardadas.`;
  }

  async function abrirSimulacionHistorial(id) {
    try {
      const respuesta = await apiFetch(`/api/montecarlo/historial/${id}`);
      aplicarSimulacion(respuesta.simulacion);
      activarTab("tab-resumen");
      notificar(`Simulación #${id} cargada desde el historial.`, "info");
    } catch (error) {
      notificar(error.message, "danger");
    }
  }

  async function eliminarSimulacionHistorial(id) {
    const confirmado = window.confirm(
      `¿Eliminar la simulación #${id} del historial? Esta acción no se puede deshacer.`
    );
    if (!confirmado) return;

    try {
      await apiFetch(`/api/montecarlo/historial/${id}`, { method: "DELETE" });
      if (state.simulacion?.id === id) {
        limpiarAplicacion({ silencioso: true });
      }
      notificar("Simulación eliminada correctamente.", "success");
      const offset =
        state.historialOffset > 0 &&
        state.historialOffset >= state.historialTotal - 1
          ? Math.max(0, state.historialOffset - state.historialLimite)
          : state.historialOffset;
      await cargarHistorial({ silent: true, offset });
    } catch (error) {
      notificar(error.message, "danger");
    }
  }

  function manejarAccionHistorial(evento) {
    const boton = evento.target.closest("button[data-accion]");
    if (!boton) return;
    const id = Number(boton.dataset.id);
    if (!Number.isInteger(id) || id <= 0) return;
    if (boton.dataset.accion === "abrir") {
      void abrirSimulacionHistorial(id);
    } else if (boton.dataset.accion === "eliminar") {
      void eliminarSimulacionHistorial(id);
    }
  }

  /* ========================================================================
     Utilidades del PDF
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
      .replace(/λ/g, "lambda")
      .replace(/√/g, "raiz")
      .replace(/≥/g, ">=")
      .replace(/≤/g, "<=")
      .replace(/∞/g, "inf")
      .replace(/−/g, "-")
      .replace(/·/g, "-")
      .replace(/x̄/g, "media")
      .replace(/→/g, "->");
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

  function asegurarEspacioPDF(doc, y, necesario, limite = 278) {
    if (y + necesario <= limite) return y;
    doc.addPage();
    return 20;
  }

  function dibujarLecturaPDF(doc, fuente, unicode, textos, inicioY, anchoPagina) {
    const margen = 14;
    const relleno = 5;
    const ancho = anchoPagina - margen * 2;
    const sangria = 5.4;
    const anchoTexto = ancho - relleno * 2 - sangria;
    const tamano = 8.2;
    const altoLinea = 4;
    const separacion = 2.2;

    const items = textos.map((texto) => (unicode ? texto : textoPlanoPDF(texto)));

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
    doc.setFontSize(10.2);
    doc.setTextColor(248, 250, 252);
    doc.text("Lectura de la simulación", iconoX + 10, iconoY + 5);

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

  function insertarGraficaPDF(doc, fuente, dataUrl, titulo, x, y, ancho, altoMaximo) {
    if (!dataUrl) return 0;
    let propiedades;
    try {
      propiedades = doc.getImageProperties(dataUrl);
    } catch {
      return 0;
    }
    let anchoFinal = ancho;
    let alto = (anchoFinal * propiedades.height) / propiedades.width;
    if (alto > altoMaximo) {
      alto = altoMaximo;
      anchoFinal = (alto * propiedades.width) / propiedades.height;
    }
    doc.setFont(fuente, "bold");
    doc.setFontSize(8.4);
    doc.setTextColor(51, 65, 85);
    doc.text(titulo, x + anchoFinal / 2, y, { align: "center" });
    doc.addImage(
      dataUrl,
      "PNG",
      x + (ancho - anchoFinal) / 2,
      y + 2.5,
      anchoFinal,
      alto,
      undefined,
      "FAST"
    );
    return alto + 7;
  }

  function construirPDF(simulacion, detalle, imagenes, usarFuentes, fondoCabecera) {
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
      ? { lambda: "λ", media: "b", raiz: "√", por: "·", menos: "−" }
      : { lambda: "lambda", media: "b", raiz: "raiz", por: "-", menos: "-" };

    const poisson = simulacion.distribucion === "poisson";
    const anchoPagina = doc.internal.pageSize.getWidth();
    const fecha = formatearFecha(simulacion.timestamp);
    const distribucion = etiquetaDistribucion(simulacion);
    const variables = simulacion.variables || [];
    const global = simulacion.resumen_global || {};
    const variable = detalle?.variable || null;

    doc.setProperties({
      title: `Simulab · Simulación Monte Carlo #${simulacion.id ?? ""}`,
      subject: `Reporte de simulación ${distribucion} con Monte Carlo`,
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
      lecturasSimulacion(simulacion),
      38,
      anchoPagina
    );

    let y = finLectura + 10;
    if (y > 230) {
      doc.addPage();
      y = 20;
    }

    doc.setTextColor(15, 23, 42);
    doc.setFont(fuente, "bold");
    doc.setFontSize(16);
    doc.text("Simulación de base de datos con Monte Carlo", 14, y);
    doc.setFont(fuente, "normal");
    doc.setFontSize(9);
    doc.setTextColor(100, 116, 139);
    doc.text(
      `${distribucion} ${simbolos.por} ${simulacion.num_variables} variables ${simbolos.por} ${fmtEntero(
        simulacion.num_observaciones
      )} observaciones`,
      14,
      y + 7
    );

    const estilosTabla = {
      theme: "grid",
      styles: {
        font: fuente,
        fontSize: 8,
        cellPadding: 2,
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

    const semillaTexto =
      simulacion.semilla_solicitada === null ||
      simulacion.semilla_solicitada === undefined
        ? `${fmtEntero(simulacion.semilla)} (automática)`
        : fmtEntero(simulacion.semilla);

    const parametrosPDF = [
      ["Distribución", distribucion],
      ["Fecha y hora", fecha],
      ["Variables simuladas", `${fmtEntero(simulacion.num_variables)} columnas`],
      [
        "Observaciones",
        `${fmtEntero(simulacion.num_observaciones)} filas ${
          unicode ? "·" : "-"
        } ${fmtEntero(
          simulacion.num_variables * simulacion.num_observaciones
        )} valores`,
      ],
      ["Semilla", semillaTexto],
      [
        "Nivel de confianza",
        `${fmtPorcentaje((Number(simulacion.confianza) || 0.95) * 100, 0)} ${
          unicode ? `(z = ${fmtDecimal(simulacion.z, 4)})` : ""
        }`,
      ],
      ["Parámetros", modoParametroTexto(simulacion)],
      [
        "Cobertura del IC",
        `${fmtPorcentaje(global.cobertura_ic_pct)} (${fmtEntero(
          global.variables_en_intervalo
        )} de ${fmtEntero(simulacion.num_variables)})`,
      ],
    ];

    doc.autoTable({
      ...estilosTabla,
      startY: y + 12,
      head: [["Parámetros de la simulación", "Valor"]],
      body: parametrosPDF,
      columnStyles: { 0: { cellWidth: 62 }, 1: { cellWidth: "auto" } },
    });

    y = doc.lastAutoTable.finalY + 9;
    y = asegurarEspacioPDF(doc, y, 30);
    doc.setFont(fuente, "bold");
    doc.setFontSize(12);
    doc.setTextColor(15, 23, 42);
    doc.text("Resumen comparativo por variable", 14, y);

    const filasResumen = variables.map((item) => [
      item.nombre,
      item.parametro_etiqueta || "—",
      fmtNumero(item.media_teorica),
      fmtNumero(item.media_simulada),
      fmtPorcentaje(item.error_relativo_pct),
      `[${fmtNumero(item.ic_inferior)}, ${fmtNumero(item.ic_superior)}]`,
    ]);

    doc.autoTable({
      ...estilosTabla,
      startY: y + 3,
      head: [
        [
          "Variable",
          "Parámetro",
          "Media teórica",
          "Media simulada",
          "Error rel.",
          "IC de la media",
        ],
      ],
      body: filasResumen,
      styles: { ...estilosTabla.styles, fontSize: 7.2, cellPadding: 1.7 },
      columnStyles: {
        0: { cellWidth: 24 },
        1: { cellWidth: 38 },
        2: { halign: "right", cellWidth: 24 },
        3: { halign: "right", cellWidth: 24 },
        4: { halign: "right", cellWidth: 20 },
        5: { halign: "right" },
      },
    });

    y = doc.lastAutoTable.finalY + 4;
    doc.setFont(fuente, "normal");
    doc.setFontSize(7.2);
    doc.setTextColor(100, 116, 139);
    doc.text(
      "La media teórica de Poisson es λ; en Exponencial la media y la desviación teóricas son b.",
      14,
      y
    );

    // Gráficas
    y += 12;
    y = asegurarEspacioPDF(doc, y, 92);
    doc.setFont(fuente, "bold");
    doc.setFontSize(12);
    doc.setTextColor(15, 23, 42);
    doc.text("Gráficas de la simulación", 14, y);

    const separacionGraficas = 8;
    const anchoColumna = (anchoPagina - 28 - separacionGraficas) / 2;
    const yGraficas = y + 5;
    const altoDistribucion = insertarGraficaPDF(
      doc,
      fuente,
      imagenes.distribucion,
      "Distribución simulada vs. teórica",
      14,
      yGraficas,
      anchoColumna,
      62
    );
    const altoCDF = insertarGraficaPDF(
      doc,
      fuente,
      imagenes.cdf,
      "CDF empírica vs. teórica",
      14 + anchoColumna + separacionGraficas,
      yGraficas,
      anchoColumna,
      62
    );
    y = yGraficas + Math.max(altoDistribucion, altoCDF) + 2;

    if (imagenes.convergencia) {
      y = asegurarEspacioPDF(doc, y, 70);
      y =
        y +
        insertarGraficaPDF(
          doc,
          fuente,
          imagenes.convergencia,
          "Convergencia de la media simulada",
          14,
          y,
          anchoPagina - 28,
          64
        );
    }

    // Tabla de transformada o frecuencias
    const tabla = variable?.tabla || [];
    if (tabla.length) {
      y = asegurarEspacioPDF(doc, y, 44);
      doc.setFont(fuente, "bold");
      doc.setFontSize(12);
      doc.setTextColor(15, 23, 42);
      doc.text(
        poisson
          ? "Tabla de transformada inversa"
          : "Tabla de frecuencias por intervalo",
        14,
        y
      );

      const limite = 32;
      const filas = tabla.slice(0, limite);
      const cabecera = poisson
        ? [
            ["k", "P(X = k)", "F(k)", "Intervalo de u", "Frecuencia"],
          ]
        : [
            ["Intervalo", "Marca", "P(intervalo)", "F(x)", "Frecuencia"],
          ];
      const cuerpo = poisson
        ? filas.map((fila) => [
            fila.etiqueta,
            fmtDecimal(fila.p, 8),
            fmtDecimal(fila.acumulada, 8),
            fila.intervalo,
            fmtEntero(fila.frecuencia),
          ])
        : filas.map((fila) => [
            fila.intervalo,
            fmtDecimal(fila.marca_clase, 6),
            fmtDecimal(fila.probabilidad_teorica, 8),
            fmtDecimal(fila.acumulada, 8),
            fmtEntero(fila.frecuencia),
          ]);

      doc.autoTable({
        ...estilosTabla,
        startY: y + 3,
        head: cabecera,
        body: cuerpo,
        styles: { ...estilosTabla.styles, fontSize: 7, cellPadding: 1.5 },
        columnStyles: poisson
          ? {
              0: { halign: "center" },
              1: { halign: "right" },
              2: { halign: "right" },
              4: { halign: "right" },
            }
          : {
              1: { halign: "right" },
              2: { halign: "right" },
              3: { halign: "right" },
              4: { halign: "right" },
            },
      });

      y = doc.lastAutoTable.finalY + 4;
      const nota = variable?.tabla_info?.nota;
      if (nota) {
        doc.setFont(fuente, "normal");
        doc.setFontSize(7);
        doc.setTextColor(100, 116, 139);
        const lineasNota = doc.splitTextToSize(
          unicode ? nota : textoPlanoPDF(nota),
          anchoPagina - 28
        );
        doc.text(lineasNota, 14, y);
        y += lineasNota.length * 3.4;
      }
      if (tabla.length > limite) {
        doc.setFont(fuente, "italic");
        doc.setFontSize(7);
        doc.setTextColor(100, 116, 139);
        doc.text(
          `Se muestran las primeras ${limite} de ${fmtEntero(
            tabla.length
          )} filas. La tabla completa está disponible en la aplicación.`,
          14,
          y + 2
        );
        y += 6;
      }
    }

    // Muestra de la base de datos
    const vista = simulacion.vista_previa || {};
    const filasMuestra = (vista.filas || []).slice(0, MAX_FILAS_PDF);
    if (filasMuestra.length) {
      y = asegurarEspacioPDF(doc, y, 44);
      doc.setFont(fuente, "bold");
      doc.setFontSize(12);
      doc.setTextColor(15, 23, 42);
      doc.text("Muestra de la base de datos", 14, y);

      const nombres =
        vista.variables && vista.variables.length
          ? vista.variables
          : variables.map((item) => item.nombre);
      const columnas = Math.min(MAX_COLUMNAS_MUESTRA, nombres.length);
      const columnasU = vista.columnas_u || [];
      const encabezado = ["#", ...nombres.slice(0, columnas)];
      if (columnasU.length) encabezado.push("u");

      const cuerpo = filasMuestra.map((fila) => {
        const valores = (fila.valores || [])
          .slice(0, columnas)
          .map((valor) => (poisson ? fmtEntero(valor) : fmtDecimal(valor, 6)));
        const uniforme = columnasU.length
          ? [fmtDecimal((fila.uniformes || [])[0], 9)]
          : [];
        return [fmtEntero(fila.observacion), ...valores, ...uniforme];
      });

      const estilosColumna = { 0: { cellWidth: 12 } };
      for (let indice = 1; indice <= columnas; indice += 1) {
        estilosColumna[indice] = { halign: "right" };
      }
      if (columnasU.length) {
        estilosColumna[columnas + 1] = { halign: "right" };
      }

      doc.autoTable({
        ...estilosTabla,
        startY: y + 3,
        head: [encabezado],
        body: cuerpo,
        styles: { ...estilosTabla.styles, fontSize: 6.9, cellPadding: 1.4 },
        columnStyles: estilosColumna,
      });

      y = doc.lastAutoTable.finalY + 4;
      doc.setFont(fuente, "normal");
      doc.setFontSize(7);
      doc.setTextColor(100, 116, 139);
      doc.text(
        `Primeras ${filasMuestra.length} de ${fmtEntero(
          simulacion.num_observaciones
        )} observaciones. La base completa se pagina de 50 en 50 filas en la aplicación.`,
        14,
        y
      );
    }

    return doc;
  }

  async function generarPDF() {
    if (!state.simulacion) {
      notificar("Realiza una simulación antes de generar el PDF.", "warning");
      return;
    }
    if (state.generandoPDF) return;

    state.generandoPDF = true;
    const boton = $("#btnPDF");
    const pestanaActiva = $("#mainTabs .nav-link.active")?.id;
    setBotonCargando(boton, true, "Generando PDF…");

    try {
      const detalle =
        state.detalleVariableIndice === state.variableActual && state.detalleVariable
          ? state.detalleVariable
          : await asegurarDetalleVariable(state.variableActual, { forzar: true });
      if (!detalle) throw new Error("No se pudo preparar la tabla de la variable.");

      const [fuentes, imagenes, fondoCabecera] = await Promise.all([
        cargarFuentesPDF(),
        obtenerGraficasParaReporte(),
        cargarFondoCabeceraPDF(),
      ]);
      const doc = construirPDF(
        state.simulacion,
        { variable: detalle },
        imagenes,
        Boolean(fuentes),
        fondoCabecera
      );
      if (pestanaActiva) activarTab(pestanaActiva);

      const ahora = new Date();
      const marca = `${ahora.getFullYear()}${String(ahora.getMonth() + 1).padStart(
        2,
        "0"
      )}${String(ahora.getDate()).padStart(2, "0")}_${String(
        ahora.getHours()
      ).padStart(2, "0")}${String(ahora.getMinutes()).padStart(2, "0")}`;
      const tipo = esPoisson() ? "Poisson" : "Exponencial";
      doc.save(`Simulab_MonteCarlo_${tipo}_${marca}.pdf`);
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

  /* ========================================================================
     Reporte de impresión
     ======================================================================== */

  function construirReporteImpresion(simulacion, detalle, imagenes) {
    const poisson = simulacion.distribucion === "poisson";
    const variables = simulacion.variables || [];
    const global = simulacion.resumen_global || {};
    const distribucion = etiquetaDistribucion(simulacion);
    const fecha = formatearFecha(simulacion.timestamp);
    const nivel = fmtPorcentaje(
      (Number(simulacion.confianza) || 0.95) * 100,
      0
    );

    const kpis = [
      ["N", "Observaciones", fmtEntero(simulacion.num_observaciones)],
      ["m", "Variables", fmtEntero(simulacion.num_variables)],
      ["1−α", "Confianza", nivel],
      ["seed", "Semilla", fmtEntero(simulacion.semilla)],
      ["x̄", "Media simulada", fmtNumero(global.media_simulada_promedio)],
      ["E", "Error relativo", fmtPorcentaje(global.error_relativo_promedio_pct)],
      ["IC", "Cobertura", fmtPorcentaje(global.cobertura_ic_pct)],
      ["f", "Distribución", distribucion],
    ];

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

    const lectura = lecturasSimulacion(simulacion)
      .map((texto) => `<li>${escaparHTML(texto)}</li>`)
      .join("");

    const filasResumen = variables
      .map((item) => {
        const dentro =
          Number(item.ic_inferior) <= Number(item.media_teorica) &&
          Number(item.media_teorica) <= Number(item.ic_superior);
        return `
          <tr>
            <th scope="row">${escaparHTML(item.nombre)}</th>
            <td class="simbolo">${escaparHTML(item.parametro_etiqueta || "—")}</td>
            <td class="num">${fmtNumero(item.media_teorica)}</td>
            <td class="num">${fmtNumero(item.media_simulada)}</td>
            <td class="num">${fmtPorcentaje(item.error_relativo_pct)}</td>
            <td class="num">[${fmtNumero(item.ic_inferior)}, ${fmtNumero(item.ic_superior)}]</td>
            <td class="num">${dentro ? "Sí" : "No"}</td>
          </tr>`;
      })
      .join("");

    const tabla = detalle?.tabla || [];
    let bloqueTransformada = "";
    if (tabla.length) {
      const limite = 32;
      const filas = tabla.slice(0, limite);
      const encabezado = poisson
        ? "<tr><th scope=\"col\">k</th><th scope=\"col\" class=\"num\">P(X = k)</th><th scope=\"col\" class=\"num\">F(k)</th><th scope=\"col\">Intervalo de u</th><th scope=\"col\" class=\"num\">Frecuencia</th></tr>"
        : "<tr><th scope=\"col\">Intervalo</th><th scope=\"col\" class=\"num\">Marca</th><th scope=\"col\" class=\"num\">P(intervalo)</th><th scope=\"col\" class=\"num\">F(x)</th><th scope=\"col\" class=\"num\">Frecuencia</th></tr>";
      const cuerpo = poisson
        ? filas
            .map(
              (fila) => `
                <tr>
                  <th scope="row">${escaparHTML(fila.etiqueta)}</th>
                  <td class="num">${fmtDecimal(fila.p, 8)}</td>
                  <td class="num">${fmtDecimal(fila.acumulada, 8)}</td>
                  <td class="simbolo">${escaparHTML(fila.intervalo)}</td>
                  <td class="num">${fmtEntero(fila.frecuencia)}</td>
                </tr>`
            )
            .join("")
        : filas
            .map(
              (fila) => `
                <tr>
                  <th scope="row" class="simbolo">${escaparHTML(fila.intervalo)}</th>
                  <td class="num">${fmtDecimal(fila.marca_clase, 6)}</td>
                  <td class="num">${fmtDecimal(fila.probabilidad_teorica, 8)}</td>
                  <td class="num">${fmtDecimal(fila.acumulada, 8)}</td>
                  <td class="num">${fmtEntero(fila.frecuencia)}</td>
                </tr>`
            )
            .join("");

      bloqueTransformada = `
        <h2 class="pagina-nueva">${
          poisson ? "Tabla de transformada inversa" : "Tabla de frecuencias por intervalo"
        }</h2>
        <p class="nota">${escaparHTML(detalle?.tabla_info?.nota || "")}</p>
        <table>
          <thead>${encabezado}</thead>
          <tbody>${cuerpo}</tbody>
        </table>
        ${
          tabla.length > limite
            ? `<p class="nota">Se muestran las primeras ${limite} de ${fmtEntero(
                tabla.length
              )} filas. La tabla completa está disponible en la aplicación.</p>`
            : ""
        }`;
    }

    const figuras = [
      ["Distribución simulada vs. teórica", "f(x)", imagenes.distribucion],
      ["CDF empírica vs. teórica", "F(x)", imagenes.cdf],
    ]
      .filter(([, , src]) => Boolean(src))
      .map(
        ([titulo, simbolo, src]) => `
          <figure class="grafica">
            <figcaption>
              <span>${escaparHTML(titulo)}</span>
              <span class="grafica-simbolo">${escaparHTML(simbolo)}</span>
            </figcaption>
            <img src="${src}" alt="${escaparHTML(titulo)}">
          </figure>`
      )
      .join("");

    const figuraConvergencia = imagenes.convergencia
      ? `
        <figure class="grafica grafica-ancha">
          <figcaption>
            <span>Convergencia de la media simulada</span>
            <span class="grafica-simbolo">x̄</span>
          </figcaption>
          <img src="${imagenes.convergencia}" alt="Convergencia de la media simulada">
        </figure>`
      : "";

    const vista = simulacion.vista_previa || {};
    const filasMuestra = (vista.filas || []).slice(0, MAX_FILAS_PDF);
    let bloqueMuestra = "";
    if (filasMuestra.length) {
      const nombres =
        vista.variables && vista.variables.length
          ? vista.variables
          : variables.map((item) => item.nombre);
      const columnas = Math.min(MAX_COLUMNAS_MUESTRA, nombres.length);
      const columnasU = vista.columnas_u || [];
      const encabezado = ["#", ...nombres.slice(0, columnas)];
      if (columnasU.length) encabezado.push("u");

      const cuerpo = filasMuestra
        .map((fila) => {
          const valores = (fila.valores || [])
            .slice(0, columnas)
            .map((valor) => (poisson ? fmtEntero(valor) : fmtDecimal(valor, 6)));
          const uniforme = columnasU.length
            ? [fmtDecimal((fila.uniformes || [])[0], 9)]
            : [];
          return `
            <tr>
              <th scope="row">${fmtEntero(fila.observacion)}</th>
              ${[...valores, ...uniforme]
                .map((valor) => `<td class="num">${escaparHTML(valor)}</td>`)
                .join("")}
            </tr>`;
        })
        .join("");

      bloqueMuestra = `
        <h2>Muestra de la base de datos</h2>
        <table>
          <thead>
            <tr>${encabezado
              .map((nombre, indice) =>
                indice === 0
                  ? `<th scope="col">${escaparHTML(nombre)}</th>`
                  : `<th scope="col" class="num">${escaparHTML(nombre)}</th>`
              )
              .join("")}</tr>
          </thead>
          <tbody>${cuerpo}</tbody>
        </table>
        <p class="nota">Primeras ${filasMuestra.length} de ${fmtEntero(
          simulacion.num_observaciones
        )} observaciones. La base completa se pagina de 50 en 50 filas en la aplicación.</p>`;
    }

    return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<title>Simulab · Reporte Monte Carlo</title>
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
    break-inside: auto;
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
    flex-wrap: wrap;
    gap: 4mm;
    margin-top: 2mm;
  }
  .grafica {
    flex: 1 1 calc(50% - 2mm);
    margin: 0;
    padding: 2.6mm;
    border: 0.6pt solid #dbe3ee;
    border-radius: 2.4mm;
    break-inside: avoid;
    page-break-inside: avoid;
  }
  .grafica-ancha {
    flex: 1 1 100%;
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
  .grafica img {
    display: block;
    width: 100%;
    height: auto;
    margin-top: 1.6mm;
  }
</style>
</head>
<body>
  <header class="cabecera">
    <span class="marca">Simulab</span>
    <span class="contexto">Reporte de simulación Monte Carlo · ${escaparHTML(
      distribucion
    )}</span>
    <span class="fecha">${escaparHTML(fecha)}</span>
  </header>

  <h1>Simulación de base de datos con Monte Carlo</h1>
  <p class="meta">Simulación #${escaparHTML(simulacion.id ?? "—")} · ${escaparHTML(
      distribucion
    )} · ${fmtEntero(simulacion.num_variables)} variables · ${fmtEntero(
      simulacion.num_observaciones
    )} observaciones</p>
  <p class="parametros">${escaparHTML(modoParametroTexto(simulacion))} · confianza ${nivel} · semilla ${fmtEntero(
      simulacion.semilla
    )}</p>

  <div class="kpis">${filasKPI}</div>

  <section class="lectura">
    <h2>Lectura de la simulación</h2>
    <ul>${lectura}</ul>
  </section>

  <h2>Resumen comparativo por variable</h2>
  <table>
    <thead>
      <tr>
        <th scope="col">Variable</th>
        <th scope="col">Parámetro</th>
        <th scope="col" class="num">Media teórica</th>
        <th scope="col" class="num">Media simulada</th>
        <th scope="col" class="num">Error rel.</th>
        <th scope="col" class="num">IC de la media</th>
        <th scope="col" class="num">Cubre μ</th>
      </tr>
    </thead>
    <tbody>${filasResumen}</tbody>
  </table>
  <p class="nota">La media teórica de Poisson es λ; en Exponencial la media y la desviación teóricas son iguales a b.</p>

  ${bloqueTransformada}

  <h2 class="pagina-nueva">Gráficas de la simulación</h2>
  <div class="graficas">${figuras}${figuraConvergencia}</div>

  ${bloqueMuestra}

  <p class="nota">Reporte generado por Simulab. La misma semilla reproduce exactamente la base de datos si se repite la misma configuración.</p>
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

  async function imprimirReporte() {
    if (!state.simulacion) {
      notificar("Realiza una simulación antes de imprimir.", "warning");
      return;
    }
    if (state.imprimiendo) return;

    state.imprimiendo = true;
    const boton = $("#btnImprimir");
    const pestanaActiva = $("#mainTabs .nav-link.active")?.id;
    setBotonCargando(boton, true, "Preparando…");

    try {
      const detalle =
        state.detalleVariableIndice === state.variableActual && state.detalleVariable
          ? state.detalleVariable
          : await asegurarDetalleVariable(state.variableActual, { forzar: true });
      if (!detalle) throw new Error("No se pudo preparar la tabla de la variable.");

      const imagenes = await obtenerGraficasParaReporte();
      if (pestanaActiva) activarTab(pestanaActiva);

      await imprimirDocumento(
        construirReporteImpresion(state.simulacion, detalle, imagenes)
      );
    } catch (error) {
      console.error("Error al preparar la impresión:", error);
      notificar(error.message || "No se pudo preparar la impresión.", "danger");
    } finally {
      state.imprimiendo = false;
      setBotonCargando(boton, false);
      actualizarBotonesReporte();
    }
  }

  /* ========================================================================
     Eventos e inicialización
     ======================================================================== */

  function cambiarVariable(indice) {
    if (!state.simulacion) return;
    const variables = state.simulacion.variables || [];
    const destino = Math.max(0, Math.min(variables.length - 1, Number(indice) || 0));
    state.variableActual = destino;
    state.detalleVariable = null;
    state.detalleVariableIndice = null;
    state.chartsDirty = true;
    destruirGraficas();

    const nombre = variables[destino]?.nombre || `V${destino + 1}`;
    $("#transformadaVariableInfo").textContent = nombre;
    $("#graficasVariableInfo").textContent = nombre;
    $("#variableTransformada").value = String(destino);
    $("#variableGraficas").value = String(destino);

    if ($("#pane-graficas").classList.contains("active")) {
      void asegurarGraficas(true);
    } else if ($("#pane-transformada").classList.contains("active")) {
      void asegurarDetalleVariable(destino, { forzar: true });
    }
  }

  function configurarEventos() {
    document.addEventListener("simulab:tema", manejarCambioTema);

    $("#formSimulacion").addEventListener("submit", manejarSubmitSimulacion);
    $("#btnLimpiar").addEventListener("click", () => limpiarAplicacion());
    $("#btnEjemplo").addEventListener("click", cargarEjemplo);

    $("#distribucion").addEventListener("change", () => {
      limpiarErroresFormulario();
      actualizarFormularioDistribucion({ preservar: true });
    });

    $("#tipoParametroGlobal").addEventListener("change", () => {
      actualizarEtiquetaParametroGlobal();
    });

    $("#parametroGlobal").addEventListener("input", () => {
      limpiarErrorCampo($("#parametroGlobal"));
      actualizarEquivalencia();
    });

    $("#modoParametro").addEventListener("change", () => {
      limpiarErroresFormulario();
      actualizarModoParametro();
    });

    ["numVariables", "numObservaciones", "semilla", "confianza"].forEach((id) => {
      const input = document.getElementById(id);
      input.addEventListener("input", () => limpiarErrorCampo(input));
      input.addEventListener("change", () => limpiarErrorCampo(input));
    });

    $("#numVariables").addEventListener("change", () => {
      if ($("#modoParametro").value === "personalizado") {
        actualizarFilasVariables({ preservar: true });
      }
    });

    $("#variablesPersonalizadas").addEventListener("input", (evento) => {
      const objetivo = evento.target;
      if (objetivo.classList.contains("mc-variable-parametro")) {
        limpiarErrorCampo(objetivo);
        $("#variablesError").classList.add("d-none");
      }
    });

    $("#variablesPersonalizadas").addEventListener("change", (evento) => {
      const objetivo = evento.target;
      if (objetivo.classList.contains("mc-variable-tipo")) {
        const fila = objetivo.closest(".mc-variable-row");
        if (fila) actualizarFilaVariable(fila);
      }
    });

    $("#btnRestablecerNombres").addEventListener("click", () => {
      $$("#variablesPersonalizadas .mc-variable-row").forEach((fila, indice) => {
        const entrada = fila.querySelector(".mc-variable-nombre");
        if (entrada) entrada.value = `V${indice + 1}`;
      });
    });

    $("#btnPDF").addEventListener("click", generarPDF);
    $("#btnImprimir").addEventListener("click", imprimirReporte);
    $("#btnSiguienteSeccion").addEventListener("click", irASiguienteSeccion);

    $$("#mainTabs .nav-link").forEach((boton) => {
      boton.addEventListener("shown.bs.tab", actualizarBotonSiguiente);
    });

    $("#tab-datos").addEventListener("shown.bs.tab", () => {
      if (state.simulacion && !state.datosCargado) {
        void cargarDatos({ offset: state.datosOffset });
      }
    });

    $("#tab-transformada").addEventListener("shown.bs.tab", () => {
      if (state.simulacion) {
        void asegurarDetalleVariable(state.variableActual);
      }
    });

    $("#tab-graficas").addEventListener("shown.bs.tab", () => {
      if (state.simulacion) void asegurarGraficas(false);
    });

    $("#tab-historial").addEventListener("shown.bs.tab", () => {
      if (!state.historialCargado) void cargarHistorial();
    });

    $("#variableTransformada").addEventListener("change", (evento) => {
      cambiarVariable(Number(evento.target.value));
    });

    $("#variableGraficas").addEventListener("change", (evento) => {
      cambiarVariable(Number(evento.target.value));
    });

    $("#switchU").addEventListener("change", (evento) => {
      state.mostrarU = evento.target.checked;
      $("#variableU").disabled = !state.mostrarU;
      if (state.simulacion) void cargarDatos({ offset: 0 });
    });

    $("#variableU").addEventListener("change", (evento) => {
      state.variableU = Number(evento.target.value) || 0;
      if (state.simulacion && state.mostrarU) void cargarDatos({ offset: 0 });
    });

    $("#btnDatosPrimera").addEventListener("click", () => irAPaginaDatos(0));
    $("#btnDatosAnterior").addEventListener("click", () =>
      irAPaginaDatos(state.datosOffset - TAMANO_PAGINA_DATOS)
    );
    $("#btnDatosSiguiente").addEventListener("click", () =>
      irAPaginaDatos(state.datosOffset + TAMANO_PAGINA_DATOS)
    );
    $("#btnDatosUltima").addEventListener("click", () => {
      const paginas = Math.max(1, Math.ceil(state.datosTotal / TAMANO_PAGINA_DATOS));
      irAPaginaDatos((paginas - 1) * TAMANO_PAGINA_DATOS);
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

  function iniciar() {
    configurarChartDefaults();
    actualizarFormularioDistribucion({ preservar: false });
    actualizarModoParametro();
    configurarEventos();
    actualizarBotonesReporte();
    actualizarBotonSiguiente();
    actualizarConteoHistorial(0);
    void cargarHistorial({ silent: true });

    const modal = document.getElementById("guiaMC");
    modal?.addEventListener("hidden.bs.modal", () => {
      $("#btnGuiaMC")?.focus();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", iniciar, { once: true });
  } else {
    iniciar();
  }
})();
