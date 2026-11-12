# Guía técnica de Simulab

Documento de orientación para localizar funciones, fórmulas y puntos de modificación del proyecto.

- **Versión de referencia:** commit `ad83a93` (2026-11-11).
- **Público:** personas que necesitan cambiar fórmulas, validaciones, textos o añadir métricas sin conocer todo el proyecto.
- **Idea central:** todos los cálculos matemáticos viven en `backend/`. El frontend solo captura datos, llama a la API y presenta resultados. Si cambias una fórmula y mantienes los mismos nombres de campos, normalmente **no** hay que tocar el JavaScript.

> Los números de línea son aproximados y pueden desplazarse al editar. Guíate por el **nombre de la función** y por el bloque indicado.

## 0. Si te piden un cambio, empieza aquí

| Petición típica | Dónde ir |
|---|---|
| Cambiar una fórmula de M/M/1 | `backend/queueing.py` → `_mm1_infinito` (~226) o `_mm1_finito` (~295). |
| Cambiar una fórmula de M/M/c | `backend/queueing_mmc.py` → `_mmc_infinito` (~247) o `_mmc_finito` (~332). |
| Cambiar `Lq`, `Ls`, `Ws`, `Wq`, `P₀` o `ρ` | Busca el nombre del campo en el diccionario `resultados` de la función del modelo. |
| Añadir una métrica nueva | Receta **B** (sección 7): backend → HTML/KPI → tabla → PDF → pruebas. |
| Cambiar límites o validaciones | Receta **C** (sección 7). |
| Cambiar probabilidades | Receta **I** (sección 7). |
| Cambiar textos o etiquetas de un modelo | `MODELOS` / `MODELOS_MMC` en el backend y el `<select id="modelo">` en el HTML. |
| Cambiar lo que sale en el PDF | Receta **G** (sección 7). |
| Saber de dónde sale un número en pantalla | Sección **8**. |

Regla de oro: **la fórmula se cambia en el backend**; si conservas el nombre del campo JSON, la interfaz y el PDF se actualizan solos.

---

## 1. Mapa rápido del proyecto

| Ruta | Qué contiene | Cuándo modificarla |
|---|---|---|
| `backend/queueing.py` | Motor matemático **M/M/1** (infinito y finito) y probabilidades. | Cambiar fórmulas, validaciones o métricas de M/M/1. |
| `backend/queueing_mmc.py` | Motor matemático **M/M/c** (infinito y finito) y probabilidades. | Cambiar fórmulas, validaciones o métricas de M/M/c. |
| `backend/app.py` | Servidor Flask, rutas de páginas y endpoints `/api/*`. | Añadir rutas, endpoints o cambiar el formato de respuesta. |
| `backend/database.py` | Esquema SQLite y operaciones de guardado/consulta/borrado. | Añadir columnas, tablas o cambiar la persistencia. |
| `backend/tests/test_app.py` | Pruebas de M/M/1, API, historial y validaciones. | Después de cambiar fórmulas o endpoints. |
| `backend/tests/test_mmc.py` | Pruebas de M/M/c, API, caso crítico y probabilidades. | Después de cambiar fórmulas o endpoints de M/M/c. |
| `frontend/index.html` | Interfaz M/M/1. | Añadir campos, tarjetas, pestañas o textos. |
| `frontend/app.js` | Lógica de la interfaz M/M/1. | Validación, render, gráficas, historial y PDF de M/M/1. |
| `frontend/mmc.html` | Interfaz M/M/c. | Añadir campos, tarjetas, pestañas o textos. |
| `frontend/mmc.js` | Lógica de la interfaz M/M/c. | Validación, render, gráficas, historial y PDF de M/M/c. |
| `frontend/theme.js` | Cambio de tema claro/oscuro con barrido. | Cambiar comportamiento del tema. |
| `frontend/styles.css` | Estilos, variables de color, tema oscuro y animaciones. | Cambiar apariencia o el efecto de barrido. |
| `frontend/inicio.html` | Portada con las tarjetas de los módulos. | Añadir un módulo nuevo a la portada. |
| `README.md` / `EJECUCION.md` | Descripción general y guía de instalación/ejecución. | Cambiar requisitos o instrucciones. |

Los archivos `frontend/vendor/*` son librerías de terceros (Bootstrap, Chart.js, jsPDF). **No se editan.**

---

## 2. Cómo ejecutar y probar

Desde la raíz del proyecto:

```powershell
# Servidor (una terminal)
py backend/app.py

# Pruebas (otra terminal)
cd backend
py -m unittest discover -s tests -v
```

- Aplicación: `http://127.0.0.1:5000/`
- M/M/1: `http://127.0.0.1:5000/modelos-de-colas`
- M/M/c: `http://127.0.0.1:5000/modelos-de-colas/mmc`

Si las pruebas fallan con `ModuleNotFoundError: No module named 'app'`, ejecútalas **desde la carpeta `backend`**, como se muestra arriba.

La base de datos es `backend/database.db` (ignorada por git). Se crea sola al arrancar. Si cambias el esquema y no tienes datos que conservar, puedes borrarla para que se regenere.

---

## 3. Arquitectura y flujo de una operación

