"""Motor de simulación de bases de datos mediante Monte Carlo.

Implementa de forma explícita el generador uniforme y la transformada inversa
para las distribuciones de Poisson y Exponencial. El módulo no conoce Flask ni
SQLite, de modo que puede probarse y reutilizarse de forma aislada.

La generación es determinista cuando se indica una semilla: la misma
configuración produce exactamente la misma base de datos.
"""

from __future__ import annotations

import bisect
import math
import random
import statistics
from collections import Counter
from typing import Any

from queueing import ErrorValidacion

DISTRIBUCION_POISSON = "poisson"
DISTRIBUCION_EXPONENCIAL = "exponencial"

DISTRIBUCIONES: dict[str, dict[str, str]] = {
    DISTRIBUCION_POISSON: {
        "etiqueta": "Poisson",
        "descripcion": "Variable aleatoria discreta que cuenta ocurrencias.",
    },
    DISTRIBUCION_EXPONENCIAL: {
        "etiqueta": "Exponencial",
        "descripcion": "Variable aleatoria continua que mide tiempos entre eventos.",
    },
}

MIN_VARIABLES = 1
MAX_VARIABLES = 20
MIN_OBSERVACIONES = 10
MAX_OBSERVACIONES = 50_000
MAX_LAMBDA_POISSON = 10_000.0
MAX_PARAMETRO_EXPONENCIAL = 1_000_000_000.0
MIN_PARAMETRO_EXPONENCIAL = 1e-9
MAX_NOMBRE_VARIABLE = 40
MAX_PUNTOS_CONVERGENCIA = 80
MAX_FILAS_TABLA_POISSON = 200
MAX_GRUPOS_POISSON = 60
MIN_BINS_EXPONENCIAL = 12
MAX_BINS_EXPONENCIAL = 30
MAX_COLUMNAS_UNIFORMES = 3
MAX_DATOS_COMPLETOS = 1_000_000

CONFIANZAS_VALIDAS = (0.90, 0.95, 0.99)
NIVEL_POR_DEFECTO = 0.95
UMBRAL_COLA_POISSON = 1.0 - 1e-12
LIMITE_UNIFORME = 1e-12


# ---------------------------------------------------------------------------
# Validación y normalización de la entrada
# ---------------------------------------------------------------------------


def _texto_campo(campo: str) -> str:
    return str(campo or "")


def _entero(valor: Any, campo: str, minimo: int, maximo: int) -> int:
    if isinstance(valor, bool):
        raise ErrorValidacion(f"{campo} debe ser un número entero.", campo)
    if isinstance(valor, str):
        texto = valor.strip()
        if not texto or not texto.lstrip("+-").isdigit():
            raise ErrorValidacion(f"{campo} debe ser un número entero.", campo)
        numero = int(texto)
    elif isinstance(valor, int):
        numero = valor
    elif isinstance(valor, float) and valor.is_integer():
        numero = int(valor)
    else:
        raise ErrorValidacion(f"{campo} debe ser un número entero.", campo)

    if numero < minimo or numero > maximo:
        raise ErrorValidacion(
            f"{campo} debe estar entre {minimo} y {maximo}.", campo
        )
    return numero


def _numero(valor: Any, campo: str) -> float:
    if isinstance(valor, bool) or valor is None or valor == "":
        raise ErrorValidacion(f"{campo} es obligatorio.", campo)
    try:
        numero = float(valor)
    except (TypeError, ValueError) as exc:
        raise ErrorValidacion(f"{campo} debe ser un número válido.", campo) from exc
    if not math.isfinite(numero):
        raise ErrorValidacion(f"{campo} debe ser un número finito.", campo)
    return numero


def _semilla(valor: Any) -> tuple[int, int | None]:
    if valor is None or valor == "":
        generada = random.SystemRandom().randint(1, 2_147_483_647)
        return generada, None
    numero = _entero(valor, "semilla", -9_223_372_036_854_775_808, 9_223_372_036_854_775_807)
    return numero, numero


