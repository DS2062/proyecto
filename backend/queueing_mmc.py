"""Modelos analíticos de líneas de espera M/M/c.

Este módulo concentra la matemática de los modelos con varios servidores.
Al igual que `queueing.py`, no conoce Flask ni SQLite para poder probarse de
forma aislada y reutilizarse en módulos posteriores (por ejemplo, Monte Carlo).

Notación:
    rho = lambda / mu          (intensidad de tráfico)
    r   = rho / c = lambda / (c * mu)   (factor de utilización)
"""

from __future__ import annotations

import math
from typing import Any

from queueing import (
    MAX_N,
    MAX_NMAX,
    UMBRAL_CORTE_ACUMULADA,
    ErrorValidacion,
    _a_entero,
    _a_flotante,
    _formato_visible,
    _probabilidad,
    _redondear,
    _verificar_resultados,
)

MODELO_MMC_INFINITO = "mmc_infinito"
MODELO_MMC_FINITO = "mmc_finito"

MODELOS_MMC: dict[str, dict[str, str]] = {
    MODELO_MMC_INFINITO: {
        "etiqueta": "M/M/c:(DG/∞/∞)",
        "descripcion": "Varios servidores en paralelo y cola ilimitada.",
    },
    MODELO_MMC_FINITO: {
        "etiqueta": "M/M/c:(DG/N/∞)",
        "descripcion": "Varios servidores y capacidad máxima N en el sistema.",
    },
}

# Un límite alto de servidores mantiene los cálculos estables en coma flotante
# (p0 puede desbordar por debajo del mínimo representable con c muy grande) y
# evita tablas/PDF inmanejables. 500 servidores cubre con holgura los casos
# docentes y profesionales habituales.
MAX_C = 500
MAX_INDICE_PROBABILIDAD = 1_000_000_000
TOLERANCIA_UTILIZACION_UNO = 1e-12

_TIPOS_PROBABILIDAD = {
    "menor_igual": "menor_igual",
    "mayor_igual": "mayor_igual",
    "rango": "rango",
}


# ---------------------------------------------------------------------------
# Normalización y validación
# ---------------------------------------------------------------------------


def es_modelo_mmc(valor: Any) -> bool:
    """Indica si el modelo pertenece a la familia M/M/c."""

    if not isinstance(valor, str):
        return False
    normalizado = valor.strip().lower().replace(" ", "")
    return normalizado.startswith("mmc") or "m/m/c" in normalizado


def etiqueta_modelo_mmc(modelo: str) -> str:
    return MODELOS_MMC.get(modelo, {}).get("etiqueta", modelo)


def normalizar_modelo_mmc(valor: Any) -> str:
    if not isinstance(valor, str) or not valor.strip():
        raise ErrorValidacion("Selecciona un modelo de cola válido.", "modelo")

    normalizado = valor.strip().lower().replace(" ", "")
    alias_infinito = {
        MODELO_MMC_INFINITO,
        "infinito",
        "mmc",
        "m/m/c:(dg/∞/∞)",
        "m/m/c:(dg/inf/inf)",
        "m/m/c(dg/∞/∞)",
        "m/m/cinfinito",
    }
    alias_finito = {
        MODELO_MMC_FINITO,
        "finito",
        "m/m/c:(dg/n/∞)",
        "m/m/c:(dg/n/inf)",
        "m/m/c(dg/n/∞)",
        "m/m/cfinito",
    }

    if normalizado in alias_infinito:
        return MODELO_MMC_INFINITO
    if normalizado in alias_finito:
        return MODELO_MMC_FINITO

    raise ErrorValidacion(
        "Modelo M/M/c no reconocido. Usa mmc_infinito o mmc_finito.", "modelo"
    )


def _servidores(datos: dict[str, Any]) -> int:
    c = _a_entero(
        datos.get("c"),
        "c",
        "c (número de servidores)",
        1,
        MAX_C,
    )
    return int(c or 1)


