# Archivos + Panel de detalle de trabajo — Diseño

**Fecha:** 2026-07-02
**Versión objetivo:** 2.8.0 (feature nueva de UI + endpoints)

## Objetivo

Dos capacidades relacionadas sobre los G-codes que el backend ya guarda localmente:

1. **Sección "Archivos"** (nueva entrada en el sidebar → `/files`): un explorador de carpetas
   navegable **+** un buscador literal, sobre el almacenamiento de G-codes del backend
   (`gcodes_path`). Resiliente a que el usuario borre los archivos de las impresoras.
2. **Panel de detalle de trabajo**: al clickear una fila del Historial en `/queue`, se abre un
   modal con la miniatura grande de la pieza, tarjetas de datos, barras "estimado vs real"
   (tiempo y filamento) y descarga del G-code.

## Contexto del código actual (hallazgos que condicionan el diseño)

- Los G-codes se guardan en disco en `settings.gcodes_path` (default `/app/gcodes`), organizados
  como `{gcodes_path}/{AAAA-MM}/{MATERIAL}/{nombre}` — `_organize_gcode_path()` en
  `backend/app/routers/print_queue.py`. Se sirven estáticamente en `/gcodes` vía `StaticFiles`
  (`backend/app/main.py`).
- `PrintJob.gcode_filename` = path en disco; `PrintJob.gcode_original_name` = nombre original.
- **`PrintHistory.gcode_filename` guarda el nombre original, NO el path en disco.** Para localizar
  el archivo desde el historial, el código actual (`clone_from_history`) depende de que el
  `PrintJob` original **siga existiendo** (ahí está el path). Si el job fue borrado, se pierde el
  vínculo al archivo.
- **El filamento realmente usado no se guarda por impresión.** `PrintHistory` guarda
  `estimated_weight_g` (estimado) y `duration_secs` (tiempo real), pero el consumo real en gramos
  se manda a Spoolman y no queda snapshot. Tampoco guarda el tiempo estimado.
- No hay librería de charts instalada; el patrón del codebase es SVG/CSS custom
  (`dashboard/progress-ring.tsx`, `temperature-gauge.tsx`).
- El servicio `gcode_thumbnail.py` ya extrae la miniatura embebida, pero solo se expone para el job
  imprimiéndose (`GET /api/printers/{id}/thumbnail`).

## Decisión: snapshot de datos en PrintHistory

Para que "descargar desde historial" y "estimado vs real" tengan datos completos y robustos, se
agregan **3 columnas nuevas a `PrintHistory`**, pobladas al cerrar la impresión:

- `gcode_path` (Text, nullable) — path en disco copiado del job. Hace la descarga independiente de
  que el job siga existiendo.
- `estimated_time_secs` (Integer, nullable) — snapshot del estimado del job.
- `actual_weight_g` (Float, nullable) — gramos reales consumidos, calculados desde el tracker de
  filamento del cliente Moonraker al terminar.

**Limitación honesta y documentada:** solo las impresiones **nuevas** tendrán estos datos. El
historial viejo mostrará lo disponible (con fallback: si no hay `gcode_path`, se intenta resolver
vía el `PrintJob` original; si no hay `actual_weight_g`, la barra "real" de filamento se oculta y se
muestra solo el estimado).

Migración: bloque nuevo en la lista `migrations` de `backend/app/database.py`:
```python
("print_history", "gcode_path", "TEXT"),
("print_history", "estimated_time_secs", "INTEGER"),
("print_history", "actual_weight_g", "REAL"),
```

## Backend

### Nuevo router `backend/app/routers/files.py` (prefix `/api/files`)

Explorador sobre `gcodes_path`. **Toda ruta valida contra path-traversal**: resuelve el path
pedido dentro de `gcodes_path` con `os.path.realpath` y rechaza si el resultado sale de la raíz
(→ HTTP 400).

- `GET /api/files/browse?path=<subpath>` → `{ path, breadcrumb[], folders[], files[] }`
  - `folders[]`: `{ name, path, file_count }`
  - `files[]`: `{ name, path, size_bytes, modified_at, material, month }`
  - Ordenado: carpetas primero (alfabético), archivos por fecha desc.
- `GET /api/files/search?q=<texto>` → `{ files[] }` — recorre el árbol completo, match
  case-insensitive por nombre. Devuelve resultados planos con su `path` relativo.
- `GET /api/files/download?path=<relpath>` → `FileResponse` con
  `Content-Disposition: attachment; filename="<nombre>"`. 404 si no existe.
- `GET /api/files/thumbnail?path=<relpath>` → PNG de la miniatura embebida (generaliza
  `gcode_thumbnail.py`). 204 si el G-code no tiene miniatura.

### `dispatcher.py` — poblar snapshot al cerrar impresión

En `on_print_complete` (y en el cierre de `on_print_aborted` / stale) setear en el `PrintHistory`:
- `gcode_path = job.gcode_filename`
- `estimated_time_secs = job.estimated_time_secs`
- `actual_weight_g` = gramos reales del tracker del cliente Moonraker de esa impresora. Se agrega
  al `MoonrakerClient` un método/propiedad que exponga el total consumido de la impresión actual en
  gramos (derivado del mm acumulado y la densidad/diámetro del filamento cargado; si no se puede
  calcular, queda `None`).

