"""Persistencia SQLite para Simulab.

La tabla `calculos` guarda los campos principales en columnas consultables y
el detalle completo en JSON. El campo `modulo` deja preparada la base para
incorporar más adelante cálculos de simulación de Monte Carlo.
"""

from __future__ import annotations

import json
import sqlite3
from pathlib import Path
from typing import Any

from flask import current_app, g

ESQUEMA_SQL = """
CREATE TABLE IF NOT EXISTS calculos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT NOT NULL,
    modulo TEXT NOT NULL DEFAULT 'analitico',
    modelo TEXT NOT NULL,
    lambda REAL NOT NULL,
    mu REAL NOT NULL,
    N INTEGER,
    nMax INTEGER,
    rho REAL NOT NULL,
    p0 REAL NOT NULL,
    Ls REAL NOT NULL,
    Lq REAL NOT NULL,
    Ws REAL NOT NULL,
    Wq REAL NOT NULL,
    lambda_efectiva REAL,
    lambda_perdida REAL,
    resultados_json TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_calculos_timestamp
    ON calculos (timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_calculos_modulo
    ON calculos (modulo, timestamp DESC);

CREATE TABLE IF NOT EXISTS calculos_mmc (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT NOT NULL,
    modelo TEXT NOT NULL,
    lambda REAL NOT NULL,
    mu REAL NOT NULL,
    c INTEGER NOT NULL,
    N INTEGER,
    rho REAL NOT NULL,
    p0 REAL NOT NULL,
    Ls REAL NOT NULL,
    Lq REAL NOT NULL,
    Ws REAL NOT NULL,
    Wq REAL NOT NULL,
    lambda_efectiva REAL NOT NULL,
    lambda_perdida REAL NOT NULL,
    servidores_inactivos REAL NOT NULL,
    servidores_activos REAL NOT NULL,
    resultados_json TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_calculos_mmc_timestamp
    ON calculos_mmc (timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_calculos_mmc_modelo
    ON calculos_mmc (modelo, timestamp DESC);
"""


def get_db() -> sqlite3.Connection:
    if "db" not in g:
        ruta = Path(current_app.config["DATABASE"])
        ruta.parent.mkdir(parents=True, exist_ok=True)
        conexion = sqlite3.connect(
            str(ruta),
            timeout=15,
            detect_types=sqlite3.PARSE_DECLTYPES,
        )
        conexion.row_factory = sqlite3.Row
        conexion.execute("PRAGMA foreign_keys = ON")
        conexion.execute("PRAGMA journal_mode = WAL")
        g.db = conexion
    return g.db


def close_db(_error: BaseException | None = None) -> None:
    conexion = g.pop("db", None)
    if conexion is not None:
        conexion.close()


def init_db() -> None:
    conexion = get_db()
    conexion.executescript(ESQUEMA_SQL)
    conexion.commit()


def init_app(app) -> None:
    app.teardown_appcontext(close_db)