# ---------------------------------------------------------------------------
# Utilidades numéricas
# ---------------------------------------------------------------------------


def _log_suma_exp(valores: list[float]) -> float:
    maximo = max(valores)
    if not math.isfinite(maximo):
        raise ErrorValidacion(
            "Los parámetros producen un valor fuera del rango numérico representable."
        )
    return maximo + math.log(
        math.fsum(math.exp(valor - maximo) for valor in valores)
    )


def _validar_rho(rho: float) -> float:
    if not math.isfinite(rho):
        raise ErrorValidacion(
            "La relación ρ = λ/μ está fuera del rango numérico representable."
        )
    if rho <= 0:
        raise ErrorValidacion(
            "La relación ρ = λ/μ es demasiado pequeña para representarse. "
            "Aumenta λ o reduce μ.",
            "lambda",
        )
    return rho


def _contexto_infinito(rho: float, c: int) -> dict[str, Any]:
    """Prepara pesos en espacio logarítmico para el modelo ilimitado."""

    r = rho / c
    if r >= 1.0:
        raise ErrorValidacion(
            "Para el modelo sin límite se requiere λ < c·μ (ρ/c < 1). "
            f"Con estos valores ρ/c = {_formato_visible(r)}.",
            "c",
        )

    log_rho = math.log(rho)
    log_r = math.log(r)

    # Pesos sin normalizar de n = 0 … c-1.
    log_pesos: list[float] = [0.0]
    for n in range(1, c):
        log_pesos.append(n * log_rho - math.lgamma(n + 1))

    # Peso del estado n = c y cola geométrica de razón r.
    log_peso_c = c * log_rho - math.lgamma(c + 1)
    log_suma = _log_suma_exp(log_pesos + [log_peso_c - math.log1p(-r)])

    return {
        "r": r,
        "log_rho": log_rho,
        "log_r": log_r,
        "log_pesos": log_pesos,
        "log_peso_c": log_peso_c,
        "log_suma": log_suma,
    }


def _pmf_infinita(n: int, contexto: dict[str, Any], c: int) -> float:
    if n < c:
        log_p = contexto["log_pesos"][n] - contexto["log_suma"]
    else:
        log_p = (
            contexto["log_peso_c"]
            + (n - c) * contexto["log_r"]
            - contexto["log_suma"]
        )
    if log_p < -745.0:
        return 0.0
    return _probabilidad(math.exp(log_p))


def _pmf_finita(rho: float, c: int, capacidad: int) -> list[float]:
    """Probabilidades exactas p(n) para n = 0 … N, sin desbordamientos."""

    log_rho = math.log(rho)
    log_pesos: list[float] = [0.0]
    for n in range(1, capacidad + 1):
        if n <= c:
            log_pesos.append(n * log_rho - math.lgamma(n + 1))
        else:
            log_pesos.append(
                n * log_rho
                - math.lgamma(c + 1)
                - (n - c) * math.log(c)
            )

    maximo = max(log_pesos)
    pesos = [math.exp(valor - maximo) for valor in log_pesos]
    suma = math.fsum(pesos)
    if not math.isfinite(suma) or suma <= 0:
        raise ErrorValidacion(
            "No fue posible normalizar la distribución con estos parámetros."
        )
    return [_probabilidad(peso / suma) for peso in pesos]


def _resultados_distribucion(probabilidades: list[float]) -> list[dict[str, Any]]:
    filas: list[dict[str, Any]] = []
    acumulada = 0.0
    ultimo = len(probabilidades) - 1
    for indice, valor in enumerate(probabilidades):
        p = _probabilidad(valor)
        acumulada = _probabilidad(acumulada + p)
        if indice == ultimo and abs(acumulada - 1.0) < 1e-9:
            acumulada = 1.0
        filas.append(
            {
                "n": indice,
                "p": _redondear(p),
                "acumulada": _redondear(acumulada),
            }
        )
    return filas


# ---------------------------------------------------------------------------
# Modelos
# ---------------------------------------------------------------------------