```text
Formulario HTML
   │  (app.js / mmc.js valida y arma el JSON)
   ▼
POST /api/calcular  ──►  app.py
                          │
                          ├─ modelo M/M/1  ──► queueing.calcular_modelo()
                          ├─ modelo M/M/c  ──► queueing_mmc.calcular_modelo_mmc()
                          │
                          ├─ guardar_calculo() / guardar_calculo_mmc()
                          ▼
                       SQLite (calculos / calculos_mmc)
                          │
                          ▼
                 Respuesta JSON con cálculo + id
                          │
                          ▼
Frontend: render de KPIs, tabla, gráficas, probabilidades, PDF
```

Consecuencias prácticas:

1. **Cambiar una fórmula** = editar `queueing.py` o `queueing_mmc.py` y actualizar las pruebas.
2. **Cambiar cómo se muestra un resultado** = editar `app.js` / `mmc.js`.
3. **Añadir un resultado nuevo** = tocar backend (cálculo y persistencia), frontend (render y PDF) y pruebas.
4. **El historial** guarda el JSON completo del cálculo, no solo las columnas. Al abrir un cálculo antiguo se reconstruye desde `resultados_json`.

---

## 4. Backend

### 4.1 `backend/queueing.py` — motor M/M/1

#### Constantes y utilidades

| Línea | Elemento | Qué hace |
|---:|---|---|
| 13-14 | `MODELO_INFINITO`, `MODELO_FINITO` | Identificadores `mm1_infinito` y `mm1_finito`. |
| 16-25 | `MODELOS` | Etiquetas visibles de cada modelo. |
| 27-35 | `MAX_TASA`, `MAX_N`, `MAX_NMAX`, `TOLERANCIA_RHO_UNO`, `UMBRAL_CORTE_ACUMULADA` | Límites y tolerancias globales. |
| 44-50 | `ErrorValidacion` | Error de negocio convertido a HTTP 400 con campo opcional. |
| 53-88 | `etiqueta_modelo`, `normalizar_modelo` | Traducen alias (`mm1_infinito`, `M/M/1:(DG/∞/∞)`, etc.) al identificador interno. |
| 91-154 | `_a_flotante`, `_a_entero` | Validación y conversión de parámetros. |
| 157-163 | `_redondear` | Redondeo a **6 decimales** y normalización de `-0.0`. |
| 172-177 | `_probabilidad` | Recorta cualquier probabilidad al intervalo `[0, 1]`. |
| 180-186 | `_verificar_resultados` | Rechaza resultados `NaN` o infinitos. |
| 188-223 | `_probabilidades_finitas_extremo` | Calcula `p_N` y `1-p_N` de forma estable para ρ cercano a 1 o muy grande. |

#### Cálculo M/M/1 infinito — `_mm1_infinito` (línea ~226)

Fórmulas implementadas:

```text
ρ = λ / μ                     (debe cumplir ρ < 1)
P₀ = 1 − ρ
Ls = ρ / (1 − ρ)
Lq = ρ² / (1 − ρ)
Ws = Ls / λ
Wq = Lq / λ
Pₙ = (1 − ρ) · ρⁿ
```

Ubicación exacta de las fórmulas: líneas ~239-243. La distribución se genera en el bucle de ~249-261 y se corta cuando la acumulada llega a `UMBRAL_CORTE_ACUMULADA`.

Resultados que devuelve: `rho`, `p0`, `Ls`, `Lq`, `Ws`, `Wq`, `lambda_efectiva`, `lambda_perdida`, `pN`, `utilizacion`.

#### Cálculo M/M/1 finito — `_mm1_finito` (línea ~295)

Fórmulas implementadas:

```text
ρ = λ / μ
Si ρ ≠ 1:
    Pₙ = (1 − ρ) · ρⁿ / (1 − ρ^(N+1))
Si ρ = 1:
    Pₙ = 1 / (N + 1)

Ls = Σ n · Pₙ
Lq = Ls − (1 − P₀)
pN = P_N
λ_efectiva = λ · (1 − pN)
λ_perdida  = λ · pN
Ws = Ls / λ_efectiva
Wq = Lq / λ_efectiva
Utilización = 1 − P₀
```

- Caso ρ = 1: líneas ~305-309.
- Distribución normalizada en espacio logarítmico: líneas ~311-319.
- Cálculo de bloqueo, λ efectiva y métricas de espera: líneas ~321-334.

La distribución se calcula con pesos `ρⁿ` normalizados, equivalente a la fórmula cerrada, pero sin desbordamientos.

#### Entrada principal — `calcular_modelo` (línea ~384)

Valida el JSON y decide qué modelo ejecutar:

- Modelo infinito: exige `lambda`, `mu` y opcionalmente `nMax` (por defecto 50).
- Modelo finito: exige `lambda`, `mu` y `N`.

Devuelve un diccionario con:

```python
{
    "modelo": "mm1_infinito",
    "modelo_etiqueta": "M/M/1:(DG/∞/∞)",
    "parametros": {"lambda": ..., "mu": ..., "N": None, "nMax": 50},
    "resultados": {...},
    "distribucion": [{"n": 0, "p": ..., "acumulada": ...}, ...],
    "total_filas": ...,
    "advertencias": [...],
}
```

#### Probabilidades — `_cdf_infinita`, `_probabilidad_infinita`, `_probabilidades_finitas`, `_probabilidad_finita`, `calcular_probabilidad` (líneas ~415-568)

Fórmulas:

```text
P(X ≤ k) = 1 − ρ^(k+1)
P(X ≥ k) = ρ^k
P(a ≤ X ≤ b) = ρ^a · (1 − ρ^(b−a+1))
```

