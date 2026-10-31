"""Modelos analíticos de líneas de espera M/M/1.

Este módulo concentra toda la lógica matemática. No conoce Flask ni SQLite,
lo que permite reutilizarlo desde futuros módulos (por ejemplo, Monte Carlo)
y probarlo de forma aislada.
"""

from __future__ import annotations

import math
from typing import Any

MODELO_INFINITO = "mm1_infinito"
MODELO_FINITO = "mm1_finito"

MODELOS: dict[str, dict[str, str]] = {
    MODELO_INFINITO: {
        "etiqueta": "M/M/1:(DG/∞/∞)",
        "descripcion": "Un servidor, cola ilimitada, disciplina general.",
    },
    MODELO_FINITO: {
        "etiqueta": "M/M/1:(DG/N/∞)",
        "descripcion": "Un servidor, capacidad máxima N en el sistema.",
    },
}

MAX_TASA = 1_000_000_000.0
MAX_N = 10_000
MAX_NMAX = 10_000
MAX_INDICE_PROBABILIDAD = 1_000_000_000
TOLERANCIA_RHO_UNO = 1e-12
# La interfaz muestra la acumulada con hasta 6 decimales. La tabla se corta
# cuando la cola restante es menor que 0.00005 (acumulada >= 0.99995), es decir,
# cuando ya es prácticamente 1, para no añadir filas con probabilidades 0.
UMBRAL_CORTE_ACUMULADA = 1.0 - 5e-5

_TIPOS_PROBABILIDAD = {
    "menor_igual": "menor_igual",
    "mayor_igual": "mayor_igual",
    "rango": "rango",
}


class ErrorValidacion(ValueError):
    """Error de negocio que la API convierte en una respuesta HTTP 400."""

    def __init__(self, mensaje: str, campo: str | None = None):
        super().__init__(mensaje)
        self.mensaje = mensaje
        self.campo = campo


def etiqueta_modelo(modelo: str) -> str:
    return MODELOS.get(modelo, {}).get("etiqueta", modelo)


def normalizar_modelo(valor: Any) -> str:
    if not isinstance(valor, str) or not valor.strip():
        raise ErrorValidacion(
            "Selecciona un modelo de cola válido.", "modelo"
        )

    normalizado = valor.strip().lower().replace(" ", "")
    alias_infinito = {
        MODELO_INFINITO,
        "infinito",
        "m/m/1:(dg/∞/∞)",
        "m/m/1:(dg/inf/inf)",
        "m/m/1(dg/∞/∞)",
        "m/m/1infinito",
    }
    alias_finito = {
        MODELO_FINITO,
        "finito",
        "m/m/1:(dg/n/∞)",
        "m/m/1:(dg/n/inf)",
        "m/m/1(dg/n/∞)",
        "m/m/1finito",
    }

    if normalizado in alias_infinito:
        return MODELO_INFINITO
    if normalizado in alias_finito:
        return MODELO_FINITO

    raise ErrorValidacion(
        "Modelo no reconocido. Usa mm1_infinito o mm1_finito.", "modelo"
    )


def _a_flotante(valor: Any, campo: str, etiqueta: str) -> float:
    if isinstance(valor, bool) or valor is None:
        raise ErrorValidacion(f"{etiqueta} es obligatorio y debe ser numérico.", campo)

    if isinstance(valor, (int, float)):
        numero = float(valor)
    elif isinstance(valor, str) and valor.strip():
        try:
            numero = float(valor.strip().replace(",", "."))
        except ValueError as exc:
            raise ErrorValidacion(
                f"{etiqueta} debe ser un número válido.", campo
            ) from exc
    else:
        raise ErrorValidacion(f"{etiqueta} debe ser un número válido.", campo)

    if not math.isfinite(numero):
        raise ErrorValidacion(f"{etiqueta} debe ser un número finito.", campo)
    if numero <= 0:
        raise ErrorValidacion(f"{etiqueta} debe ser mayor que 0.", campo)
    if numero > MAX_TASA:
        raise ErrorValidacion(
            f"{etiqueta} debe ser menor o igual a {MAX_TASA:,.0f}.", campo
        )
    return numero