def _mmc_infinito(lam: float, mu: float, c: int, n_max: int) -> dict[str, Any]:
    rho = _validar_rho(lam / mu)
    contexto = _contexto_infinito(rho, c)
    r = contexto["r"]

    p0 = _probabilidad(math.exp(-contexto["log_suma"]))
    p_c = _probabilidad(math.exp(contexto["log_peso_c"] - contexto["log_suma"]))

    # Lq = p_c * r / (1-r)^2, equivalente a la fórmula cerrada con factoriales.
    denominador = (1.0 - r) ** 2
    if denominador <= 0:
        raise ErrorValidacion(
            "La utilización está demasiado cerca de 1 para calcular la cola."
        )
    lq = max(0.0, p_c * r / denominador)
    ls = lq + rho
    ws = ls / lam
    wq = lq / lam

    # Servidores promedio ocupados/inactivos a partir de la distribución.
    inactivos = 0.0
    activos = 0.0
    for n in range(0, c + 1):
        p = _pmf_infinita(n, contexto, c)
        inactivos += (c - n) * p
        activos += min(n, c) * p
    # Los estados n > c tienen los c servidores ocupados.
    probabilidad_cola = max(0.0, 1.0 - math.fsum(
        _pmf_infinita(n, contexto, c) for n in range(0, c + 1)
    ))
    activos += c * probabilidad_cola
    inactivos = max(0.0, min(float(c), inactivos))
    activos = max(0.0, min(float(c), activos))

    distribucion: list[dict[str, Any]] = []
    acumulada = 0.0
    for n in range(0, n_max + 1):
        p = _pmf_infinita(n, contexto, c)
        acumulada = _probabilidad(acumulada + p)
        distribucion.append(
            {
                "n": n,
                "p": _redondear(p),
                "acumulada": _redondear(acumulada),
            }
        )
        if acumulada >= UMBRAL_CORTE_ACUMULADA:
            break

    resultados = {
        "rho": _redondear(rho),
        "rho_c": _redondear(r),
        "factor_utilizacion": _redondear(r),
        "utilizacion": _redondear(activos / c),
        "p0": _redondear(p0),
        "Ls": _redondear(ls),
        "Lq": _redondear(lq),
        "Ws": _redondear(ws),
        "Wq": _redondear(wq),
        "lambda_efectiva": _redondear(lam),
        "lambda_perdida": 0.0,
        "pN": 0.0,
        "servidores_inactivos": _redondear(inactivos),
        "servidores_activos": _redondear(activos),
    }
    _verificar_resultados(resultados)

    advertencias: list[str] = []
    if r > 0.9999:
        advertencias.append(
            "ρ/c está muy cerca de 1; las métricas de espera crecen rápidamente "
            "y son sensibles a pequeños cambios en λ, μ o c."
        )

    return {
        "modelo": MODELO_MMC_INFINITO,
        "modelo_etiqueta": MODELOS_MMC[MODELO_MMC_INFINITO]["etiqueta"],
        "parametros": {"lambda": lam, "mu": mu, "c": c, "N": None, "nMax": n_max},
        "resultados": resultados,
        "distribucion": distribucion,
        "total_filas": len(distribucion),
        "advertencias": advertencias,
    }