En el modelo finito se suman directamente las probabilidades `Pₙ` calculadas con la distribución truncada.

Puntos de modificación:

- `_cdf_infinita` (~415): probabilidad acumulada ilimitada.
- `_probabilidad_infinita` (~425): interpretación de `menor_igual`, `mayor_igual` y `rango`.
- `_probabilidades_finitas` (~447): vector de probabilidades del modelo finito.
- `_probabilidad_finita` (~459): suma para cada tipo de evento.
- `calcular_probabilidad` (~478): validación y formato de respuesta.

---

### 4.2 `backend/queueing_mmc.py` — motor M/M/c

#### Constantes, normalización y utilidades

| Línea | Elemento | Qué hace |
|---:|---|---|
| 30-42 | `MODELO_MMC_INFINITO`, `MODELO_MMC_FINITO`, `MODELOS_MMC` | Identificadores y etiquetas de M/M/c. |
| 48-50 | `MAX_C`, `MAX_INDICE_PROBABILIDAD`, `TOLERANCIA_UTILIZACION_UNO` | Límites y tolerancias. |
| 64-107 | `es_modelo_mmc`, `etiqueta_modelo_mmc`, `normalizar_modelo_mmc` | Detección y normalización de modelos M/M/c. |
| 110-118 | `_servidores` | Valida `c` entre 1 y 500. |
| 126-134 | `_log_suma_exp` | Suma estable en espacio logarítmico (`log-sum-exp`). |
| 137-148 | `_validar_rho` | Rechaza ρ no finito o demasiado pequeño. |
| 151-181 | `_contexto_infinito` | Pesos logarítmicos de la distribución ilimitada. |
| 184-195 | `_pmf_infinita` | Probabilidad puntual `P(X = n)` para cola ilimitada. |
| 198-220 | `_pmf_finita` | Vector completo de probabilidades para capacidad `N`. |
| 223-239 | `_resultados_distribucion` | Convierte probabilidades en filas `{n, p, acumulada}`. |

#### Cálculo M/M/c infinito — `_mmc_infinito` (línea ~247)

Notación del código:

```text
ρ = λ / μ          (intensidad de tráfico)
r = ρ / c = λ / (c·μ)   (factor de utilización; debe cumplir r < 1)
```

Fórmulas implementadas:

```text
P₀ = [ Σ(n=0..c−1) ρⁿ/n!  +  ρ^c / (c! · (1 − r)) ]⁻¹
P_c = P₀ · ρ^c / c!
Lq = P_c · r / (1 − r)²
Ls = Lq + ρ
Ws = Ls / λ
Wq = Lq / λ
```

- `P₀` y `P_c` se obtienen en líneas ~252-253 a partir de `_contexto_infinito`.
- `Lq`, `Ls`, `Ws`, `Wq`: líneas ~255-264.
- Servidores activos/inactivos: líneas ~266-279.
- Distribución y corte por `nMax`/acumulada: líneas ~281-294.

#### Cálculo M/M/c finito — `_mmc_finito` (línea ~332)

Con `N ≥ c`, las probabilidades se calculan por normalización de pesos:

```text
wₙ = ρⁿ / n!                     para 0 ≤ n ≤ c
wₙ = ρⁿ / (c! · c^(n−c))         para c < n ≤ N
Pₙ = wₙ / Σ(k=0..N) wₖ

Lq = Σ(n=c+1..N) (n − c) · Pₙ
pN = P_N
λ_efectiva = λ · (1 − pN)
λ_perdida  = λ · pN
Ls = Lq + λ_efectiva / μ
Wq = Lq / λ_efectiva
Ws = Ls / λ_efectiva
c_inactivos = Σ(n=0..min(c,N)) (c − n) · Pₙ
c_activos   = c − c_inactivos
Utilización = c_activos / c
```

- Pesos y normalización: `_pmf_finita` (~198).
- `Lq` y `λ` efectiva: líneas ~340-348.
- `Ls`, `Ws`, `Wq`: líneas ~350-362.
- Servidores y utilización: líneas ~364-388.
- Caso crítico `ρ/c = 1` y aviso `N = c`: líneas ~390-398.

> **Caso crítico:** el modelo finito **no** rechaza `ρ/c = 1`; lo calcula con la distribución normalizada. El modelo infinito sí exige `ρ/c < 1` en `_contexto_infinito` (~154-160).

#### Entrada principal — `calcular_modelo_mmc` (línea ~417)

Valida `lambda`, `mu`, `c` y luego:

- Infinito: `nMax` opcional (por defecto 50).
- Finito: `N` obligatorio y `N ≥ c`.

Devuelve la misma estructura que M/M/1, con `c`, `N`, `rho_c`, `servidores_activos` y `servidores_inactivos`.

#### Probabilidades M/M/c — líneas ~454-566

- `_cdf_infinita` (~454): usa la cola geométrica `P(X > k) = P_c · r^(k−c+1)/(1−r)`.
- `_cdf_finita` (~477): suma de `Pₙ` hasta `k`.
- `calcular_probabilidad_mmc` (~485): valida el evento y convierte:
  - `menor_igual`: `CDF(k)`.
  - `mayor_igual`: `1 − CDF(k−1)`.
  - `rango`: `CDF(b) − CDF(a−1)`.

---

### 4.3 `backend/app.py` — rutas y API