def _confianza(valor: Any) -> tuple[float, float, float]:
    if valor is None or valor == "":
        nivel = NIVEL_POR_DEFECTO
    else:
        nivel = _numero(valor, "confianza")
        if nivel > 1:
            nivel /= 100.0
        coincide = next(
            (c for c in CONFIANZAS_VALIDAS if abs(nivel - c) < 1e-9), None
        )
        if coincide is None:
            raise ErrorValidacion(
                "El nivel de confianza debe ser 90 %, 95 % o 99 %.", "confianza"
            )
        nivel = coincide

    alpha = 1.0 - nivel
    z = statistics.NormalDist().inv_cdf(1.0 - alpha / 2.0)
    return nivel, alpha, z


def _nombre_variable(valor: Any, defecto: str) -> str:
    if valor is None:
        return defecto
    texto = " ".join(str(valor).split()).strip()
    if not texto:
        return defecto
    return texto[:MAX_NOMBRE_VARIABLE]


def _tipo_parametro(valor: Any, distribucion: str) -> str:
    if distribucion == DISTRIBUCION_POISSON:
        return "lambda"
    tipo = str(valor or "media").strip().lower()
    if tipo in {"media", "b", "beta"}:
        return "media"
    if tipo in {"tasa", "lambda", "λ"}:
        return "tasa"
    raise ErrorValidacion(
        "El tipo de parámetro debe ser media o tasa.", "tipo_parametro"
    )


def _parametro_distribucion(
    valor: Any, distribucion: str, campo: str, tipo: str
) -> dict[str, float]:
    numero = _numero(valor, campo)

    if distribucion == DISTRIBUCION_POISSON:
        if numero <= 0:
            raise ErrorValidacion("λ (lambda) debe ser mayor que 0.", campo)
        if numero > MAX_LAMBDA_POISSON:
            raise ErrorValidacion(
                f"λ (lambda) debe ser menor o igual a {MAX_LAMBDA_POISSON:,.0f}.",
                campo,
            )
        return {"parametro": numero, "media": numero, "tasa": None}

    if numero <= 0:
        raise ErrorValidacion(
            "El parámetro de la distribución debe ser mayor que 0.", campo
        )
    if tipo == "media":
        media = numero
        if media > MAX_PARAMETRO_EXPONENCIAL:
            raise ErrorValidacion(
                "La media (b) es demasiado grande; usa un valor menor o la tasa.",
                campo,
            )
        tasa = 1.0 / media
    else:
        tasa = numero
        if tasa < MIN_PARAMETRO_EXPONENCIAL:
            raise ErrorValidacion(
                "La tasa (λ) es demasiado pequeña; usa un valor mayor o la media.",
                campo,
            )
        if tasa > MAX_PARAMETRO_EXPONENCIAL:
            raise ErrorValidacion(
                "La tasa (λ) es demasiado grande; usa un valor menor o la media.",
                campo,
            )
        media = 1.0 / tasa

    return {"parametro": numero, "media": media, "tasa": tasa}


