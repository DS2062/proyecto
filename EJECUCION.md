# Cómo ejecutar Simulab

Guía rápida para poner en marcha el proyecto después de clonar el repositorio.

## 1. Requisitos

- Python 3.10 o superior.
- Git.
- Un navegador moderno (Chrome, Edge, Firefox o Safari).

## 2. Clonar el repositorio

```bash
git clone <URL_DEL_REPOSITORIO>
cd proyecto
```

## 3. Crear y activar un entorno virtual

En Windows (PowerShell):

```powershell
python -m venv venv
.\venv\Scripts\Activate.ps1
```

En macOS o Linux:

```bash
python3 -m venv venv
source venv/bin/activate
```

> Si PowerShell bloquea la activación, ejecuta una vez:
> `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`

## 4. Instalar dependencias

Desde la raíz del proyecto:

```powershell
pip install -r backend/requirements.txt
```

## 5. Iniciar el servidor

```powershell
py backend/app.py
```

También puedes usar Flask directamente:

```powershell
py -m flask --app backend/app.py run
```

El servidor queda disponible en:

```text
http://127.0.0.1:5000
```

## 6. Abrir los módulos

- Inicio: `http://127.0.0.1:5000`
- M/M/1 (un servidor): `http://127.0.0.1:5000/modelos-de-colas`
- M/M/c (varios servidores): `http://127.0.0.1:5000/modelos-de-colas/mmc`

Detén el servidor con `Ctrl + C`.

## 7. Ejecutar las pruebas

```powershell
py -X utf8 -m unittest discover -s backend/tests -v
```

## Notas

- La base de datos es SQLite y se crea automáticamente en `backend/database.db`.
- No se necesita conexión a internet: Bootstrap, Chart.js y jsPDF están incluidos en `frontend/vendor`.
- Si cambias el puerto, define la variable `PORT` antes de iniciar, por ejemplo `$env:PORT=8000`.
- Si el navegador muestra datos antiguos, recarga con `Ctrl + F5`.