| Línea | Ruta / función | Qué hace |
|---:|---|---|
| 258 | `create_app` | Crea Flask, configura CORS, base de datos y manejadores de error. |
| 299 | `GET /` | Portada (`inicio.html`). |
| 303 | `GET /modelos-de-colas` | Interfaz M/M/1 (`index.html`). |
| 307 | `GET /modelos-de-colas/mmc` | Interfaz M/M/c (`mmc.html`). |
| 311 | `GET /api/salud` | Comprueba que la API responde. |
| 324 | `POST /api/calcular` | Calcula y guarda M/M/1 o M/M/c según `modelo`. |
| 351 | `POST /api/probabilidad` | Calcula una probabilidad sin guardarla. |
| 365 | `GET /api/historial` | Lista paginada; filtro por `?modulo=analitico` o `?modulo=mmc`. |
| 389 | `GET /api/calculo/<id>` | Devuelve el detalle completo de un cálculo. |
| 412 | `DELETE /api/calculo/<id>` | Elimina un cálculo. |
| 432-473 | Manejadores de error | Convierten errores de validación, HTTP e internos en JSON. |

La decisión M/M/1 vs M/M/c está en `api_calcular` (~334) y `api_probabilidad` (~359), usando `es_modelo_mmc`.

Formato de entrada de `POST /api/calcular`:

```json
{
  "modelo": "mm1_infinito",
  "lambda": 8,
  "mu": 10,
  "N": null,
  "nMax": 50
}
```

```json
{
  "modelo": "mmc_finito",
  "lambda": 8,
  "mu": 6,
  "c": 2,
  "N": 6,
  "nMax": null
}
```

Formato de salida (resumido):

```json
{
  "ok": true,
  "calculo": {
    "id": 96,
    "timestamp": "2026-11-11T...",
    "modulo": "mmc",
    "modelo": "mmc_finito",
    "modelo_etiqueta": "M/M/c:(DG/N/∞)",
    "parametros": { "lambda": 8, "mu": 6, "c": 2, "N": 6, "nMax": null },
    "resultados": { "rho": 1.333333, "rho_c": 0.666667, "p0": 0.15, "...": "..." },
    "distribucion": [ { "n": 0, "p": 0.15, "acumulada": 0.15 } ],
    "total_filas": 7,
    "advertencias": []
  }
}
```

---

### 4.4 `backend/database.py` — persistencia

| Línea | Elemento | Qué hace |
|---:|---|---|
| 17-68 | `ESQUEMA_SQL` | Crea `calculos`, `calculos_mmc` e índices. |
| 71-84 | `get_db` | Abre conexión SQLite por request. |
| 93-96 | `init_db` | Ejecuta el esquema al arrancar. |
| 103-148 | `guardar_calculo` | Inserta M/M/1 y guarda el detalle completo en `resultados_json`. |
| 151-169 | `listar_calculos_analiticos` | Historial M/M/1 paginado. |
| 172-178 | `obtener_calculo` | Detalle M/M/1 por id. |
| 181-188 | `eliminar_calculo` | Borra M/M/1. |
| 196-244 | `guardar_calculo_mmc` | Inserta M/M/c con sus columnas propias. |
| 247-268 | `listar_calculos_mmc` | Historial M/M/c paginado. |
| 271-277 | `obtener_calculo_mmc` | Detalle M/M/c por id. |
| 280-287 | `eliminar_calculo_mmc` | Borra M/M/c. |

Tablas:

- `calculos`: columnas principales + `modulo` (`analitico`) + `resultados_json`.
- `calculos_mmc`: columnas principales + `c`, `servidores_inactivos`, `servidores_activos` + `resultados_json`.

No hay sistema de migraciones. Para un cambio de esquema en desarrollo:

1. Edita `ESQUEMA_SQL`.
2. Si la tabla ya existe, `CREATE TABLE IF NOT EXISTS` **no** añade columnas.
3. Opciones: borrar `backend/database.db` (pierdes historial) o ejecutar un `ALTER TABLE` manual.
4. Ajusta `guardar_*`, `listar_*` y `obtener_*` para incluir el campo nuevo.

### 4.5 Pruebas del backend

`backend/tests/test_app.py` contiene:

- `ApiTests`: flujo completo de la API, validaciones, paginación del historial y rutas de páginas.
- `ModelosAnaliticosTests`: fórmulas M/M/1 infinito y finito, caso ρ = 1, corte por `nMax`, probabilidades y rechazo de ρ ≥ 1.

`backend/tests/test_mmc.py` contiene:

- `ApiMMCTests`: flujo M/M/c, validaciones, probabilidad, historial y página.
- `ModelosMMCTests`: fórmulas M/M/c, caso crítico ρ/c = 1, `N = c`, corte por `nMax`, distribución y probabilidades.

Para añadir una prueba de fórmula:

```python
def test_mi_formula_nueva(self):
    calculo = calcular_modelo(
        {"modelo": "mm1_infinito", "lambda": 8, "mu": 10, "nMax": 50}
    )
    self.assertAlmostEqual(calculo["resultados"]["Lq"], 3.2, places=6)
```

Las clases existentes ya crean la app de prueba con una base temporal; reutiliza ese patrón en lugar de tocar `backend/database.db`.

---

## 5. Frontend

### 5.1 HTML: qué IDs existen y para qué

Ambas páginas (`index.html` y `mmc.html`) comparten estructura:

