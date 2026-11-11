"""API REST y servidor del módulo analítico Simulab."""

from __future__ import annotations

import json
import logging
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from flask import Flask, jsonify, request, send_from_directory
from flask_cors import CORS
from werkzeug.exceptions import HTTPException

from database import (
    eliminar_calculo,
    eliminar_calculo_mmc,
    guardar_calculo,
    guardar_calculo_mmc,
    init_app as init_database_app,
    init_db,
    listar_calculos_analiticos,
    listar_calculos_mmc,
    obtener_calculo,
    obtener_calculo_mmc,
)
from queueing import (
    ErrorValidacion,
    calcular_modelo,
    calcular_probabilidad,
    etiqueta_modelo,
)
from queueing_mmc import (
    calcular_modelo_mmc,
    calcular_probabilidad_mmc,
    es_modelo_mmc,
    etiqueta_modelo_mmc,
)

BASE_DIR = Path(__file__).resolve().parent
FRONTEND_DIR = BASE_DIR.parent / "frontend"
DEFAULT_DATABASE = BASE_DIR / "database.db"


def _ahora_iso() -> str:
    return (
        datetime.now(timezone.utc)
        .replace(microsecond=0)
        .isoformat()
        .replace("+00:00", "Z")
    )


def _recurso_calculo(
    calculo: dict[str, Any], calculo_id: int, timestamp: str
) -> dict[str, Any]:
    return {
        "id": calculo_id,
        "timestamp": timestamp,
        "modulo": "analitico",
        "modelo": calculo["modelo"],
        "modelo_etiqueta": calculo["modelo_etiqueta"],
        "parametros": calculo["parametros"],
        "resultados": calculo["resultados"],
        "distribucion": calculo["distribucion"],
        "total_filas": calculo["total_filas"],
        "advertencias": calculo.get("advertencias", []),
    }


def _leer_detalle(fila: dict[str, Any]) -> dict[str, Any]:
    try:
        detalle = json.loads(fila["resultados_json"])
    except (TypeError, json.JSONDecodeError):
        detalle = {}

    return {
        "id": fila["id"],
        "timestamp": fila["timestamp"],
        "modulo": fila.get("modulo", "analitico"),
        "modelo": fila["modelo"],
        "modelo_etiqueta": detalle.get(
            "modelo_etiqueta", etiqueta_modelo(fila["modelo"])
        ),
        "parametros": detalle.get(
            "parametros",
            {
                "lambda": fila["lambda"],
                "mu": fila["mu"],
                "N": fila.get("N"),
                "nMax": fila.get("nMax"),
            },
        ),
        "resultados": detalle.get(
            "resultados",
            {
                "rho": fila["rho"],
                "p0": fila["p0"],
                "Ls": fila["Ls"],
                "Lq": fila["Lq"],
                "Ws": fila["Ws"],
                "Wq": fila["Wq"],
                "lambda_efectiva": fila.get("lambda_efectiva"),
                "lambda_perdida": fila.get("lambda_perdida"),
            },
        ),
        "distribucion": detalle.get("distribucion", []),
        "total_filas": detalle.get(
            "total_filas", len(detalle.get("distribucion", []))
        ),
        "advertencias": detalle.get("advertencias", []),
    }


def _resumen_calculo(fila: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": fila["id"],
        "timestamp": fila["timestamp"],
        "modelo": fila["modelo"],
        "modelo_etiqueta": etiqueta_modelo(fila["modelo"]),
        "parametros": {
            "lambda": fila["lambda"],
            "mu": fila["mu"],
            "N": fila.get("N"),
            "nMax": fila.get("nMax"),
        },
        "resultados": {
            "rho": fila["rho"],
            "p0": fila["p0"],
            "Ls": fila["Ls"],
            "Lq": fila["Lq"],
            "Ws": fila["Ws"],
            "Wq": fila["Wq"],
            "lambda_efectiva": fila.get("lambda_efectiva"),
            "lambda_perdida": fila.get("lambda_perdida"),
        },
    }


def _recurso_calculo_mmc(
    calculo: dict[str, Any], calculo_id: int, timestamp: str
) -> dict[str, Any]:
    return {
        "id": calculo_id,
        "timestamp": timestamp,
        "modulo": "mmc",
        "modelo": calculo["modelo"],
        "modelo_etiqueta": calculo["modelo_etiqueta"],
        "parametros": calculo["parametros"],
        "resultados": calculo["resultados"],
        "distribucion": calculo["distribucion"],
        "total_filas": calculo["total_filas"],
        "advertencias": calculo.get("advertencias", []),
    }