def _a_entero(
    valor: Any,
    campo: str,
    etiqueta: str,
    minimo: int,
    maximo: int,
    *,
    obligatorio: bool = True,
) -> int | None:
    if valor is None or valor == "":
        if obligatorio:
            raise ErrorValidacion(f"{etiqueta} es obligatorio.", campo)
        return None

    if isinstance(valor, bool):
        raise ErrorValidacion(f"{etiqueta} debe ser un entero.", campo)

    if isinstance(valor, int):
        numero = valor
    elif isinstance(valor, float) and valor.is_integer():
        numero = int(valor)
    elif isinstance(valor, str):
        texto = valor.strip()
        try:
            numero = int(texto)
        except ValueError as exc:
            raise ErrorValidacion(
                f"{etiqueta} debe ser un entero.", campo
            ) from exc
    else:
        raise ErrorValidacion(f"{etiqueta} debe ser un entero.", campo)

    if numero < minimo or numero > maximo:
        raise ErrorValidacion(
            f"{etiqueta} debe ser un entero entre {minimo} y {maximo}.", campo
        )
    return numero


def _redondear(valor: float) -> float:
    if not math.isfinite(valor):
        raise ErrorValidacion(
            "Los parámetros producen un valor fuera del rango numérico representable."
        )
    redondeado = round(float(valor), 6)
    return 0.0 if redondeado == 0 else redondeado


def _formato_visible(valor: float) -> str:
    """Formato de hasta 4 decimales, sin ceros sobrantes, para mensajes."""
    texto = f"{float(valor):.4f}".rstrip("0").rstrip(".")
    return texto or "0"


def _probabilidad(valor: float) -> float:
    if not math.isfinite(valor):
        raise ErrorValidacion(
            "Los parámetros producen un valor fuera del rango numérico representable."
        )
    return min(1.0, max(0.0, float(valor)))


def _verificar_resultados(resultados: dict[str, float]) -> None:
    for nombre, valor in resultados.items():
        if not math.isfinite(float(valor)):
            raise ErrorValidacion(
                f"El resultado {nombre} no es representable con estos parámetros."
            )


def _probabilidades_finitas_extremo(rho: float, n: int) -> tuple[float, float]:
    """Devuelve (p_N, 1 - p_N) de forma estable para todo rho > 0.

    p_N = (1 - rho) * rho^N / (1 - rho^(N+1)).
    Se usan formas equivalentes con expm1/log para evitar cancelaciones y
    desbordamientos cuando rho está cerca de 1 o es muy grande.
    """

    if abs(rho - 1.0) <= TOLERANCIA_RHO_UNO:
        return 1.0 / (n + 1), n / (n + 1)

    log_rho = math.log(rho)

    if rho < 1.0:
        # p_N = (1-rho) rho^N / (1-rho^(N+1))
        # 1-p_N = (1-rho^N) / (1-rho^(N+1))
        factor = math.exp(n * log_rho)
        denominador = -math.expm1((n + 1) * log_rho)
        no_bloqueo = -math.expm1(n * log_rho) / denominador
        p_n = _probabilidad((1.0 - rho) * factor / denominador)
    else:
        # Dividiendo numerador y denominador entre rho^(N+1):
        # p_N = (1-1/rho) / (1-rho^-(N+1))
        # 1-p_N = (1/rho - rho^-(N+1)) / (1-rho^-(N+1))
        denominador = -math.expm1(-(n + 1) * log_rho)
        p_n = _probabilidad(-math.expm1(-log_rho) / denominador)
        no_bloqueo = _probabilidad(
            (1.0 / rho - math.exp(-(n + 1) * log_rho)) / denominador
        )

    if not math.isfinite(no_bloqueo) or no_bloqueo <= 0:
        raise ErrorValidacion(
            "No fue posible calcular la probabilidad de bloqueo con estos parámetros."
        )

    return p_n, _probabilidad(no_bloqueo)