| ID | Uso |
|---|---|
| `#formCalculo` | Formulario principal de parámetros. |
| `#modelo` | Selector de modelo (`mm1_*` o `mmc_*`). |
| `#lambda`, `#mu` | Tasas de llegada y servicio. |
| `#c` | Número de servidores (solo M/M/c). |
| `#N` | Capacidad del sistema (modelo finito). |
| `#nMax` | Corte de tabla; actualmente **oculto** por `d-none` en `#grupoNMax`. |
| `#formError` | Mensaje general de error del formulario. |
| `#btnCalcular`, `#btnLimpiar`, `#btnEjemplo` | Acciones del formulario. |
| `#estadoVacio`, `#resultadosContenido` | Alternan el estado sin cálculo / con resultados. |
| `#kpiRho`, `#kpiP0`, `#kpiLs`, `#kpiLq`, `#kpiWs`, `#kpiWq` | Tarjetas KPI principales. |
| `#metricasFinitas`, `#kpiLambdaEf`, `#kpiLambdaPerdida`, `#kpiPN`, `#kpiUtilizacion` | Bloque adicional para modelos finitos. |
| `#tablaResultados` | Tabla detallada de métricas. |
| `#interpretacion` | Lecturas en lenguaje natural. |
| `#advertenciasResultado` | Avisos calculados por el backend. |
| `#tablaDistribucion`, `#distNota`, `#distTablaConteo` | Tabla de distribución y notas. |
| `#formProbabilidad`, `#probK`, `#probA`, `#probB` | Calculadora de probabilidades. |
| `#probDescripcion`, `#probValor`, `#probPorcentaje`, `#probFormula` | Resultado de probabilidad. |
| `#tablaHistorial`, `#btnHistorialAnterior`, `#btnHistorialSiguiente` | Historial paginado. |
| `#btnPDF` | Genera el PDF. |
| `#guiaUso` / `#guiaMMC` | Modal de ayuda. |

En M/M/c existen además `#kpiActivos` y `#kpiInactivos`.

### 5.2 `frontend/app.js` — M/M/1

Organización por bloques (los comentarios `/* === ... === */` marcan cada sección):

| Línea | Bloque / función | Qué hace |
|---:|---|---|
| 8-39 | `API_BASE`, constantes y `state` | URL de API, límites y estado global. |
| 41-83 | Formatos y `ApiError` | Formatos `es-MX`, clase de error con `campo`. |
| 89-264 | Utilidades | `escaparHTML`, `fmtNumero`, `fmtPorcentaje`, fechas, pestañas, errores y notificaciones. |
| 271-312 | `apiFetch` | Envía JSON, interpreta errores y devuelve la respuesta. |
| 319-429 | `iniciar`, `configurarEventos`, `actualizarModeloUI` | Arranque y eventos de la interfaz. |
| 436-599 | Validación y envío | `leerNumeroInput`, `leerEnteroInput`, `validarFormulario`, `manejarSubmitCalculo`, `cargarEjemplo`, `limpiarAplicacion`. |
| 605-811 | Render | `aplicarCalculo`, `lecturasSistema`, `renderResultados`, `renderDistribucion`, `significadoFila`. |
| 817-1056 | Gráficas | `muestrearDistribucion`, `renderGraficas`, `asegurarGraficas`, imágenes para PDF. |
| 1062-1274 | Probabilidades | Configuración, validación, petición y presentación del resultado. |
| 1280-1462 | Historial | Carga, tabla, apertura y eliminación de cálculos. |
| 1468-1947 | PDF | Fuentes, cabecera, lectura, `construirPDF`. |
| 1949+ | `generarPDF` | Orquesta gráficas, fuentes y descarga. |

Puntos clave:

- **Validación de campos:** `validarFormulario` (~464). Aquí se agregan reglas nuevas.
- **Payload enviado:** final de `validarFormulario` (~523-529). Debe coincidir con lo que espera el backend.
- **Render de KPIs:** `renderResultados` (~665). Los primeros seis KPIs están en ~672-677; los finitos en ~679-691.
- **Tabla de métricas:** arreglo `filas` en ~703-723.
- **Distribución:** `renderDistribucion` (~742).
- **Cálculo de probabilidad:** `manejarSubmitProbabilidad` (~1155).
- **PDF:** `construirPDF` (~1647) y `filasMetricas` (~1786).

### 5.3 `frontend/mmc.js` — M/M/c

Es un archivo **independiente**, no importa `app.js`. Repite muchas utilidades y añade lo propio de M/M/c:

| Línea | Elemento | Qué hace |
|---:|---|---|
| 19-42 | Constantes y `state` | Incluye `MAX_C = 500` y `MODULO_HISTORIAL = "mmc"`. |
| 363-368 | `sugerirCapacidad` | Propone un `N` inicial al cambiar a modelo finito. |
| 447-463 | `actualizarModeloUI` | Muestra `N` solo en finito; `nMax` queda oculto siempre. |
| 497-568 | `validarFormulario` | Valida `c`, `N`, `nMax` y `ρ/c < 1`. |
| 668-708 | `lecturasSistemaMMC` | Textos interpretativos con servidores activos/inactivos. |
| 710-788 | `renderResultados` | KPIs y tabla de M/M/c. |
| 948-1060 | `renderGraficas` | Gráficas absoluta y acumulada. |
| 1203-1280 | `manejarSubmitProbabilidad` | Probabilidades M/M/c. |
| 1712-2033 | `construirPDF` | PDF de M/M/c. |
| 2035-2077 | `generarPDF` | Descarga del PDF. |
| 2079-2514 | `construirReporteImpresion` | Documento HTML de impresión **sin uso actualmente**. |
| 2516+ | `imprimirDocumento` | Impresión por iframe **sin uso actualmente**. |