def _leer_detalle_mmc(fila: dict[str, Any]) -> dict[str, Any]:
    try:
        detalle = json.loads(fila["resultados_json"])
    except (TypeError, json.JSONDecodeError):
        detalle = {}

    return {
        "id": fila["id"],
        "timestamp": fila["timestamp"],
        "modulo": "mmc",
        "modelo": fila["modelo"],
        "modelo_etiqueta": detalle.get(
            "modelo_etiqueta", etiqueta_modelo_mmc(fila["modelo"])
        ),
        "parametros": detalle.get(
            "parametros",
            {
                "lambda": fila["lambda"],
                "mu": fila["mu"],
                "c": fila["c"],
                "N": fila.get("N"),
                "nMax": None,
            },
        ),
        "resultados": detalle.get(
            "resultados",
            {
                "rho": fila["rho"],
                "p0": fila["p0"],
                "Ls": fila["Ls"],
                "Lq": fila["Lq"],
                "Ws": fila["Ws"],
                "Wq": fila["Wq"],
                "lambda_efectiva": fila.get("lambda_efectiva"),
                "lambda_perdida": fila.get("lambda_perdida"),
                "servidores_inactivos": fila.get("servidores_inactivos"),
                "servidores_activos": fila.get("servidores_activos"),
            },
        ),
        "distribucion": detalle.get("distribucion", []),
        "total_filas": detalle.get(
            "total_filas", len(detalle.get("distribucion", []))
        ),
        "advertencias": detalle.get("advertencias", []),
    }


def _resumen_calculo_mmc(fila: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": fila["id"],
        "timestamp": fila["timestamp"],
        "modelo": fila["modelo"],
        "modelo_etiqueta": etiqueta_modelo_mmc(fila["modelo"]),
        "parametros": {
            "lambda": fila["lambda"],
            "mu": fila["mu"],
            "c": fila["c"],
            "N": fila.get("N"),
        },
        "resultados": {
            "rho": fila["rho"],
            "p0": fila["p0"],
            "Ls": fila["Ls"],
            "Lq": fila["Lq"],
            "Ws": fila["Ws"],
            "Wq": fila["Wq"],
            "lambda_efectiva": fila.get("lambda_efectiva"),
            "lambda_perdida": fila.get("lambda_perdida"),
            "servidores_inactivos": fila.get("servidores_inactivos"),
            "servidores_activos": fila.get("servidores_activos"),
        },
    }


def _query_modulo() -> str:
    valor = (request.args.get("modulo") or "analitico").strip().lower()
    if valor not in {"analitico", "mmc"}:
        raise ErrorValidacion(
            "El parámetro modulo debe ser analitico o mmc.", "modulo"
        )
    return valor


def _query_entero(nombre: str, predeterminado: int, minimo: int, maximo: int) -> int:
    raw = request.args.get(nombre)
    if raw is None or raw == "":
        return predeterminado
    try:
        valor = int(raw)
    except (TypeError, ValueError) as exc:
        raise ErrorValidacion(
            f"El parámetro {nombre} debe ser un entero.", nombre
        ) from exc
    if valor < minimo or valor > maximo:
        raise ErrorValidacion(
            f"El parámetro {nombre} debe estar entre {minimo} y {maximo}.", nombre
        )
    return valor


