## Requisitos Previos

- **Python 3.10+**: Asegúrate de tener instalado Python.
- **Git**: Para clonar el repositorio.

## Pasos para la Ejecución

1. **Clonar el repositorio:**
   ```bash
   git clone <URL_DEL_REPOSITORIO>
   cd proyecto
   ```

2. **Preparar el entorno (recomendado):**
   Crea un entorno virtual para aislar las dependencias:
   ```bash
   # En Windows:
   python -m venv venv
   .\venv\Scripts\activate
   ```

3. **Instalar dependencias:**
   Instala las librerías necesarias definidas en `requirements.txt`, ubicado en la carpeta backend:
   ```bash
   pip install -r requirements.txt
   ```

4. **Ejecutar el servidor:**
   El backend se ejecuta mediante Flask:
   ```bash
   # En Windows:
   py -m flask --app backend/app.py run
   ```
   El servidor estará disponible en `http://127.0.0.1:5000`.

5. **Acceder a la aplicación:**
   Abre tu navegador web y dirígete a `http://127.0.0.1:5000`.

## Ejecución de Pruebas

Para verificar que el sistema funciona correctamente, puedes ejecutar el conjunto de pruebas integrado:

```bash
py -X utf8 -m unittest discover -s backend/tests -v
```

## Notas Adicionales
- La interfaz frontend se sirve directamente desde el backend.
- Todos los cambios de configuración y estilos están integrados en el código fuente.
- No se requiere ninguna base de datos externa; el proyecto utiliza SQLite (archivo local).