> **Regla práctica:** si un cambio afecta a ambas interfaces (por ejemplo, formato de números o una nueva métrica común), hay que replicarlo en `app.js` **y** en `mmc.js`.

### 5.4 Tema y estilos

- `frontend/theme.js`:
  - `aplicarTema` (~43) crea el overlay `.tema-wipe`, cambia `data-tema` y guarda la preferencia en `localStorage`.
  - `montar` (~85) conecta el botón `[data-tema-toggle]`.
- `frontend/styles.css`:
  - Variables de color en `:root` (~5).
  - Bloques de tema oscuro con `[data-bs-theme="oscuro"]` (busca `data-bs-theme`).
  - Overlay de barrido en `.tema-wipe` (~2821).

Los colores de las gráficas se leen desde variables CSS en `paletaGraficas()` (`app.js` ~327, `mmc.js` ~332). Si cambias un color de tema, revisa que las gráficas se actualicen al evento `simulab:tema`.

---

## 6. Referencia rápida de fórmulas

### M/M/1

| Métrica | Infinito | Finito |
|---|---|---|
| ρ | `λ/μ` | `λ/μ` |
| P₀ | `1−ρ` | `1 / Σ_{n=0..N} ρⁿ` (o `1/(N+1)` si ρ=1) |
| Pₙ | `(1−ρ)ρⁿ` | `(1−ρ)ρⁿ/(1−ρ^(N+1))` |
| Ls | `ρ/(1−ρ)` | `Σ n·Pₙ` |
| Lq | `ρ²/(1−ρ)` | `Ls − (1−P₀)` |
| Ws | `Ls/λ` | `Ls/λ_efectiva` |
| Wq | `Lq/λ` | `Lq/λ_efectiva` |
| Bloqueo | — | `pN = P_N` |

### M/M/c

| Métrica | Infinito | Finito |
|---|---|---|
| ρ | `λ/μ` | `λ/μ` |
| r = ρ/c | `λ/(cμ)` | `λ/(cμ)` |
| P₀ | `[Σ_{n<c} ρⁿ/n! + ρ^c/(c!(1−r))]⁻¹` | `1/Σ wₙ` |
| Lq | `P_c·r/(1−r)²` | `Σ_{n>c}(n−c)Pₙ` |
| Ls | `Lq + ρ` | `Lq + λ_efectiva/μ` |
| Wq | `Lq/λ` | `Lq/λ_efectiva` |
| Ws | `Ls/λ` | `Ls/λ_efectiva` |
| Bloqueo | — | `pN = P_N` |

### Probabilidades

| Evento | Fórmula general |
|---|---|
| `P(X ≤ k)` | suma de `Pₙ` hasta `k` |
| `P(X ≥ k)` | `1 − P(X ≤ k−1)` |
| `P(a ≤ X ≤ b)` | `P(X ≤ b) − P(X ≤ a−1)` |

En M/M/1 infinito se usan las formas cerradas `1−ρ^(k+1)` y `ρ^k`; en los finitos se suman las probabilidades calculadas.

---

## 7. Recetas de modificación

### Receta A — Cambiar una fórmula existente (lo más probable)

Ejemplo: cambiar `Lq` en M/M/1 infinito.

1. Abre `backend/queueing.py`.
2. Ve a `_mm1_infinito` (línea ~226) y localiza:

   ```python
   lq = (rho * rho) / (1.0 - rho)
   ```

3. Sustituye la expresión por la fórmula nueva.
4. Si la fórmula nueva afecta a otras métricas (por ejemplo `Ws` depende de `Ls`), revisa también esas líneas.
5. Actualiza las pruebas en `backend/tests/test_app.py` (busca `test_mm1_infinito_formulas_clasicas`).
6. Ejecuta:

   ```powershell
   cd backend
   py -m unittest discover -s tests -v
   ```

7. Recarga la página y verifica el KPI, la tabla y el PDF.

**No necesitas tocar JavaScript** si mantienes el nombre del campo `resultados["Lq"]`.

Para M/M/c, el procedimiento es idéntico en `queueing_mmc.py`:

- Infinito: `_mmc_infinito` (~247), `Lq` en ~261.
- Finito: `_mmc_finito` (~332), `Lq` en ~340.

### Receta B — Añadir una métrica nueva de extremo a extremo

Ejemplo: añadir `Lq2` o una métrica personalizada.

1. **Backend, cálculo:** agrega el valor al diccionario `resultados` en `_mm1_infinito` / `_mm1_finito` (o en `queueing_mmc.py`).
2. **Backend, persistencia:**
   - Si solo debe viajar en el JSON, no hace falta cambiar el esquema: `resultados_json` ya guarda todo.
   - Si necesitas consultarla/filtrarla como columna, añade la columna en `ESQUEMA_SQL` y en `guardar_calculo*`.
3. **Frontend, KPI (opcional):**
   - Añade una tarjeta en `index.html` / `mmc.html` con un `id`, por ejemplo `kpiNueva`.
   - Asígnala en `renderResultados` con `$("#kpiNueva").textContent = fmtNumero(resultados.nueva);`.