def _mm1_infinito(lam: float, mu: float, n_max: int) -> dict[str, Any]:
    rho = lam / mu
    if not math.isfinite(rho):
        raise ErrorValidacion(
            "La relación ρ = λ/μ está fuera del rango numérico representable."
        )
    if rho >= 1.0:
        raise ErrorValidacion(
            "Para el modelo sin límite se requiere λ < μ (ρ < 1). "
            f"Con estos valores ρ = {_formato_visible(rho)}.",
            "lambda",
        )

    p0 = 1.0 - rho
    ls = rho / (1.0 - rho)
    lq = (rho * rho) / (1.0 - rho)
    ws = ls / lam
    wq = lq / lam

    distribucion: list[dict[str, Any]] = []
    acumulada = 0.0
    probabilidad_n = p0

    for n in range(n_max + 1):
        p = _probabilidad(probabilidad_n)
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
        probabilidad_n *= rho

    resultados = {
        "rho": _redondear(rho),
        "p0": _redondear(p0),
        "Ls": _redondear(ls),
        "Lq": _redondear(lq),
        "Ws": _redondear(ws),
        "Wq": _redondear(wq),
        "lambda_efectiva": _redondear(lam),
        "lambda_perdida": 0.0,
        "pN": 0.0,
        "utilizacion": _redondear(rho),
    }
    _verificar_resultados(resultados)

    advertencias: list[str] = []
    if rho > 0.9999:
        advertencias.append(
            "ρ está muy cerca de 1; las métricas de espera crecen rápidamente "
            "y son sensibles a pequeños cambios en λ o μ."
        )

    return {
        "modelo": MODELO_INFINITO,
        "modelo_etiqueta": MODELOS[MODELO_INFINITO]["etiqueta"],
        "parametros": {"lambda": lam, "mu": mu, "N": None, "nMax": n_max},
        "resultados": resultados,
        "distribucion": distribucion,
        "total_filas": len(distribucion),
        "advertencias": advertencias,
    }


def _mm1_finito(lam: float, mu: float, n: int) -> dict[str, Any]:
    rho = lam / mu
    if not math.isfinite(rho):
        raise ErrorValidacion(
            "La relación ρ = λ/μ está fuera del rango numérico representable."
        )

    cerca_de_uno = abs(rho - 1.0) <= TOLERANCIA_RHO_UNO
    log_rho = math.log(rho)

    if cerca_de_uno:
        # Fórmulas especiales para rho = 1.
        p0 = 1.0 / (n + 1)
        probabilidades = [p0] * (n + 1)
        ls = n / 2.0
    else:
        # Distribución normalizada calculada en espacio logarítmico. Es
        # equivalente a p_n = p0 * rho^n, pero evita desbordamientos.
        log_pesos = [indice * log_rho for indice in range(n + 1)]
        max_log = max(log_pesos)
        pesos = [math.exp(valor - max_log) for valor in log_pesos]
        suma_pesos = math.fsum(pesos)
        probabilidades = [valor / suma_pesos for valor in pesos]
        p0 = probabilidades[0]
        ls = math.fsum(indice * p for indice, p in enumerate(probabilidades))

    p0 = _probabilidad(p0)
    pn, no_bloqueo = _probabilidades_finitas_extremo(rho, n)
    lambda_efectiva = lam * no_bloqueo
    lambda_perdida = lam * pn

    if lambda_efectiva <= 0 or not math.isfinite(lambda_efectiva):
        raise ErrorValidacion(
            "La tasa efectiva de llegada resultó no representable. "
            "Revisa los valores de λ, μ y N."
        )

    lq = max(0.0, ls - (1.0 - p0))
    ws = ls / lambda_efectiva
    wq = lq / lambda_efectiva

    distribucion: list[dict[str, Any]] = []
    acumulada = 0.0
    for indice, valor in enumerate(probabilidades):
        p = _probabilidad(valor)
        acumulada = _probabilidad(acumulada + p)
        if indice == n and abs(acumulada - 1.0) < 1e-9:
            acumulada = 1.0
        distribucion.append(
            {
                "n": indice,
                "p": _redondear(p),
                "acumulada": _redondear(acumulada),
            }
        )
        if acumulada >= UMBRAL_CORTE_ACUMULADA:
            break

    resultados = {
        "rho": _redondear(rho),
        "p0": _redondear(p0),
        "Ls": _redondear(ls),
        "Lq": _redondear(lq),
        "Ws": _redondear(ws),
        "Wq": _redondear(wq),
        "lambda_efectiva": _redondear(lambda_efectiva),
        "lambda_perdida": _redondear(lambda_perdida),
        "pN": _redondear(pn),
        "utilizacion": _redondear(1.0 - p0),
    }
    _verificar_resultados(resultados)

    advertencias: list[str] = []
    if cerca_de_uno:
        advertencias.append(
            "Se aplicaron las fórmulas especiales del caso ρ = 1."
        )

    return {
        "modelo": MODELO_FINITO,
        "modelo_etiqueta": MODELOS[MODELO_FINITO]["etiqueta"],
        "parametros": {"lambda": lam, "mu": mu, "N": n, "nMax": None},
        "resultados": resultados,
        "distribucion": distribucion,
        "total_filas": len(distribucion),
        "advertencias": advertencias,
    }