def _normalizar_variables(
    datos: dict[str, Any],
    distribucion: str,
    num_variables: int,
    modo: str,
) -> tuple[list[dict[str, Any]], dict[str, Any] | None]:
    entrada = datos.get("variables")
    if entrada is not None and not isinstance(entrada, list):
        raise ErrorValidacion(
            "El campo variables debe ser una lista.", "variables"
        )
    entrada = entrada or []

    if modo == "global":
        tipo_global = _tipo_parametro(
            datos.get("tipo_parametro_global")
            or datos.get("tipo_parametro")
            or (entrada[0].get("tipo_parametro") if entrada else None),
            distribucion,
        )
        parametro_global = datos.get("parametro_global")
        if parametro_global is None and entrada:
            parametro_global = entrada[0].get("parametro")
        if parametro_global is None:
            raise ErrorValidacion(
                "Indica el parámetro global de la distribución.", "parametro_global"
            )
        base = _parametro_distribucion(
            parametro_global, distribucion, "parametro_global", tipo_global
        )
        variables = []
        for indice in range(num_variables):
            nombre_entrada = entrada[indice].get("nombre") if indice < len(entrada) else None
            variables.append(
                {
                    "indice": indice,
                    "nombre": _nombre_variable(nombre_entrada, f"V{indice + 1}"),
                    "parametro": base["parametro"],
                    "tipo_parametro": tipo_global,
                    "media": base["media"],
                    "tasa": base["tasa"],
                }
            )
        return variables, {
            "parametro": base["parametro"],
            "tipo_parametro": tipo_global,
            "media": base["media"],
            "tasa": base["tasa"],
        }

    if len(entrada) != num_variables:
        raise ErrorValidacion(
            "La cantidad de configuraciones por variable no coincide con num_variables.",
            "variables",
        )

    variables = []
    for indice, item in enumerate(entrada):
        if not isinstance(item, dict):
            raise ErrorValidacion(
                f"La configuración de V{indice + 1} no es válida.", "variables"
            )
        tipo = _tipo_parametro(item.get("tipo_parametro"), distribucion)
        base = _parametro_distribucion(
            item.get("parametro"),
            distribucion,
            f"parametro_v{indice + 1}",
            tipo,
        )
        variables.append(
            {
                "indice": indice,
                "nombre": _nombre_variable(item.get("nombre"), f"V{indice + 1}"),
                "parametro": base["parametro"],
                "tipo_parametro": tipo,
                "media": base["media"],
                "tasa": base["tasa"],
            }
        )
    return variables, None


def normalizar_entrada(datos: dict[str, Any]) -> dict[str, Any]:
    """Valida el cuerpo JSON y devuelve una configuración normalizada."""

    if not isinstance(datos, dict):
        raise ErrorValidacion("El cuerpo de la solicitud no es válido.")

    distribucion = str(datos.get("distribucion") or "").strip().lower()
    if distribucion not in DISTRIBUCIONES:
        raise ErrorValidacion(
            "La distribución debe ser poisson o exponencial.", "distribucion"
        )

    num_variables = _entero(
        datos.get("num_variables"), "num_variables", MIN_VARIABLES, MAX_VARIABLES
    )
    num_observaciones = _entero(
        datos.get("num_observaciones"),
        "num_observaciones",
        MIN_OBSERVACIONES,
        MAX_OBSERVACIONES,
    )

    modo = str(datos.get("modo_parametro") or "global").strip().lower()
    if modo not in {"global", "personalizado"}:
        raise ErrorValidacion(
            "El modo de parámetro debe ser global o personalizado.",
            "modo_parametro",
        )

    confianza, alpha, z = _confianza(datos.get("confianza"))
    semilla, semilla_solicitada = _semilla(datos.get("semilla"))
    variables, parametro_global = _normalizar_variables(
        datos, distribucion, num_variables, modo
    )

    if num_variables * num_observaciones > MAX_DATOS_COMPLETOS:
        raise ErrorValidacion(
            "La simulación solicitada es demasiado grande para guardar la base completa.",
            "num_observaciones",
        )

    return {
        "distribucion": distribucion,
        "distribucion_etiqueta": DISTRIBUCIONES[distribucion]["etiqueta"],
        "num_variables": num_variables,
        "num_observaciones": num_observaciones,
        "modo_parametro": modo,
        "confianza": confianza,
        "alpha": alpha,
        "z": z,
        "semilla": semilla,
        "semilla_solicitada": semilla_solicitada,
        "parametro_global": parametro_global,
        "variables": variables,
    }


# ---------------------------------------------------------------------------
# Distribución de Poisson: PMF, CDF y tabla de transformada inversa
# ---------------------------------------------------------------------------