4. **Frontend, tabla de métricas:** añade una fila al arreglo `filas` de `renderResultados`:

   ```javascript
   ["Nombre visible", "símbolo", resultados.nueva],
   ```

5. **Frontend, PDF:** añade la misma fila en `filasMetricas` de `construirPDF` (`app.js` ~1786 / `mmc.js` ~1875).
6. **Pruebas:** agrega una aserción en el test del modelo correspondiente.
7. **Verifica:** cálculo nuevo, cálculo cargado desde historial y PDF.

### Receta C — Cambiar límites o validaciones

| Qué cambiar | Dónde |
|---|---|
| λ, μ máximos | `MAX_TASA` en `queueing.py` (~27) y `queueing_mmc.py` lo importa. |
| N máximo | `MAX_N` en `queueing.py` (~28). |
| nMax máximo | `MAX_NMAX` en `queueing.py` (~29). |
| c máximo | `MAX_C` en `queueing_mmc.py` (~48). |
| Mensajes y reglas de λ/μ | `_a_flotante` (~91) y `validarFormulario` del frontend. |
| Regla ρ < 1 (infinito) | `_mm1_infinito` (~232) y `_contexto_infinito` (~154). |
| N ≥ c | `calcular_modelo_mmc` (~439) y `validarFormulario` de `mmc.js` (~536). |

Si cambias un límite en el backend, actualiza también el atributo `max` del input correspondiente en el HTML y el texto de la guía modal.

### Receta D — Cambiar el corte de tabla (`nMax`)

Aunque el campo está oculto en la interfaz, sigue funcionando con valor 50.

- Valor por defecto del backend: `datos.get("nMax", 50)` en `calcular_modelo` (~396) y `calcular_modelo_mmc` (~430).
- Valor por defecto del frontend: `$("#nMax").value = "50"` en `app.js` (~568, ~578) y `mmc.js` (~610, ~620).
- Corte automático por probabilidad acumulada: `UMBRAL_CORTE_ACUMULADA` en `queueing.py` (~35) y los bucles de distribución (~259 y ~293).
- Para volver a mostrar el campo: quita `d-none` y `aria-hidden` de `#grupoNMax` en el HTML y restaura el `classList.toggle` en `actualizarModeloUI` si quieres que aparezca solo en el modelo infinito.

### Receta E — Añadir un campo al formulario

1. Añade el input en `index.html` / `mmc.html` con `id`, `name`, `min`, `max` y `aria-describedby`.
2. Léelo y valídalo en `validarFormulario` del JS.
3. Inclúyelo en el objeto que se envía a `/api/calcular`.
4. Valídalo en el backend (`_a_flotante`, `_a_entero` o una regla nueva).
5. Úsalo en la función de cálculo.
6. Guárdalo en `parametros` para que el historial lo recupere.
7. Actualiza `sincronizarFormulario` para restaurarlo al abrir un cálculo del historial.
8. Añade la fila correspondiente al PDF y a la guía modal.

### Receta F — Añadir un modelo nuevo

1. Define su identificador y etiqueta en `MODELOS` / `MODELOS_MMC`.
2. Añade alias en `normalizar_modelo` / `normalizar_modelo_mmc`.
3. Implementa una función `_mmx_...` que devuelva la misma estructura (`resultados`, `distribucion`, `parametros`, `advertencias`).
4. Añade el `elif` o rama en `calcular_modelo` / `calcular_modelo_mmc`.
5. Añade la opción en el `<select id="modelo">`.
6. Ajusta `actualizarModeloUI` para mostrar los campos que correspondan.
7. Añade pruebas de fórmulas, validaciones y API.

### Receta G — Cambiar el PDF

| Elemento | M/M/1 | M/M/c |
|---|---|---|
| Construcción general | `app.js` `construirPDF` (~1647) | `mmc.js` `construirPDF` (~1712) |
| Parámetros del encabezado | `parametrosPDF` (~1756) | `parametrosPDF` (~1844) |
| Tabla de métricas | `filasMetricas` (~1786) | `filasMetricas` (~1875) |
| Tabla de distribución | ~1903 | ~1990 |
| Probabilidad consultada | ~1928 | ~2014 |
| Generación/descarga | `generarPDF` (~1949) | `generarPDF` (~2035) |

Cambia los textos y filas en esas funciones. Conserva el orden: primero parámetros, luego métricas, gráficas, distribución y probabilidad.

### Receta H — Cambiar colores, tema o estilos

1. Colores base: variables en `frontend/styles.css` `:root` (~5).
2. Tema oscuro: busca `[data-bs-theme="oscuro"]` en `styles.css`.
3. Barrido: `.tema-wipe` (~2821) y `theme.js` `aplicarTema` (~43).
4. Gráficas: `paletaGraficas()` en `app.js` (~327) y `mmc.js` (~332).

### Receta I — Cambiar el cálculo de probabilidades

- M/M/1: `calcular_probabilidad` (~478), `_probabilidad_infinita` (~425), `_probabilidad_finita` (~459).
- M/M/c: `calcular_probabilidad_mmc` (~485), `_cdf_infinita` (~454), `_cdf_finita` (~477).
- Frontend: `manejarSubmitProbabilidad` (`app.js` ~1155, `mmc.js` ~1203).
- Texto de la fórmula mostrada: `formulaProbabilidad` (`app.js` ~1251, `mmc.js` ~1300).