def calcular_modelo(datos: dict[str, Any]) -> dict[str, Any]:
    """Valida y resuelve un modelo M/M/1 con los datos de la API."""

    if not isinstance(datos, dict):
        raise ErrorValidacion("El cuerpo de la solicitud debe ser un objeto JSON.")

    modelo = normalizar_modelo(datos.get("modelo"))
    lam = _a_flotante(datos.get("lambda"), "lambda", "λ (lambda)")
    mu = _a_flotante(datos.get("mu"), "mu", "μ (mu)")

    if modelo == MODELO_INFINITO:
        n_max = _a_entero(
            datos.get("nMax", 50),
            "nMax",
            "nMax (corte de tabla)",
            1,
            MAX_NMAX,
            obligatorio=False,
        )
        return _mm1_infinito(lam, mu, int(n_max or 50))

    n = _a_entero(
        datos.get("N"),
        "N",
        "N (capacidad del sistema)",
        1,
        MAX_N,
    )
    return _mm1_finito(lam, mu, int(n or 1))


def _cdf_infinita(k: int, rho: float) -> float:
    if k < 0:
        return 0.0
    if k >= MAX_INDICE_PROBABILIDAD:
        # El truncamiento seguro de la cola geométrica es prácticamente 1.
        return 1.0
    # 1 - rho^(k+1), calculado con expm1 para mayor precisión cerca de 0.
    return _probabilidad(-math.expm1((k + 1) * math.log(rho)))


def _probabilidad_infinita(tipo: str, rho: float, k: int | None, a: int | None, b: int | None) -> float:
    if tipo == "menor_igual":
        return _cdf_infinita(int(k), rho)

    if tipo == "mayor_igual":
        if int(k) <= 0:
            return 1.0
        if int(k) > MAX_INDICE_PROBABILIDAD:
            return 0.0
        return _probabilidad(math.exp(int(k) * math.log(rho)))

    # Rango: P(a <= X <= b) = rho^a * (1 - rho^(b-a+1)).
    inicio = int(a)
    fin = int(b)
    if inicio == 0:
        return _cdf_infinita(fin, rho)
    return _probabilidad(
        math.exp(inicio * math.log(rho))
        * (-math.expm1((fin - inicio + 1) * math.log(rho)))
    )


def _probabilidades_finitas(rho: float, n: int) -> list[float]:
    if abs(rho - 1.0) <= TOLERANCIA_RHO_UNO:
        return [1.0 / (n + 1)] * (n + 1)

    log_rho = math.log(rho)
    log_pesos = [indice * log_rho for indice in range(n + 1)]
    max_log = max(log_pesos)
    pesos = [math.exp(valor - max_log) for valor in log_pesos]
    suma = math.fsum(pesos)
    return [valor / suma for valor in pesos]