## Frontend

### Dirección visual (frontend-design, dentro del sistema de tokens existente)

El sistema ya es themeable (12 temas, tokens HSL, glass-card, Inter + JetBrains Mono). La identidad
NO viene de una paleta propia (rompería el theming) sino de tres decisiones ancladas al subject —
un print farm, cuyo mundo es archivos de máquina, extrusión y piezas físicas:

- **Tipografía como lectura de máquina:** toda la metadata de archivos (paths, tamaños en bytes,
  timestamps, gramos, tiempos) se setea en **JetBrains Mono**. La UI de labels/títulos sigue en
  Inter. Un file manager *es* un readout de máquina; el mono lo hace explícito y distingue las
  pantallas nuevas sin romper cohesión.
- **La pieza como héroe:** en el panel de detalle, la miniatura embebida del G-code (la imagen real
  de la pieza que genera el slicer) es el elemento protagonista, grande, a la izquierda. Es lo más
  característico del mundo del subject.
- **Barras estimado-vs-real como medidor de extrusión:** dos pistas paralelas (estimado / real) por
  métrica, en SVG/CSS custom con el color `--primary`, con la diferencia porcentual anotada en mono.
  Es el elemento-firma, y se construye con el patrón de visualización que ya usa el codebase.

Quality floor: responsive a mobile, foco de teclado visible, `motion-reduced` respetado (ya hay
soporte global), estados vacíos con dirección ("No hay archivos en esta carpeta").

### 1. Página `/files` + entrada en el sidebar

- Sidebar: nueva entrada `{ href: "/files", label: "Archivos", icon: FolderOpen }` en `navItems`
  (`components/layout/sidebar.tsx`), ubicada tras "Cola de Impresión".
- Header de página: título + barra de búsqueda (input con icono lupa).
- **Modo explorar** (sin búsqueda activa):
  - Breadcrumb navegable en mono (`gcodes / 2026-06 / PLA`), cada segmento clickeable; raíz incluida.
  - Grid de carpetas (folder chips glass-card-hover, con nombre + conteo de archivos en mono).
  - Lista de archivos: cada fila = miniatura chica (lazy, vía `/api/files/thumbnail`; placeholder si
    204) + nombre (Inter) + línea mono de metadata (tamaño · fecha) + botón de descarga.
- **Modo búsqueda** (input con texto): reemplaza el explorador por resultados planos (mismas filas
  de archivo, mostrando el path relativo en mono). Debounce ~300 ms.
- Estados: cargando (skeleton), carpeta vacía, sin resultados de búsqueda.

### 2. Panel de detalle de trabajo (modal desde Historial)

- En `frontend/src/app/queue/page.tsx`, `HistoryTable`: filas clickeables (`onClick` en `<tr>`,
  `role="button"`, foco de teclado) → abren `<JobDetailModal>`. El botón "Repetir" existente hace
  `stopPropagation`.
- `JobDetailModal` (componente nuevo; reusa el wrapper de `AddJobModal`:
  `fixed inset-0 z-50 … bg-black/60 backdrop-blur-sm` + `glass-card w-full max-w-2xl … p-6`):
  - **Izquierda:** miniatura grande de la pieza (`/api/files/thumbnail?path=…`; placeholder si no
    hay). Debajo, botón de descarga (deshabilitado con tooltip "El archivo ya no está en disco" si
    no se puede resolver el path).
  - **Derecha:** tarjetas de datos (material, color, boquilla, impresora, iniciado, completado,
    duración, resultado con color de estado) + barras "estimado vs real":
    - Tiempo: `estimated_time_secs` vs `duration_secs`.
    - Filamento: `estimated_weight_g` vs `actual_weight_g` (si `actual` es null, solo estimado).
- Cierra con Escape / click en backdrop / botón X.

### 3. Tipos y cliente API

- `frontend/src/lib/types.ts`:
  - `PrintHistoryEntry` (reemplaza el `any[]` actual del historial), incluyendo los campos nuevos.
  - `FileNode` (`{ name, path, size_bytes, modified_at, material?, month? }`) y `FolderNode`
    (`{ name, path, file_count }`) y `BrowseResult`.
- `frontend/src/lib/api.ts`:
  - `browseFiles(path?)`, `searchFiles(q)`, `fileDownloadUrl(path)` (usa `apiUrl`),
    `fileThumbnailUrl(path)`.
  - Tipar `getHistory` como `PrintHistoryEntry[]`.

### 4. Gráfico

SVG/CSS custom (sin dependencia nueva), consistente con `progress-ring.tsx`. Componente
`EstimateVsActualBar` reutilizable (tiempo y filamento).

## Versionado

Bump `backend/app/version.py` → `APP_VERSION = "2.8.0"` (única fuente de verdad).

## Fuera de alcance (YAGNI)

- Listar/leer archivos remotos desde Moonraker (`/server/files/list`).
- Borrar/renombrar archivos desde la UI (el explorador es de lectura + descarga).
- Backfill del historial viejo con datos reales de filamento (no existen).
- Autenticación sobre los endpoints de archivos (consistente con el resto de la API actual).