Si cambias la descripción del evento, el backend ya devuelve `descripcion`; el frontend la muestra directamente.

---

## 8. Dónde se muestra cada resultado

| Dato en pantalla | Campo JSON | Backend | Render |
|---|---|---|---|
| KPI ρ | `resultados.rho` | `_mm1_*` / `_mmc_*` | `#kpiRho` |
| KPI P₀ | `resultados.p0` | idem | `#kpiP0` |
| KPI Ls | `resultados.Ls` | idem | `#kpiLs` |
| KPI Lq | `resultados.Lq` | idem | `#kpiLq` |
| KPI Ws | `resultados.Ws` | idem | `#kpiWs` |
| KPI Wq | `resultados.Wq` | idem | `#kpiWq` |
| λ efectiva (finito) | `resultados.lambda_efectiva` | idem | `#kpiLambdaEf` |
| λ perdida (finito) | `resultados.lambda_perdida` | idem | `#kpiLambdaPerdida` |
| pN (finito) | `resultados.pN` | idem | `#kpiPN` |
| Utilización real | `resultados.utilizacion` | idem | `#kpiUtilizacion` |
| r = ρ/c | `resultados.rho_c` | `_mmc_*` | tabla M/M/c |
| Servidores activos | `resultados.servidores_activos` | `_mmc_*` | `#kpiActivos` |
| Servidores inactivos | `resultados.servidores_inactivos` | `_mmc_*` | `#kpiInactivos` |
| Distribución | `distribucion[]` | `_mm1_*` / `_mmc_*` | `#tablaDistribucion` |

Si un dato no aparece, primero revisa que exista en `resultados` del JSON devuelto por la API.

---

## 9. Trampas y detalles importantes

1. **Redondeo:** el backend redondea a 6 decimales con `_redondear`. No redondees antes de terminar los cálculos; hazlo solo al construir el resultado.
2. **Estabilidad numérica:** no reemplaces sin cuidado el cálculo logarítmico por `ρ**n` directo. Con ρ grande o n grande puede desbordar. Usa las funciones existentes.
3. **Probabilidades:** usa `_probabilidad` para recortar a `[0,1]`, y `math.fsum` para sumar con precisión.
4. **Caso ρ = 1 (M/M/1 finito):** hay fórmulas especiales; no las elimines al cambiar la fórmula general.
5. **Caso ρ/c = 1 (M/M/c finito):** se calcula normalmente; el infinito sí lo rechaza.
6. **`nMax` oculto:** el campo existe, vale 50 y se sigue enviando. Si lo eliminas del HTML, ajusta `validarFormulario`, los resets y `sincronizarFormulario`.
7. **Duplicación:** `app.js` y `mmc.js` son independientes. Un cambio común debe hacerse dos veces.
8. **Historial:** los cálculos viejos se leen de `resultados_json`. Si añades un campo nuevo, los registros anteriores no lo tendrán; usa valores por defecto (`?? "—"` o `?? 0`).
9. **Impresión:** el botón Imprimir se eliminó. Quedan `construirReporteImpresion` e `imprimirDocumento` en `mmc.js` sin uso; puedes ignorarlas o eliminarlas si no se van a usar.
10. **Base de datos:** `CREATE TABLE IF NOT EXISTS` no modifica tablas existentes. Un campo nuevo en el esquema requiere borrar la base o migrar manualmente.
11. **Errores de validación:** el backend devuelve `campo`; el frontend lo usa para marcar el input. Si añades una validación, asigna un `campo` coherente con el `id` del HTML.

---

## 10. Lista de verificación después de un cambio

- [ ] El cálculo nuevo coincide con un ejemplo hecho a mano o con la fórmula esperada.
- [ ] Las pruebas del backend pasan (`py -m unittest discover -s tests -v` desde `backend`).
- [ ] El resultado se ve en las tarjetas KPI.
- [ ] La tabla de métricas muestra el valor correcto.
- [ ] La pestaña Distribución sigue funcionando.
- [ ] La calculadora de probabilidades sigue funcionando.
- [ ] El cálculo se guarda y se puede abrir desde el Historial.
- [ ] El PDF se genera y muestra el valor nuevo.
- [ ] Funciona en tema claro y oscuro.
- [ ] No hay errores en la consola del navegador.

---

## 11. Anexo: estructura de un cálculo guardado

```json
{
  "modelo": "mm1_infinito",
  "modelo_etiqueta": "M/M/1:(DG/∞/∞)",
  "parametros": {
    "lambda": 8,
    "mu": 10,
    "N": null,
    "nMax": 50
  },
  "resultados": {
    "rho": 0.8,
    "p0": 0.2,
    "Ls": 4.0,
    "Lq": 3.2,
    "Ws": 0.5,
    "Wq": 0.4,
    "lambda_efectiva": 8.0,
    "lambda_perdida": 0.0,
    "pN": 0.0,
    "utilizacion": 0.8
  },
  "distribucion": [
    { "n": 0, "p": 0.2, "acumulada": 0.2 },
    { "n": 1, "p": 0.16, "acumulada": 0.36 }
  ],
  "total_filas": 2,
  "advertencias": []
}
```

Ese JSON es el contrato entre backend y frontend. Si conservas sus nombres, los cambios de fórmulas son locales y seguros.
