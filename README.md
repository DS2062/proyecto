# Simulab · Módulos de líneas de espera

Aplicación web para resolver analíticamente modelos de teoría de colas, con
persistencia en SQLite, gráficas interactivas y reportes PDF.

## Módulos disponibles

| Módulo | Modelos | Ruta |
| --- | --- | --- |
| M/M/1 | M/M/1:(DG/∞/∞) y M/M/1:(DG/N/∞) | `/modelos-de-colas` |
| M/M/c | M/M/c:(DG/∞/∞) y M/M/c:(DG/N/∞) | `/modelos-de-colas/mmc` |

Cada módulo incluye:

- Cálculo de métricas: ρ, P₀, Ls, Lq, Ws, Wq, servidores activos e inactivos.
- Distribución de probabilidad `p(n)` y acumulada `F(n)` con Chart.js.
- Calculadora de probabilidades `P(X ≤ k)`, `P(X ≥ k)` y `P(a ≤ X ≤ b)`.
- Historial de cálculos guardado en SQLite.
- Reporte PDF con cabecera, resultados, gráficas y tabla de distribución.
- Tema claro/oscuro.

## Requisitos

- Python 3.10+
- Git

## Ejecución local

```powershell
git clone <URL_DEL_REPOSITORIO>
cd proyecto
python -m venv venv
.\venv\Scripts\Activate.ps1
pip install -r backend/requirements.txt
py backend/app.py
```

Abre `http://127.0.0.1:5000`.

La guía paso a paso también está disponible en [`EJECUCION.md`](EJECUCION.md).

Para ubicar funciones, fórmulas y puntos de modificación del código, consulta
la [`GUIA_TECNICA.md`](GUIA_TECNICA.md).

## Pruebas

```powershell
cd backend
py -m unittest discover -s tests -v
```

## Estructura

```text
backend/
  app.py             API REST y servidor Flask
  database.py        Persistencia SQLite (calculos y calculos_mmc)
  queueing.py        Motor analítico M/M/1
  queueing_mmc.py    Motor analítico M/M/c
  tests/             Pruebas de modelos y API
frontend/
  inicio.html        Portada con los módulos
  index.html         Interfaz M/M/1
  mmc.html           Interfaz M/M/c
  app.js             Lógica del módulo M/M/1
  mmc.js             Lógica del módulo M/M/c
  styles.css         Estilos, temas, responsive e impresión
  vendor/            Bootstrap, Chart.js y jsPDF incluidos localmente
```

## API principal

- `POST /api/calcular` — resuelve un modelo y guarda el cálculo.
- `POST /api/probabilidad` — calcula un evento de probabilidad.
- `GET /api/historial?modulo=mmc` — lista cálculos (usa `analitico` por defecto).
- `GET /api/calculo/<id>?modulo=mmc` — obtiene el detalle de un cálculo.
- `DELETE /api/calculo/<id>?modulo=mmc` — elimina un cálculo.
- `GET /api/salud` — estado del servicio.

## Notas

- Toda la matemática se ejecuta en el backend; el frontend solo consume la API.
- La base SQLite se crea automáticamente en `backend/database.db`.
- Los recursos del frontend están incluidos en `frontend/vendor`, por lo que la
  aplicación funciona sin conexión a internet.