def create_app(test_config: dict[str, Any] | None = None) -> Flask:
    app = Flask(
        __name__,
        static_folder=str(FRONTEND_DIR),
        static_url_path="",
    )

    app.config.from_mapping(
        DATABASE=os.environ.get("QUEUELAB_DB", str(DEFAULT_DATABASE)),
        MAX_CONTENT_LENGTH=1024 * 1024,
        JSON_SORT_KEYS=False,
    )
    if test_config:
        app.config.update(test_config)

    app.json.ensure_ascii = False
    app.json.sort_keys = False

    CORS(
        app,
        resources={
            r"/api/*": {
                "origins": "*",
                "methods": ["GET", "POST", "DELETE", "OPTIONS"],
                "allow_headers": ["Content-Type"],
            }
        },
    )
    init_database_app(app)

    with app.app_context():
        init_db()

    @app.after_request
    def _cabeceras(response):
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "same-origin"
        if request.path.startswith("/api/"):
            response.headers["Cache-Control"] = "no-store"
        return response

    @app.get("/")
    def inicio():
        return send_from_directory(FRONTEND_DIR, "inicio.html")

    @app.get("/modelos-de-colas")
    def modelos_de_colas():
        return send_from_directory(FRONTEND_DIR, "index.html")

    @app.get("/modelos-de-colas/mmc")
    def modelos_de_colas_mmc():
        return send_from_directory(FRONTEND_DIR, "mmc.html")

    @app.get("/api/salud")
    def salud():
        return jsonify(
            {
                "ok": True,
                "servicio": "Simulab API",
                "modulo": "analitico",
                "modulos": ["analitico", "mmc"],
                "version": "1.1.0",
                "timestamp": _ahora_iso(),
            }
        )

    @app.post("/api/calcular")
    def api_calcular():
        datos = request.get_json(silent=True)
        if datos is None:
            raise ErrorValidacion(
                "Envía un cuerpo JSON válido con modelo, lambda, mu, c, N y nMax."
            )

        timestamp = _ahora_iso()

        if es_modelo_mmc(datos.get("modelo")):
            calculo = calcular_modelo_mmc(datos)
            calculo_id = guardar_calculo_mmc(calculo, timestamp)
            recurso = _recurso_calculo_mmc(calculo, calculo_id, timestamp)
        else:
            calculo = calcular_modelo(datos)
            calculo_id = guardar_calculo(calculo, timestamp)
            recurso = _recurso_calculo(calculo, calculo_id, timestamp)

        return jsonify(
            {
                "ok": True,
                "mensaje": "Cálculo realizado y guardado correctamente.",
                "calculo": recurso,
            }
        )

    @app.post("/api/probabilidad")
    def api_probabilidad():
        datos = request.get_json(silent=True)
        if datos is None:
            raise ErrorValidacion(
                "Envía un cuerpo JSON válido con el modelo, sus parámetros y el evento."
            )

        if es_modelo_mmc(datos.get("modelo")):
            resultado = calcular_probabilidad_mmc(datos)
        else:
            resultado = calcular_probabilidad(datos)
        return jsonify({"ok": True, **resultado})

    @app.get("/api/historial")
    def api_historial():
        limite = _query_entero("limite", 20, 1, 100)
        offset = _query_entero("offset", 0, 0, 10_000_000)
        modulo = _query_modulo()

        if modulo == "mmc":
            filas, total = listar_calculos_mmc(limite, offset)
            resumenes = [_resumen_calculo_mmc(fila) for fila in filas]
        else:
            filas, total = listar_calculos_analiticos(limite, offset)
            resumenes = [_resumen_calculo(fila) for fila in filas]

        return jsonify(
            {
                "ok": True,
                "modulo": modulo,
                "total": total,
                "limite": limite,
                "offset": offset,
                "calculos": resumenes,
            }
        )

    @app.get("/api/calculo/<int:calculo_id>")
    def api_obtener_calculo(calculo_id: int):
        modulo = _query_modulo()
        fila = (
            obtener_calculo_mmc(calculo_id)
            if modulo == "mmc"
            else obtener_calculo(calculo_id)
        )
        if fila is None:
            return (
                jsonify(
                    {
                        "ok": False,
                        "error": "No existe un cálculo con ese identificador.",
                    }
                ),
                404,
            )
        detalle = (
            _leer_detalle_mmc(fila) if modulo == "mmc" else _leer_detalle(fila)
        )
        return jsonify({"ok": True, "calculo": detalle})

    @app.delete("/api/calculo/<int:calculo_id>")
    def api_eliminar_calculo(calculo_id: int):
        modulo = _query_modulo()
        eliminado = (
            eliminar_calculo_mmc(calculo_id)
            if modulo == "mmc"
            else eliminar_calculo(calculo_id)
        )
        if not eliminado:
            return (
                jsonify(
                    {
                        "ok": False,
                        "error": "No existe un cálculo con ese identificador.",
                    }
                ),
                404,
            )
        return jsonify({"ok": True, "mensaje": "Cálculo eliminado correctamente."})

    @app.errorhandler(ErrorValidacion)
    def _manejar_validacion(error: ErrorValidacion):
        cuerpo: dict[str, Any] = {"ok": False, "error": error.mensaje}
        if error.campo:
            cuerpo["campo"] = error.campo
        return jsonify(cuerpo), 400

    @app.errorhandler(HTTPException)
    def _manejar_http(error: HTTPException):
        if request.path.startswith("/api/"):
            mensajes = {
                404: "El recurso solicitado no existe.",
                405: "Método HTTP no permitido para este recurso.",
                413: "La solicitud es demasiado grande.",
            }
            return (
                jsonify(
                    {
                        "ok": False,
                        "error": mensajes.get(
                            error.code, error.description or "Error HTTP."
                        ),
                    }
                ),
                error.code or 500,
            )
        return error

    @app.errorhandler(Exception)
    def _manejar_error(error: Exception):
        if isinstance(error, HTTPException):
            return _manejar_http(error)
        app.logger.exception("Error no controlado en la API")
        return (
            jsonify(
                {
                    "ok": False,
                    "error": "Ocurrió un error interno. Inténtalo de nuevo.",
                }
            ),
            500,
        )

    return app


app = create_app()


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    puerto = int(os.environ.get("PORT", "5000"))
    host = os.environ.get("HOST", "127.0.0.1")
    debug = os.environ.get("FLASK_DEBUG", "0") == "1"
    app.run(host=host, port=puerto, debug=debug)