def _poisson_pmf_cdf(lam: float) -> tuple[list[float], list[float]]:
    """Construye la PMF y la CDF con recurrencia y escala logarítmica.

    Para λ grandes, ``exp(-λ)`` se desborda hacia cero. Por eso se calcula el
    logaritmo de la PMF alrededor de la moda con ``lgamma`` y luego se recupera
    la masa con ``exp``. Así se evita el underflow incluso con λ = 10,000.
    """

    if lam <= 0:
        raise ValueError("lambda debe ser mayor que 0")

    moda = int(math.floor(lam))
    sigma = math.sqrt(lam)
    limite = max(moda + 24, int(math.ceil(lam + 12.0 * sigma + 16.0)))
    limite = min(limite, 2_000_000)

    log_lam = math.log(lam)
    log_pmf = [0.0] * (limite + 1)
    log_pmf[moda] = -lam + moda * log_lam - math.lgamma(moda + 1)

    for k in range(moda - 1, -1, -1):
        log_pmf[k] = log_pmf[k + 1] + math.log(k + 1) - log_lam
    for k in range(moda + 1, limite + 1):
        log_pmf[k] = log_pmf[k - 1] + log_lam - math.log(k)

    pmf = [math.exp(valor) for valor in log_pmf]
    total = math.fsum(pmf)
    if total <= 0 or not math.isfinite(total):
        raise ValueError("no se pudo construir la distribución de Poisson")

    pmf = [valor / total for valor in pmf]
    cdf: list[float] = []
    acumulada = 0.0
    for probabilidad in pmf:
        acumulada += probabilidad
        cdf.append(acumulada)
    cdf[-1] = 1.0
    return pmf, cdf


def _corte_poisson(cdf: list[float]) -> int:
    indice = bisect.bisect_left(cdf, UMBRAL_COLA_POISSON)
    if indice >= len(cdf):
        return len(cdf) - 1
    return indice