def _mmc_finito(lam: float, mu: float, c: int, capacidad: int) -> dict[str, Any]:
    rho = _validar_rho(lam / mu)
    r = rho / c

    probabilidades = _pmf_finita(rho, c, capacidad)
    p0 = _probabilidad(probabilidades[0])
    pn = _probabilidad(probabilidades[-1])

    lq = math.fsum(
        (n - c) * probabilidades[n] for n in range(c + 1, capacidad + 1)
    )
    lq = max(0.0, lq)

    lambda_efectiva = lam * (1.0 - pn)
    lambda_perdida = lam * pn
    if lambda_efectiva < 0 and lambda_efectiva > -1e-12:
        lambda_efectiva = 0.0

    ls = lq + lambda_efectiva / mu

    advertencias: list[str] = []
    if lambda_efectiva <= 1e-12 or not math.isfinite(lambda_efectiva):
        wq = 0.0
        ws = 0.0
        advertencias.append(
            "La tasa efectiva de llegada es prácticamente 0; Wq y Ws se "
            "reportan como 0 porque casi todas las llegadas se rechazan."
        )
    else:
        wq = lq / lambda_efectiva
        ws = ls / lambda_efectiva

    inactivos = math.fsum(
        (c - n) * probabilidades[n] for n in range(0, min(c, capacidad) + 1)
    )
    inactivos = max(0.0, min(float(c), inactivos))
    activos = max(0.0, min(float(c), c - inactivos))

    distribucion = _resultados_distribucion(probabilidades)

    resultados = {
        "rho": _redondear(rho),
        "rho_c": _redondear(r),
        "factor_utilizacion": _redondear(r),
        "utilizacion": _redondear(activos / c),
        "p0": _redondear(p0),
        "Ls": _redondear(ls),
        "Lq": _redondear(lq),
        "Ws": _redondear(ws),
        "Wq": _redondear(wq),
        "lambda_efectiva": _redondear(lambda_efectiva),
        "lambda_perdida": _redondear(lambda_perdida),
        "pN": _redondear(pn),
        "servidores_inactivos": _redondear(inactivos),
        "servidores_activos": _redondear(activos),
    }
    _verificar_resultados(resultados)

    if abs(r - 1.0) <= TOLERANCIA_UTILIZACION_UNO:
        advertencias.append(
            "Se aplicaron las fórmulas del caso crítico ρ/c = 1."
        )
    if capacidad == c:
        advertencias.append(
            "N = c: el sistema no tiene espacio de espera; las llegadas se "
            "rechazan cuando todos los servidores están ocupados."
        )

    return {
        "modelo": MODELO_MMC_FINITO,
        "modelo_etiqueta": MODELOS_MMC[MODELO_MMC_FINITO]["etiqueta"],
        "parametros": {
            "lambda": lam,
            "mu": mu,
            "c": c,
            "N": capacidad,
            "nMax": None,
        },
        "resultados": resultados,
        "distribucion": distribucion,
        "total_filas": len(distribucion),
        "advertencias": advertencias,
    }


def calcular_modelo_mmc(datos: dict[str, Any]) -> dict[str, Any]:
    """Valida y resuelve un modelo M/M/c con los datos de la API."""

    if not isinstance(datos, dict):
        raise ErrorValidacion("El cuerpo de la solicitud debe ser un objeto JSON.")

    modelo = normalizar_modelo_mmc(datos.get("modelo"))
    lam = _a_flotante(datos.get("lambda"), "lambda", "λ (lambda)")
    mu = _a_flotante(datos.get("mu"), "mu", "μ (mu)")
    c = _servidores(datos)

    if modelo == MODELO_MMC_INFINITO:
        n_max = _a_entero(
            datos.get("nMax", 50),
            "nMax",
            "nMax (corte de tabla)",
            1,
            MAX_NMAX,
            obligatorio=False,
        )
        return _mmc_infinito(lam, mu, c, int(n_max or 50))

    capacidad = _a_entero(
        datos.get("N"),
        "N",
        "N (capacidad del sistema)",
        c,
        MAX_N,
    )
    return _mmc_finito(lam, mu, c, int(capacidad or c))


# ---------------------------------------------------------------------------
# Probabilidades
# ---------------------------------------------------------------------------


def _cdf_infinita(
    k: int,
    c: int,
    contexto: dict[str, Any],
) -> float:
    if k < 0:
        return 0.0
    if k < c:
        return _probabilidad(
            math.fsum(_pmf_infinita(n, contexto, c) for n in range(0, k + 1))
        )

    r = contexto["r"]
    p_c = _probabilidad(
        math.exp(contexto["log_peso_c"] - contexto["log_suma"])
    )
    # P(X > k) = p_c * r^(k-c+1) / (1-r).
    denominador = -math.expm1(contexto["log_r"])
    exponente = (k - c + 1) * contexto["log_r"]
    cola = 0.0 if exponente < -745 else p_c * math.exp(exponente) / denominador
    return _probabilidad(1.0 - cola)


