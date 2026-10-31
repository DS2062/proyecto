# Simulab · Módulo de colas M/M/1

Simulab es una aplicación web cliente-servidor en español para resolver modelos analíticos de líneas de espera **M/M/1** con cola ilimitada y con capacidad limitada. Incluye una portada de módulos, tema claro/oscuro, API REST, persistencia SQLite, gráficas con Chart.js, cálculo de probabilidades, reportes PDF e historial.

![Modelos](https://img.shields.io/badge/modelos-M%2FM%2F1%20%C2%B7%20M%2FM%2F1%2FN-4f46e5)
![Backend](https://img.shields.io/badge/backend-Flask%203-0ea5e9)
![Base de datos](https://img.shields.io/badge/base%20de%20datos-SQLite-64748b)

## Características

- **M/M/1:(DG/∞/∞)** con cola ilimitada; exige `ρ = λ/μ < 1`.
- **M/M/1:(DG/N/∞)** con capacidad finita `N`; admite `ρ < 1`, `ρ = 1` y `ρ > 1`.
- Todos los cálculos se ejecutan en el **backend**; el frontend solo presenta resultados.
- Resultados con **hasta 4 decimales** en pantalla y PDF; las probabilidades menores a `0.001` y la columna acumulada conservan hasta 6 decimales. Los números enteros se muestran sin decimales.
- Distribución de probabilidad `p(n)` y acumulada `P(X ≤ n)`, con gráficas absoluta y acumulada.
- Calculadora de `P(X ≤ k)`, `P(X ≥ k)` y `P(a ≤ X ≤ b)`.
- Reportes **PDF** con metadatos, métricas, gráficas, tabla de distribución y probabilidad consultada.
- **Historial** persistente en SQLite: abrir, eliminar y paginar cálculos.
- **Tema claro/oscuro** con botón flotante; sigue la preferencia del sistema en la primera visita y recuerda la elección manual.
- Interfaz responsiva en español con Bootstrap 5 y librerías locales (funciona sin CDN).
- Base preparada para incorporar simulación de **Monte Carlo** en el futuro.

## Tecnologías

| Capa | Tecnología |
| --- | --- |
| Backend | Python 3.10+, Flask 3, Flask-CORS |
| Base de datos | SQLite (archivo local) |
| Frontend | HTML5, CSS3, JavaScript vanilla, Bootstrap 5 |
| Gráficas | Chart.js |
| Reportes | jsPDF + jspdf-autotable, fuentes DejaVu Sans |

## Estructura del proyecto

```text
proyecto/
├── backend/
│   ├── app.py               # Fábrica Flask, rutas REST y servidor del frontend
│   ├── queueing.py          # Validación y fórmulas M/M/1
│   ├── database.py          # Esquema SQLite y persistencia
│   ├── requirements.txt     # Dependencias de Python
│   ├── database.db          # Base de datos local (se crea automáticamente)
│   └── tests/
│       └── test_app.py      # Pruebas de fórmulas y API
├── frontend/
│   ├── inicio.html          # Portada con los módulos disponibles
│   ├── index.html           # Interfaz del módulo de colas
│   ├── styles.css           # Estilos de la interfaz (incluye tema oscuro)
│   ├── app.js               # Lógica de UI, gráficas, PDF e historial
│   ├── theme.js             # Detección, persistencia y alternancia del tema
│   ├── favicon.svg
│   └── vendor/              # Bootstrap, Chart.js, jsPDF, autotable y fuentes
└── README.md
```

## Requisitos

- **Python 3.10 o superior** (se usa sintaxis moderna de tipos).
- Un navegador actual (Chrome, Edge, Firefox o Safari).
- No se requiere Node.js ni conexión a Internet: las librerías del frontend están incluidas localmente.

## Instalación y ejecución

### Windows (PowerShell)

```powershell
cd C:\Users\Hector\Desktop\proyecto\backend
py -m venv .venv
.\.venv\Scripts\Activate.ps1
py -m pip install -r requirements.txt
py app.py
```

Si PowerShell bloquea la activación del entorno virtual:

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
```

También puedes omitir el entorno virtual e instalar las dependencias directamente:

```powershell
cd C:\Users\Hector\Desktop\proyecto\backend
py -m pip install -r requirements.txt
py app.py
```

### Linux / macOS

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
python app.py
```

Abre el navegador en **<http://127.0.0.1:5000>** para ver la portada de Simulab. El módulo de colas está en **<http://127.0.0.1:5000/modelos-de-colas>**. Flask sirve la API y el frontend desde el mismo origen.

### Variables de entorno opcionales

| Variable | Valor por defecto | Descripción |
| --- | --- | --- |
| `PORT` | `5000` | Puerto HTTP |
| `HOST` | `127.0.0.1` | Interfaz de escucha |
| `FLASK_DEBUG` | `0` | `1` activa el modo depuración |
| `QUEUELAB_DB` | `backend/database.db` | Ruta alternativa de la base SQLite |

Ejemplo:

```powershell
$env:PORT = "8080"; py app.py
```

### Ejecución con el servidor de Flask

```powershell
cd backend
py -m flask --app app run --port 5000
```

## Uso de la interfaz

1. En la portada, elige **Modelo de colas**.
2. Elige el modelo: **cola ilimitada** o **capacidad limitada**.
3. Captura `λ` (tasa de llegada) y `μ` (tasa de servicio) en las mismas unidades de tiempo.
4. Para capacidad limitada, indica `N` (incluye al cliente en servicio). La tabla llega hasta `N` o antes si la acumulada es prácticamente 1.
5. Para cola ilimitada, ajusta `nMax` (corte máximo de la tabla, por defecto 50). La tabla puede terminar antes cuando la probabilidad acumulada es prácticamente 1.
6. Presiona **Calcular**. Los resultados se guardan automáticamente en el historial.
7. Consulta las pestañas **Resultados**, **Distribución**, **Probabilidades** e **Historial**.
8. Genera un **PDF** con el botón de ancho completo situado debajo del panel de resultados.
9. En **Historial**, usa **Anterior** y **Siguiente** para recorrer los cálculos guardados en páginas de 25 registros.
10. Usa el **botón flotante inferior izquierdo** para alternar entre tema claro y oscuro. La elección se conserva en el navegador y se comparte entre la portada y el módulo.

### Ejemplos rápidos

| Modelo | λ | μ | N | Resultado esperado |
| --- | --- | --- | --- | --- |
| Ilimitado | 8 | 10 | — | `ρ = 0.8`, `P₀ = 0.2`, `Ls = 4` |
| Finito | 4 | 6 | 2 | `ρ = 0.6667`, `pN = 0.2105`, `λ_efectiva = 3.1579` |
| Finito (ρ = 1) | 6 | 6 | 3 | `P₀ = pN = 0.25`, `Ls = 1.5` |
| Finito (ρ > 1) | 12 | 6 | 3 | `pN = 0.5333`, `λ_efectiva = 5.6` |

## Modelos y fórmulas

Notación: `λ` llegadas por unidad de tiempo, `μ` servicios por unidad de tiempo, `ρ = λ/μ`, `N` capacidad del sistema (incluye el cliente en servicio).

### M/M/1:(DG/∞/∞) — cola ilimitada

Válido solo para `ρ < 1`.

```text
P₀ = 1 − ρ
p(n) = (1 − ρ) · ρⁿ          n = 0, 1, 2, …
Ls = ρ / (1 − ρ)
Lq = ρ² / (1 − ρ)
Ws = Ls / λ
Wq = Lq / λ
λ_efectiva = λ
λ_perdida = 0
```

### M/M/1:(DG/N/∞) — capacidad finita

Válido para cualquier `ρ > 0`.

Para `ρ ≠ 1`:

```text
P₀ = (1 − ρ) / (1 − ρ^(N+1))
p(n) = P₀ · ρⁿ               n = 0, 1, …, N
pN = p(N)                    probabilidad de bloqueo
λ_efectiva = λ · (1 − pN)
λ_perdida = λ · pN
Ls = Σ n · p(n)              n = 0…N
Lq = Ls − (1 − P₀)
Ws = Ls / λ_efectiva
Wq = Lq / λ_efectiva
Utilización real = 1 − P₀
```

Para `ρ = 1` se aplican las fórmulas especiales:

```text
P₀ = p(n) = pN = 1 / (N + 1)
Ls = N / 2
Lq = Ls − (1 − P₀)
λ_efectiva = λ · (1 − pN)
λ_perdida = λ · pN
Ws = Ls / λ_efectiva
Wq = Lq / λ_efectiva
```

Las probabilidades se calculan en espacio logarítmico y con formas estables (`expm1`) para evitar desbordamientos cuando `ρ` es muy grande, muy pequeño o cercano a 1.

### Calculadora de probabilidades

```text
P(X ≤ k)     = Σ p(n), n = 0…k
P(X ≥ k)     = 1 − P(X ≤ k − 1)
P(a ≤ X ≤ b) = Σ p(n), n = a…b
```

- En el modelo finito, el rango válido es `0 ≤ n ≤ N`.
- En el modelo ilimitado, la cola geométrica se trunca de forma segura; para índices muy grandes el resultado se aproxima a 1.

## API REST

Base: `http://127.0.0.1:5000`

### `POST /api/calcular`

Cola ilimitada:

```json
{
  "modelo": "mm1_infinito",
  "lambda": 8,
  "mu": 10,
  "nMax": 50
}
```

Capacidad finita:

```json
{
  "modelo": "mm1_finito",
  "lambda": 4,
  "mu": 6,
  "N": 2
}
```

Respuesta (fragmento):

```json
{
  "ok": true,
  "mensaje": "Cálculo realizado y guardado correctamente.",
  "calculo": {
    "id": 1,
    "timestamp": "2026-10-28T23:44:24Z",
    "modulo": "analitico",
    "modelo": "mm1_finito",
    "modelo_etiqueta": "M/M/1:(DG/N/∞)",
    "parametros": { "lambda": 4.0, "mu": 6.0, "N": 2, "nMax": null },
    "resultados": {
      "rho": 0.666667,
      "p0": 0.473684,
      "Ls": 0.736842,
      "Lq": 0.210526,
      "Ws": 0.233333,
      "Wq": 0.066667,
      "lambda_efectiva": 3.157895,
      "lambda_perdida": 0.842105,
      "pN": 0.210526,
      "utilizacion": 0.526316
    },
    "distribucion": [
      { "n": 0, "p": 0.473684, "acumulada": 0.473684 }
    ],
    "total_filas": 3,
    "advertencias": []
  }
}
```

La API conserva 6 decimales como precisión de cálculo; la interfaz y los reportes PDF muestran hasta 4 decimales, hasta 6 cuando la probabilidad es menor a `0.001`, y hasta 6 en la columna acumulada.

### `POST /api/probabilidad`

```json
{
  "modelo": "mm1_finito",
  "lambda": 4,
  "mu": 6,
  "N": 2,
  "tipo": "menor_igual",
  "k": 1
}
```

Tipos admitidos: `menor_igual`, `mayor_igual`, `rango`.

```json
{
  "modelo": "mm1_infinito",
  "lambda": 8,
  "mu": 10,
  "nMax": 50,
  "tipo": "rango",
  "a": 2,
  "b": 5
}
```

Respuesta:

```json
{
  "ok": true,
  "descripcion": "P(X ≤ 1)",
  "probabilidad": 0.789474,
  "formula": "P(X ≤ 1) = Σ p(n), n = 0…1 · p(n) = p₀·ρ^n"
}
```

### `GET /api/historial?limite=20&offset=0`

Devuelve `total`, `limite`, `offset` y la lista de cálculos resumidos, ordenados del más reciente al más antiguo. `limite` admite valores de 1 a 100; la interfaz solicita 25 registros por página y muestra controles **Anterior** / **Siguiente** cuando hay más de una página.

### `GET /api/calculo/<id>`

Devuelve el detalle completo de un cálculo, incluida su distribución.

### `DELETE /api/calculo/<id>`

Elimina un cálculo del historial.

### `GET /api/salud`

Verificación de disponibilidad del servicio.

### Errores

Las solicitudes inválidas devuelven **HTTP 400** con un mensaje claro:

```json
{
  "ok": false,
  "error": "El modelo sin límite requiere λ < μ (ρ < 1). Con estos valores ρ = 1.000000.",
  "campo": "lambda"
}
```

Ejemplos de validación:

- `λ` y `μ` deben ser números finitos mayores que 0.
- En el modelo ilimitado se exige `λ < μ`.
- `N` debe ser un entero entre 1 y 10 000. La tabla puede terminar antes de `N` cuando la acumulada es prácticamente 1.
- `nMax` debe ser un entero entre 1 y 10 000. En el modelo ilimitado es el corte máximo; la tabla puede terminar antes cuando la acumulada es prácticamente 1.
- Los índices de probabilidad deben ser enteros no negativos y respetar el rango del modelo.

## Base de datos

El archivo `backend/database.db` se crea automáticamente al iniciar la aplicación. La tabla `calculos` guarda columnas consultables (`lambda`, `mu`, `N`, `rho`, `p0`, `Ls`, `Lq`, `Ws`, `Wq`, `lambda_efectiva`, `lambda_perdida`, `modulo`) y el detalle completo en `resultados_json`.

Para restablecer el historial, detén el servidor y ejecuta:

```powershell
cd backend
Remove-Item database.db
py app.py
```

La aplicación vuelve a crear la base vacía al arrancar.

## Reportes PDF

- El PDF incluye título, fecha, modelo, parámetros, métricas principales, las métricas adicionales del modelo finito (`λ_efectiva`, `λ_perdida`, `pN`), gráficas, tabla de distribución y la probabilidad consultada.
- Las gráficas se insertan como imágenes y se acomodan en dos columnas para evitar filas huérfanas en la tabla.
- La tabla de distribución se divide por páginas repitiendo el encabezado.
- Las fuentes DejaVu Sans incluidas permiten mostrar `ρ`, `λ`, `μ`, `∞`, `≤` y subíndices en el PDF.
- Los valores se presentan con hasta 4 decimales; los enteros se muestran sin decimales, las probabilidades menores a `0.001` conservan hasta 6 decimales y la columna acumulada usa hasta 6 decimales.
- El reporte se genera **siempre en tema claro**, aunque la interfaz esté en oscuro.
- El archivo descargado se nombra `Simulab_MM1_<modelo>_<fecha>.pdf`.

## Pruebas

Desde la carpeta `backend`:

```powershell
py -X utf8 -m unittest discover -s tests -v
```

Las pruebas cubren:

- Fórmulas clásicas del modelo ilimitado.
- Rechazo de `ρ ≥ 1` en el modelo ilimitado.
- Fórmulas generales del modelo finito.
- Caso especial `ρ = 1`.
- Comportamiento con `ρ > 1` sin `NaN` ni `Infinity`.
- Cálculo de probabilidades finitas e infinitas.
- Flujo completo de la API, paginación, validación y errores.
- Portada en `/` y módulo de colas en `/modelos-de-colas`.

## Extensión futura: Monte Carlo

La arquitectura ya está preparada para añadir simulación:

1. **Campo `modulo`** en `calculos` distingue `analitico` de futuros módulos como `montecarlo`.
2. **`resultados_json`** permite guardar resultados específicos sin migrar el esquema.
3. Se puede agregar un módulo `backend/montecarlo.py` con simulación de llegadas y servicios exponenciales.
4. Las rutas podrían ampliarse con `POST /api/simular` y `GET /api/simulaciones`.
5. El frontend puede incorporar una pestaña adicional reutilizando las gráficas y el generador de reportes.

## Notas

- Los tiempos `Ws` y `Wq` se expresan en las mismas unidades de tiempo que `λ` y `μ`.
- Los resultados mostrados en pantalla y PDF usan hasta 4 decimales; la API y el almacenamiento conservan 6 decimales como precisión de cálculo.
- Si `ρ` está muy cerca de 1 en el modelo ilimitado, la interfaz muestra una advertencia por la sensibilidad de las métricas.