def _tabla_poisson(
    valores: list[int], lam: float, pmf: list[float], cdf: list[float], total: int
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    conteos = Counter(valores)
    corte = _corte_poisson(cdf)
    maximo_observado = max(valores) if valores else 0
    if maximo_observado > corte:
        corte = min(maximo_observado, len(cdf) - 1)

    agrupar = lam > 120 or corte > MAX_FILAS_TABLA_POISSON

    if not agrupar:
        filas: list[dict[str, Any]] = []
        acumulada_empirica = 0.0
        for k in range(0, corte + 1):
            frecuencia = int(conteos.get(k, 0))
            relativa = frecuencia / total if total else 0.0
            acumulada_empirica += relativa
            anterior = cdf[k - 1] if k > 0 else 0.0
            filas.append(
                {
                    "k": k,
                    "k_fin": k,
                    "etiqueta": str(k),
                    "p": round(pmf[k], 12),
                    "acumulada": round(cdf[k], 12),
                    "intervalo": f"[{anterior:.6f}, {cdf[k]:.6f})",
                    "frecuencia": frecuencia,
                    "frecuencia_relativa": round(relativa, 10),
                    "frecuencia_acumulada": round(acumulada_empirica, 10),
                    "acumulada_empirica": round(acumulada_empirica, 10),
                    "es_intervalo": False,
                }
            )
        info = {
            "tipo": "individual",
            "desde": 0,
            "hasta": corte,
            "nota": (
                "Cada fila representa un valor k. El intervalo de u indica el rango "
                "que produce ese valor al aplicar la transformada inversa."
            ),
        }
        return filas, info

    sigma = math.sqrt(lam)
    inferior = max(0, int(math.floor(lam - 4.0 * sigma)))
    superior = int(math.ceil(lam + 4.0 * sigma))
    ancho = max(1, int(math.ceil((superior - inferior + 1) / MAX_GRUPOS_POISSON)))
    inferior = (inferior // ancho) * ancho
    cantidad = max(1, int(math.ceil((superior - inferior + 1) / ancho)))
    superior = inferior + cantidad * ancho - 1

    frecuencias = [0] * cantidad
    for k, frecuencia in conteos.items():
        if k < inferior:
            indice = 0
        elif k > superior:
            indice = cantidad - 1
        else:
            indice = min(cantidad - 1, (k - inferior) // ancho)
        frecuencias[indice] += int(frecuencia)

    filas = []
    acumulada_empirica = 0.0
    for indice in range(cantidad):
        inicio = inferior + indice * ancho
        fin = min(superior, inicio + ancho - 1)
        anterior = cdf[inicio - 1] if inicio > 0 else 0.0
        probabilidad = max(0.0, cdf[fin] - anterior)
        frecuencia = frecuencias[indice]
        relativa = frecuencia / total if total else 0.0
        acumulada_empirica += relativa
        etiqueta = str(inicio) if inicio == fin else f"{inicio}–{fin}"
        filas.append(
            {
                "k": inicio,
                "k_fin": fin,
                "etiqueta": etiqueta,
                "p": round(probabilidad, 12),
                "acumulada": round(cdf[fin], 12),
                "intervalo": f"[{anterior:.6f}, {cdf[fin]:.6f})",
                "frecuencia": frecuencia,
                "frecuencia_relativa": round(relativa, 10),
                "frecuencia_acumulada": round(acumulada_empirica, 10),
                "acumulada_empirica": round(acumulada_empirica, 10),
                "es_intervalo": ancho > 1,
            }
        )

    info = {
        "tipo": "intervalos",
        "desde": inferior,
        "hasta": superior,
        "ancho": ancho,
        "nota": (
            f"λ = {lam:g} es grande; para mantener la tabla legible se agrupan "
            f"intervalos de {ancho} valores de k. La ventana mostrada concentra "
            "prácticamente toda la probabilidad."
        ),
    }
    return filas, info


# ---------------------------------------------------------------------------
# Distribución Exponencial: histograma y curva teórica
# ---------------------------------------------------------------------------


def _tabla_exponencial(
    valores: list[float], media: float, total: int
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    maximo = max(valores) if valores else 0.0
    if not math.isfinite(maximo) or maximo <= 0:
        maximo = 1.0

    bins = int(round(math.sqrt(total)))
    bins = max(MIN_BINS_EXPONENCIAL, min(MAX_BINS_EXPONENCIAL, bins))
    ancho = maximo / bins
    if ancho <= 0:
        ancho = 1.0

    frecuencias = [0] * bins
    for valor in valores:
        indice = int(valor / ancho)
        if indice < 0:
            indice = 0
        elif indice >= bins:
            indice = bins - 1
        frecuencias[indice] += 1

    filas: list[dict[str, Any]] = []
    acumulada_empirica = 0.0
    for indice in range(bins):
        inferior = indice * ancho
        superior = inferior + ancho
        marca = (inferior + superior) / 2.0
        frecuencia = frecuencias[indice]
        relativa = frecuencia / total if total else 0.0
        acumulada_empirica += relativa
        densidad = frecuencia / (total * ancho) if total else 0.0
        probabilidad_teorica = math.exp(-inferior / media) - math.exp(
            -superior / media
        )
        acumulada_teorica = 1.0 - math.exp(-superior / media)
        densidad_teorica = math.exp(-marca / media) / media
        filas.append(
            {
                "indice": indice,
                "k": indice,
                "limite_inferior": round(inferior, 10),
                "limite_superior": round(superior, 10),
                "marca_clase": round(marca, 10),
                "etiqueta": f"{inferior:.4g}–{superior:.4g}",
                "intervalo": f"[{inferior:.6f}, {superior:.6f})",
                "p": round(probabilidad_teorica, 12),
                "acumulada": round(acumulada_teorica, 12),
                "frecuencia": frecuencia,
                "frecuencia_relativa": round(relativa, 10),
                "frecuencia_acumulada": round(acumulada_empirica, 10),
                "acumulada_empirica": round(acumulada_empirica, 10),
                "densidad": round(densidad, 10),
                "densidad_teorica": round(densidad_teorica, 10),
                "probabilidad_teorica": round(probabilidad_teorica, 12),
                "es_intervalo": True,
            }
        )

    info = {
        "tipo": "histograma",
        "desde": 0.0,
        "hasta": round(maximo, 10),
        "bins": bins,
        "ancho": round(ancho, 10),
        "nota": (
            f"Histograma de {bins} intervalos de clase construido con los valores "
            f"simulados. La densidad empírica se compara con f(x) = (1/b)·e^(−x/b)."
        ),
    }
    return filas, info


# ---------------------------------------------------------------------------
# Estadísticas y convergencia
# ---------------------------------------------------------------------------


def _estadisticas(
    valores: list[float],
    media_teorica: float,
    desviacion_teorica: float,
    z: float,
) -> dict[str, float]:
    total = len(valores)
    media = math.fsum(valores) / total
    suma_cuadrados = math.fsum((valor - media) ** 2 for valor in valores)
    varianza = suma_cuadrados / (total - 1) if total > 1 else 0.0
    desviacion = math.sqrt(max(0.0, varianza))
    error_tipico = desviacion / math.sqrt(total) if total else 0.0
    margen = z * error_tipico
    error_relativo = (
        abs(media - media_teorica) / media_teorica * 100.0
        if media_teorica
        else 0.0
    )

    return {
        "n": total,
        "media_simulada": round(media, 10),
        "varianza_simulada": round(varianza, 10),
        "desviacion_simulada": round(desviacion, 10),
        "error_tipico": round(error_tipico, 10),
        "ic_inferior": round(media - margen, 10),
        "ic_superior": round(media + margen, 10),
        "error_relativo_pct": round(error_relativo, 8),
        "minimo": round(min(valores), 10),
        "maximo": round(max(valores), 10),
        "media_teorica": round(media_teorica, 10),
        "desviacion_teorica": round(desviacion_teorica, 10),
    }


def _convergencia(
    valores: list[float], media_teorica: float, max_puntos: int = MAX_PUNTOS_CONVERGENCIA
) -> list[dict[str, float]]:
    total = len(valores)
    if total <= max_puntos:
        indices = list(range(1, total + 1))
    else:
        indices = sorted(
            {
                max(1, min(total, int(round(1 + i * (total - 1) / (max_puntos - 1)))))
                for i in range(max_puntos)
            }
        )

    puntos: list[dict[str, float]] = []
    siguiente = 0
    acumulada = 0.0
    for posicion, valor in enumerate(valores, start=1):
        acumulada += valor
        if siguiente < len(indices) and posicion == indices[siguiente]:
            puntos.append(
                {
                    "n": posicion,
                    "media": round(acumulada / posicion, 10),
                    "media_teorica": round(media_teorica, 10),
                }
            )
            siguiente += 1
    return puntos


# ---------------------------------------------------------------------------
# Simulación
# ---------------------------------------------------------------------------


def _uniforme(generador: random.Random) -> float:
    valor = generador.random()
    if valor < LIMITE_UNIFORME:
        return LIMITE_UNIFORME
    if valor > 1.0 - LIMITE_UNIFORME:
        return 1.0 - LIMITE_UNIFORME
    return valor


def _valor_compacto(valor: float) -> float:
    """Conserva 9 cifras significativas para que el JSON sea manejable."""

    if not math.isfinite(valor):
        return 0.0
    return float(f"{valor:.9g}")


def _etiqueta_parametro(variable: dict[str, Any], distribucion: str) -> str:
    if distribucion == DISTRIBUCION_POISSON:
        return f"λ = {variable['parametro']:g}"
    if variable["tipo_parametro"] == "media":
        return f"b = {variable['parametro']:g} · λ = {variable['tasa']:.6g}"
    return f"λ = {variable['parametro']:g} · b = {variable['media']:.6g}"


def _resumen_global(variables: list[dict[str, Any]]) -> dict[str, Any]:
    total = len(variables)
    if not total:
        return {}
    media_simulada = math.fsum(v["media_simulada"] for v in variables) / total
    media_teorica = math.fsum(v["media_teorica"] for v in variables) / total
    error_relativo = (
        math.fsum(v["error_relativo_pct"] for v in variables) / total
    )
    en_intervalo = sum(
        1
        for v in variables
        if v["ic_inferior"] <= v["media_teorica"] <= v["ic_superior"]
    )
    return {
        "media_simulada_promedio": round(media_simulada, 10),
        "media_teorica_promedio": round(media_teorica, 10),
        "error_relativo_promedio_pct": round(error_relativo, 8),
        "variables_en_intervalo": en_intervalo,
        "cobertura_ic_pct": round(en_intervalo / total * 100.0, 6),
    }


def _vista_previa(datos: dict[str, Any], limite: int = 50) -> dict[str, Any]:
    cantidad = min(limite, datos["total"])
    filas = [
        {
            "observacion": indice + 1,
            "valores": datos["filas"][indice],
            "uniformes": datos["uniformes"][indice],
        }
        for indice in range(cantidad)
    ]
    return {
        "filas": filas,
        "columnas_u": datos["columnas_u"],
        "variables": datos["variables"],
        "total": datos["total"],
        "limite": limite,
    }


def simular_montecarlo(datos: dict[str, Any]) -> dict[str, Any]:
    """Ejecuta la simulación completa y devuelve configuración, resumen y datos."""

    configuracion = normalizar_entrada(datos)
    distribucion = configuracion["distribucion"]
    variables_config = configuracion["variables"]
    total_observaciones = configuracion["num_observaciones"]
    cantidad_variables = configuracion["num_variables"]
    z = configuracion["z"]

    generador = random.Random(configuracion["semilla"])
    columnas_u = min(MAX_COLUMNAS_UNIFORMES, cantidad_variables)

    filas: list[list[Any]] = [[0] * cantidad_variables for _ in range(total_observaciones)]
    uniformes: list[list[float]] = [
        [0.0] * columnas_u for _ in range(total_observaciones)
    ]

    cache_poisson: dict[float, tuple[list[float], list[float]]] = {}
    variables: list[dict[str, Any]] = []

    for indice_variable, variable in enumerate(variables_config):
        valores: list[float] = []
        agregar = valores.append

        if distribucion == DISTRIBUCION_POISSON:
            lam = float(variable["parametro"])
            if lam not in cache_poisson:
                cache_poisson[lam] = _poisson_pmf_cdf(lam)
            pmf, cdf = cache_poisson[lam]
            buscar = bisect.bisect_right
            for posicion in range(total_observaciones):
                uniforme = _uniforme(generador)
                valor = buscar(cdf, uniforme)
                if valor >= len(cdf):
                    valor = len(cdf) - 1
                agregar(float(valor))
                filas[posicion][indice_variable] = valor
                if indice_variable < columnas_u:
                    uniformes[posicion][indice_variable] = _valor_compacto(uniforme)
            media_teorica = lam
            varianza_teorica = lam
            valores_enteros = [int(valor) for valor in valores]
            tabla, tabla_info = _tabla_poisson(
                valores_enteros, lam, pmf, cdf, total_observaciones
            )
        else:
            media = float(variable["media"])
            for posicion in range(total_observaciones):
                uniforme = _uniforme(generador)
                valor = -media * math.log(uniforme)
                compacto = _valor_compacto(valor)
                agregar(compacto)
                filas[posicion][indice_variable] = compacto
                if indice_variable < columnas_u:
                    uniformes[posicion][indice_variable] = _valor_compacto(uniforme)
            media_teorica = media
            varianza_teorica = media * media
            tabla, tabla_info = _tabla_exponencial(
                valores, media, total_observaciones
            )

        desviacion_teorica = math.sqrt(varianza_teorica)
        estadisticas = _estadisticas(
            valores, media_teorica, desviacion_teorica, z
        )
        variables.append(
            {
                "indice": indice_variable,
                "nombre": variable["nombre"],
                "parametro": variable["parametro"],
                "tipo_parametro": variable["tipo_parametro"],
                "parametro_etiqueta": _etiqueta_parametro(variable, distribucion),
                "media": round(variable["media"], 10),
                "tasa": (
                    round(variable["tasa"], 10)
                    if variable["tasa"] is not None
                    else None
                ),
                "media_teorica": round(media_teorica, 10),
                "varianza_teorica": round(varianza_teorica, 10),
                "desviacion_teorica": round(desviacion_teorica, 10),
                **estadisticas,
                "convergencia": _convergencia(valores, media_teorica),
                "tabla": tabla,
                "tabla_info": tabla_info,
            }
        )

    datos_completos = {
        "total": total_observaciones,
        "variables": [v["nombre"] for v in variables],
        "columnas_u": list(range(columnas_u)),
        "filas": filas,
        "uniformes": uniformes,
    }

    return {
        "configuracion": configuracion,
        "variables": variables,
        "resumen_global": _resumen_global(variables),
        "vista_previa": _vista_previa(datos_completos),
        "datos": datos_completos,
    }