def guardar_calculo(calculo: dict[str, Any], timestamp: str) -> int:
    """Guarda un cálculo y devuelve su identificador."""

    parametros = calculo["parametros"]
    resultados = calculo["resultados"]

    detalle = {
        "modelo": calculo["modelo"],
        "modelo_etiqueta": calculo["modelo_etiqueta"],
        "parametros": parametros,
        "resultados": resultados,
        "distribucion": calculo["distribucion"],
        "total_filas": calculo["total_filas"],
        "advertencias": calculo.get("advertencias", []),
    }

    conexion = get_db()
    cursor = conexion.execute(
        """
        INSERT INTO calculos (
            timestamp, modulo, modelo, lambda, mu, N, nMax,
            rho, p0, Ls, Lq, Ws, Wq,
            lambda_efectiva, lambda_perdida, resultados_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            timestamp,
            calculo.get("modulo", "analitico"),
            calculo["modelo"],
            parametros["lambda"],
            parametros["mu"],
            parametros.get("N"),
            parametros.get("nMax"),
            resultados["rho"],
            resultados["p0"],
            resultados["Ls"],
            resultados["Lq"],
            resultados["Ws"],
            resultados["Wq"],
            resultados.get("lambda_efectiva"),
            resultados.get("lambda_perdida"),
            json.dumps(detalle, ensure_ascii=False, allow_nan=False),
        ),
    )
    conexion.commit()
    return int(cursor.lastrowid)


def listar_calculos_analiticos(limite: int, offset: int) -> tuple[list[dict[str, Any]], int]:
    conexion = get_db()
    total = conexion.execute(
        "SELECT COUNT(*) AS total FROM calculos WHERE modulo = 'analitico'"
    ).fetchone()["total"]

    filas = conexion.execute(
        """
        SELECT id, timestamp, modulo, modelo, lambda, mu, N, nMax,
               rho, p0, Ls, Lq, Ws, Wq, lambda_efectiva, lambda_perdida
        FROM calculos
        WHERE modulo = 'analitico'
        ORDER BY id DESC
        LIMIT ? OFFSET ?
        """,
        (limite, offset),
    ).fetchall()

    return [dict(fila) for fila in filas], int(total)


def obtener_calculo(calculo_id: int) -> dict[str, Any] | None:
    conexion = get_db()
    fila = conexion.execute(
        "SELECT * FROM calculos WHERE id = ?",
        (calculo_id,),
    ).fetchone()
    return dict(fila) if fila is not None else None


def eliminar_calculo(calculo_id: int) -> bool:
    conexion = get_db()
    cursor = conexion.execute(
        "DELETE FROM calculos WHERE id = ?",
        (calculo_id,),
    )
    conexion.commit()
    return cursor.rowcount > 0


# ---------------------------------------------------------------------------
# Módulo 2 · M/M/c
# ---------------------------------------------------------------------------


def guardar_calculo_mmc(calculo: dict[str, Any], timestamp: str) -> int:
    """Guarda un cálculo M/M/c y devuelve su identificador."""

    parametros = calculo["parametros"]
    resultados = calculo["resultados"]

    detalle = {
        "modulo": "mmc",
        "modelo": calculo["modelo"],
        "modelo_etiqueta": calculo["modelo_etiqueta"],
        "parametros": parametros,
        "resultados": resultados,
        "distribucion": calculo["distribucion"],
        "total_filas": calculo["total_filas"],
        "advertencias": calculo.get("advertencias", []),
    }

    conexion = get_db()
    cursor = conexion.execute(
        """
        INSERT INTO calculos_mmc (
            timestamp, modelo, lambda, mu, c, N,
            rho, p0, Ls, Lq, Ws, Wq,
            lambda_efectiva, lambda_perdida,
            servidores_inactivos, servidores_activos, resultados_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            timestamp,
            calculo["modelo"],
            parametros["lambda"],
            parametros["mu"],
            parametros["c"],
            parametros.get("N"),
            resultados["rho"],
            resultados["p0"],
            resultados["Ls"],
            resultados["Lq"],
            resultados["Ws"],
            resultados["Wq"],
            resultados["lambda_efectiva"],
            resultados["lambda_perdida"],
            resultados["servidores_inactivos"],
            resultados["servidores_activos"],
            json.dumps(detalle, ensure_ascii=False, allow_nan=False),
        ),
    )
    conexion.commit()
    return int(cursor.lastrowid)


def listar_calculos_mmc(
    limite: int, offset: int
) -> tuple[list[dict[str, Any]], int]:
    conexion = get_db()
    total = conexion.execute(
        "SELECT COUNT(*) AS total FROM calculos_mmc"
    ).fetchone()["total"]

    filas = conexion.execute(
        """
        SELECT id, timestamp, modelo, lambda, mu, c, N,
               rho, p0, Ls, Lq, Ws, Wq,
               lambda_efectiva, lambda_perdida,
               servidores_inactivos, servidores_activos
        FROM calculos_mmc
        ORDER BY id DESC
        LIMIT ? OFFSET ?
        """,
        (limite, offset),
    ).fetchall()

    return [dict(fila) for fila in filas], int(total)


def obtener_calculo_mmc(calculo_id: int) -> dict[str, Any] | None:
    conexion = get_db()
    fila = conexion.execute(
        "SELECT * FROM calculos_mmc WHERE id = ?",
        (calculo_id,),
    ).fetchone()
    return dict(fila) if fila is not None else None


def eliminar_calculo_mmc(calculo_id: int) -> bool:
    conexion = get_db()
    cursor = conexion.execute(
        "DELETE FROM calculos_mmc WHERE id = ?",
        (calculo_id,),
    )
    conexion.commit()
    return cursor.rowcount > 0