def _probabilidad_finita(
    tipo: str,
    rho: float,
    n: int,
    k: int | None,
    a: int | None,
    b: int | None,
) -> float:
    probabilidades = _probabilidades_finitas(rho, n)

    if tipo == "menor_igual":
        return _probabilidad(math.fsum(probabilidades[: int(k) + 1]))

    if tipo == "mayor_igual":
        return _probabilidad(math.fsum(probabilidades[int(k) :]))

    return _probabilidad(math.fsum(probabilidades[int(a) : int(b) + 1]))


def calcular_probabilidad(datos: dict[str, Any]) -> dict[str, Any]:
    """Calcula P(X <= k), P(X >= k) o P(a <= X <= b) para el modelo actual."""

    if not isinstance(datos, dict):
        raise ErrorValidacion("El cuerpo de la solicitud debe ser un objeto JSON.")

    modelo = normalizar_modelo(datos.get("modelo"))
    lam = _a_flotante(datos.get("lambda"), "lambda", "λ (lambda)")
    mu = _a_flotante(datos.get("mu"), "mu", "μ (mu)")
    rho = lam / mu

    if not math.isfinite(rho):
        raise ErrorValidacion(
            "La relación ρ = λ/μ está fuera del rango numérico representable."
        )

    tipo_original = datos.get("tipo")
    if not isinstance(tipo_original, str) or tipo_original not in _TIPOS_PROBABILIDAD:
        raise ErrorValidacion(
            "El tipo debe ser menor_igual, mayor_igual o rango.", "tipo"
        )
    tipo = _TIPOS_PROBABILIDAD[tipo_original]

    n_finito: int | None = None
    if modelo == MODELO_INFINITO:
        if rho >= 1.0:
            raise ErrorValidacion(
                "Para calcular probabilidades en el modelo sin límite se requiere "
                f"λ < μ (ρ < 1). Con estos valores ρ = {_formato_visible(rho)}.",
                "lambda",
            )
        limite = MAX_INDICE_PROBABILIDAD
    else:
        n_finito = _a_entero(
            datos.get("N"), "N", "N (capacidad del sistema)", 1, MAX_N
        )
        limite = int(n_finito or 1)

    k: int | None = None
    a: int | None = None
    b: int | None = None
    entradas: dict[str, Any] = {}

    if tipo in {"menor_igual", "mayor_igual"}:
        k = _a_entero(
            datos.get("k"),
            "k",
            "k",
            0,
            limite,
        )
        entradas = {"k": int(k or 0)}
    else:
        a = _a_entero(datos.get("a"), "a", "a", 0, limite)
        b = _a_entero(datos.get("b"), "b", "b", 0, limite)
        if int(a or 0) > int(b or 0):
            raise ErrorValidacion(
                "El límite inferior a debe ser menor o igual que b.", "a"
            )
        entradas = {"a": int(a or 0), "b": int(b or 0)}

    if modelo == MODELO_INFINITO:
        probabilidad = _probabilidad_infinita(tipo, rho, k, a, b)
        descripcion = {
            "menor_igual": f"P(X ≤ {int(k or 0)})",
            "mayor_igual": f"P(X ≥ {int(k or 0)})",
            "rango": f"P({int(a or 0)} ≤ X ≤ {int(b or 0)})",
        }[tipo]
    else:
        probabilidad = _probabilidad_finita(
            tipo, rho, int(n_finito or 1), k, a, b
        )
        descripcion = {
            "menor_igual": f"P(X ≤ {int(k or 0)})",
            "mayor_igual": f"P(X ≥ {int(k or 0)})",
            "rango": f"P({int(a or 0)} ≤ X ≤ {int(b or 0)})",
        }[tipo]

    return {
        "modelo": modelo,
        "modelo_etiqueta": etiqueta_modelo(modelo),
        "parametros": {
            "lambda": lam,
            "mu": mu,
            "N": n_finito,
        },
        "tipo": tipo,
        "entradas": entradas,
        "descripcion": descripcion,
        "probabilidad": _redondear(probabilidad),
    }