def _cdf_finita(probabilidades: list[float], k: int) -> float:
    if k < 0:
        return 0.0
    if k >= len(probabilidades) - 1:
        return 1.0
    return _probabilidad(math.fsum(probabilidades[: k + 1]))


def calcular_probabilidad_mmc(datos: dict[str, Any]) -> dict[str, Any]:
    """Calcula P(X <= k), P(X >= k) o P(a <= X <= b) para M/M/c."""

    if not isinstance(datos, dict):
        raise ErrorValidacion("El cuerpo de la solicitud debe ser un objeto JSON.")

    modelo = normalizar_modelo_mmc(datos.get("modelo"))
    lam = _a_flotante(datos.get("lambda"), "lambda", "λ (lambda)")
    mu = _a_flotante(datos.get("mu"), "mu", "μ (mu)")
    c = _servidores(datos)
    rho = _validar_rho(lam / mu)

    tipo_original = datos.get("tipo")
    if not isinstance(tipo_original, str) or tipo_original not in _TIPOS_PROBABILIDAD:
        raise ErrorValidacion(
            "El tipo debe ser menor_igual, mayor_igual o rango.", "tipo"
        )
    tipo = _TIPOS_PROBABILIDAD[tipo_original]

    contexto: dict[str, Any] | None = None
    probabilidades: list[float] | None = None
    capacidad: int | None = None

    if modelo == MODELO_MMC_INFINITO:
        contexto = _contexto_infinito(rho, c)
        limite = MAX_INDICE_PROBABILIDAD
        cdf = lambda k: _cdf_infinita(k, c, contexto)  # noqa: E731
    else:
        capacidad = int(
            _a_entero(datos.get("N"), "N", "N (capacidad del sistema)", c, MAX_N)
            or c
        )
        probabilidades = _pmf_finita(rho, c, capacidad)
        limite = capacidad
        cdf = lambda k: _cdf_finita(probabilidades, k)  # noqa: E731

    k: int | None = None
    a: int | None = None
    b: int | None = None
    entradas: dict[str, Any] = {}

    if tipo in {"menor_igual", "mayor_igual"}:
        k = int(
            _a_entero(datos.get("k"), "k", "k", 0, limite) or 0
        )
        entradas = {"k": k}
    else:
        a = int(_a_entero(datos.get("a"), "a", "a", 0, limite) or 0)
        b = int(_a_entero(datos.get("b"), "b", "b", 0, limite) or 0)
        if a > b:
            raise ErrorValidacion(
                "El límite inferior a debe ser menor o igual que b.", "a"
            )
        entradas = {"a": a, "b": b}

    if tipo == "menor_igual":
        probabilidad = cdf(int(k or 0))
    elif tipo == "mayor_igual":
        probabilidad = _probabilidad(1.0 - cdf(int(k or 0) - 1))
    else:
        probabilidad = _probabilidad(cdf(int(b or 0)) - cdf(int(a or 0) - 1))

    descripcion = {
        "menor_igual": f"P(X ≤ {int(k or 0)})",
        "mayor_igual": f"P(X ≥ {int(k or 0)})",
        "rango": f"P({int(a or 0)} ≤ X ≤ {int(b or 0)})",
    }[tipo]

    return {
        "modelo": modelo,
        "modelo_etiqueta": etiqueta_modelo_mmc(modelo),
        "parametros": {
            "lambda": lam,
            "mu": mu,
            "c": c,
            "N": capacidad,
        },
        "tipo": tipo,
        "entradas": entradas,
        "descripcion": descripcion,
        "probabilidad": _redondear(probabilidad),
    }
