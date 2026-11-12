# LabTrack

Sistema de gestión de equipos de laboratorio. Incluye las cinco historias de usuario: autenticación, catálogo, solicitudes, decisiones administrativas y devoluciones.

## Tecnologías y requisitos

- JavaScript, React, Vite y CSS tradicional en el frontend.
- Node.js, Express, API REST y SQLite mediante `node:sqlite` en el backend.
- Node.js 24.14.1, npm y un navegador actual. Ejecuta `npm install` por separado en `backend` y `frontend`.

## Estructura

```text
backend/
  server.js       Servidor Express y rutas API
  auth.js         Autenticación, sesiones y protección por rol
  reservations.js Validación y consulta de reservas del estudiante
  adminReservations.js Listado y decisiones administrativas
  db.js           Esquema SQLite, migración y datos de desarrollo
  data/           Base de datos local (ignorada por Git)
frontend/         Aplicación React + Vite existente
README.md         Instalación, uso y rutas
QA_HANDOFF.md     Guía para las pruebas de calidad
```

## Ejecutar

Se requiere Node.js 24. En dos terminales:

```sh
cd backend
npm install
npm start
```

```sh
cd frontend
npm install
npm run dev
```

La base de datos se crea automáticamente en `backend/data/labtrack.sqlite`. Se puede cambiar su ubicación con `DB_PATH`. En producción (`NODE_ENV=production`) las tablas se crean siempre; las cuentas iniciales y los equipos se agregan solo si se configuran ambas contraseñas `SEED_STUDENT_PASSWORD` y `SEED_ADMIN_PASSWORD`.

Abre **la URL exacta que imprima Vite**. El frontend reenvía `/api` al backend en `http://localhost:3000`. También puedes comprobar `GET http://localhost:3000/api/health`.

## Docker Compose (entorno local de prueba)

Docker Desktop debe estar iniciado. Desde la raíz del proyecto, en PowerShell:

```powershell
docker compose config
docker compose up --build -d
docker compose ps
```

Abre `http://localhost:8080`. Nginx sirve React, los 18 JPG y `/api` mediante proxy hacia Express. El backend no publica su puerto; SQLite reside en el volumen persistente `labtrack_sqlite_data`, montado en `/data`, con `DB_PATH=/data/labtrack.sqlite`. Esta primera ejecución crea una **base de prueba independiente** con las cuentas de desarrollo de la tabla inferior. Compose pasa las contraseñas públicas de demostración al iniciar; `backend/devSeed.js` conserva el comportamiento local y se excluye de la imagen. Puedes cambiar `SEED_STUDENT_PASSWORD` y `SEED_ADMIN_PASSWORD` en el entorno antes de crear una base nueva. `NODE_ENV=development` permite esas cuentas y la cookie de sesión sobre HTTP local; esta configuración no es un despliegue de producción.

```powershell
docker compose logs -f backend frontend
docker compose down
docker compose up --build -d
```

`down` detiene los servicios y conserva el volumen. Tras modificar código, ejecuta de nuevo `docker compose up --build -d`. **No uses `down -v`** si quieres conservar la base del contenedor.

## Preparar Railway (sin publicar automáticamente)

1. En Railway crea un proyecto desde el repositorio GitHub `Fabricio151205/ProyectoT3Calidad`. Configura **dos servicios** conectados al mismo repositorio y rama: `backend` con *Root Directory* `/backend` y `frontend` con `/frontend`. Cada servicio detecta su propio `Dockerfile`; no uses `compose.yaml` como origen del despliegue.
2. En `backend`, configura `NODE_ENV=production`, `PORT=3000`, `DB_PATH=/data/labtrack.sqlite`, `LOCKOUT_MINUTES=5`, `SEED_STUDENT_PASSWORD` y `SEED_ADMIN_PASSWORD`. Genera **dos contraseñas distintas y largas** fuera del repositorio (por ejemplo, `node -e "console.log(require('node:crypto').randomBytes(24).toString('base64url'))"`) y guárdalas únicamente como variables privadas del servicio. Los códigos iniciales son `20240001` y `ADM001`; las contraseñas públicas de demostración de Compose no deben usarse en Railway. El sembrado crea usuarios y los 18 equipos solo si faltan; no reemplaza usuarios, reservas ni contraseñas ya guardadas. Si cambias estas variables después, no se rotan las contraseñas existentes.
3. Adjunta **un Railway Volume** solo a `backend`, montado en `/data`. Railway monta el volumen como root; configura `RAILWAY_RUN_UID=0` en ese servicio para permitir la escritura con esta imagen. Comprueba en los logs que SQLite abre `/data/labtrack.sqlite` y que `GET /api/health` responde. Configura la ruta de salud `/api/health`. Mantén una sola réplica de backend para este volumen.
4. No generes dominio público ni TCP Proxy para `backend`. En `frontend`, configura `PORT=8080` y `BACKEND_UPSTREAM=${{backend.RAILWAY_PRIVATE_DOMAIN}}:3000` como variable de referencia de Railway (o `backend.railway.internal:3000` si el servicio se llama exactamente `backend`). Nginx genera su configuración al arrancar y reenvía `/api` por la red privada. Configura la ruta de salud `/`.
5. Cuando decidas publicar, en **frontend → Settings → Networking → Public Networking**, selecciona *Generate Domain* con puerto destino `8080`. Railway suministra la URL HTTPS pública; comprueba `/api/health`, el inicio de sesión, los 18 equipos e imágenes y las cinco historias con datos de prueba. No hace falta CORS para este flujo del mismo origen. Las cookies de producción llevan `Secure`, `HttpOnly` y `SameSite=Lax`.
6. Para verificar persistencia, crea una reserva de prueba, anota su ID, reinicia o redespliega el backend y consulta `GET /api/mis-reservas` con la sesión iniciada de nuevo. Comprueba que el ID sigue allí. No importes automáticamente `backend/data/labtrack.sqlite` ni elimines el volumen. Consulta las opciones de respaldo de Railway antes de usar datos importantes.

El despliegue Railway requiere completar estas acciones en la cuenta del propietario; preparar el repositorio no crea servicios ni activa recursos de pago. El entorno local Docker Compose mantiene el proxy `backend:3000`, las cuentas públicas de prueba y el volumen independiente `labtrack_sqlite_data`.

### Respaldos e importación segura

`backend/backup.js` crea una copia SQLite consistente con `VACUUM INTO`, sin sobrescribir un archivo existente, y comprueba integridad y claves foráneas. Para respaldar la base local actual desde la raíz:

```powershell
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
node backend/backup.js "backend/backups/labtrack-local-$stamp.sqlite"
```

Para respaldar la base del volumen Docker en el host, con los contenedores activos:

```powershell
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$backupDir = Join-Path (Get-Location).Path 'backend\backups'
docker compose run --rm --no-deps -v "${backupDir}:/backup" backend node backup.js "/backup/labtrack-compose-$stamp.sqlite"
```

La base local `backend/data/labtrack.sqlite` y sus respaldos se excluyen del contexto Docker. Para importar **más adelante** un respaldo local a un volumen nuevo, primero detén la pila de prueba con `docker compose down` (sin `-v`). Usa el nombre real de un respaldo verificado en el siguiente ejemplo; el comando falla si la base de destino ya existe:

```powershell
$backup = (Resolve-Path '.\backend\backups\NOMBRE-DEL-RESPALDO.sqlite').Path
docker compose -p labtrack-import run --rm --no-deps -v "${backup}:/backup.sqlite:ro" backend sh -c 'test ! -e /data/labtrack.sqlite && cp /backup.sqlite /data/labtrack.sqlite'
docker compose -p labtrack-import up -d
```

El proyecto `labtrack-import` utiliza otro volumen persistente, `labtrack-import_sqlite_data`; no reemplaza la base local ni el volumen de prueba inicial. Después de importar, comprueba `docker compose -p labtrack-import ps`, `/api/health` y los recuentos de usuarios, equipos y reservas. No importes mientras otro servicio use el puerto 8080.

## Rutas HTTP

| Método | Ruta | Acceso | Uso |
| --- | --- | --- | --- |
| GET | `/api/health` | Público | Estado del backend |
| POST | `/api/auth/login` | Público | Inicio de sesión; JSON `{ "codigo": "...", "password": "..." }` |
| GET | `/api/auth/me` | Sesión | Usuario actual |
| POST | `/api/auth/logout` | Sesión | Cierre de sesión |
| GET | `/api/equipos` | Sesión | Catálogo y filtro `?categoria=` |
| POST | `/api/reservas` | Estudiante | Crear solicitud pendiente |
| GET | `/api/mis-reservas` | Estudiante | Solicitudes propias |
| GET | `/api/admin/resumen` | Administrador | Total de pendientes |
| GET | `/api/admin/reservas` | Administrador | Solicitudes pendientes |
| GET | `/api/admin/reservas/activas` | Administrador | Préstamos iniciados y pendientes de devolución |
| PATCH | `/api/admin/reservas/:id/aprobar` | Administrador | Aprobar solicitud |
| PATCH | `/api/admin/reservas/:id/rechazar` | Administrador | Rechazar con JSON `{ "motivo": "..." }` |
| PATCH | `/api/admin/reservas/:id/devolver` | Administrador | Registrar devolución |

`GET /api/equipos` acepta `?categoria=C%C3%B3mputo`, `?categoria=Electr%C3%B3nica` o `?categoria=Redes`. Los valores son exactos y cualquier otro parámetro devuelve `400`. La autenticación utiliza la cookie `labtrack_session`; el servidor determina el rol desde SQLite.

## Verificaciones

En `backend`:

```sh
npm test
npm run qa:flow
```

En `frontend`:

```sh
npm run build
npm run lint
```

`qa:flow` realiza un flujo HTTP de reserva, aprobación y devolución con una base SQLite temporal independiente. Consulta [QA_HANDOFF.md](QA_HANDOFF.md) para Selenium, JMeter y SonarQube.

## Reservas HU-03

Inicia sesión como estudiante, elige un equipo disponible y pulsa **Reservar**. Selecciona fecha, hora de inicio y hora de finalización; después de enviar la solicitud aparecerá en **Mis reservas** con estado **Pendiente**.

`POST /api/reservas` requiere una sesión de estudiante y JSON con `equipoId` (entero), `fecha` (`YYYY-MM-DD`), `horaInicio` y `horaFin` (`HH:mm`). Devuelve `201` y el ID de la solicitud pendiente. `GET /api/mis-reservas` devuelve solo las solicitudes del estudiante autenticado. La fecha y las horas se interpretan en **America/Lima (UTC−05:00)** y se guardan en UTC. Los intervalos son `[inicio, fin)`: un horario que comienza al finalizar otro no se cruza.

El backend comprueba conflictos con reservas **aprobadas** del equipo y del estudiante dentro de una transacción de escritura. Las solicitudes pendientes pueden coincidir; la aprobación de HU-04 vuelve a comprobar ambos cruces y se mantienen los disparadores de SQLite que impiden aprobar conflictos. Una solicitud pendiente no cambia el estado físico del equipo.

## Gestión administrativa HU-04

Entra con `ADM001` / `Admin123!` para ver las solicitudes pendientes. **Aprobar** pide confirmación y vuelve a comprobar los cruces antes de actualizar la reserva. **Rechazar** exige un motivo y lo guarda junto con el estado `RECHAZADA`. La tabla se actualiza sin recargar la página.

Las rutas administrativas requieren sesión y rol `ADMINISTRADOR`:

- `GET /api/admin/reservas` devuelve las solicitudes pendientes y datos del estudiante, equipo y horario de Lima.
- `PATCH /api/admin/reservas/:id/aprobar` aprueba una solicitud pendiente o responde `409` si el equipo o estudiante tiene otra reserva aprobada que se superpone.
- `PATCH /api/admin/reservas/:id/rechazar` recibe JSON `{ "motivo": "..." }` y rechaza una solicitud pendiente.

Los intervalos siguen la regla `[inicio, fin)`. Una reserva aprobada vigente se muestra como **Prestado** en el catálogo; el estado físico del equipo no se modifica de forma permanente.

## Devoluciones HU-05

En el panel del administrador, la sección **Devoluciones** muestra las reservas aprobadas cuyo inicio ya ocurrió y que siguen sin devolución. Puedes buscar por nombre o código universitario del estudiante y por nombre o código del equipo. **Marcar devolución** pide confirmación, registra la hora del servidor y quita la reserva del listado sin recargar la página.

`GET /api/admin/reservas/activas` y `PATCH /api/admin/reservas/:id/devolver` requieren sesión con rol `ADMINISTRADOR`. La devolución cambia la reserva a `DEVUELTA` y guarda `devuelta_en` en UTC. Un disparador de SQLite registra `retraso` y cambia el estado del estudiante a `PENALIZADO` cuando la devolución es posterior al fin acordado, dentro de la misma transacción. Una devolución puntual conserva el estado previo. La respuesta incluye `retraso` y `penalizacionAplicada`. No se acepta una fecha de devolución enviada por el navegador.

Para comprobar un retraso desde el navegador, solicita como estudiante un horario próximo, apruébalo como administrador y espera a que pase la hora de fin. Después pulsa **Marcar devolución**. El panel indicará el retraso; al volver a iniciar sesión como estudiante verás el estado `PENALIZADO`. Para comprobar una devolución puntual, regístrala antes de la hora de fin. El catálogo muestra **Prestado** desde el inicio de una reserva aprobada hasta su devolución física, incluso si el horario acordado ya venció, y **Disponible** inmediatamente después de devolverla.

## Datos de desarrollo

| Rol | Código para iniciar sesión | Contraseña |
| --- | --- | --- |
| ESTUDIANTE | 20240001 | Estudiante123! |
| ADMINISTRADOR | ADM001 | Admin123! |

Las contraseñas se almacenan como hashes `scrypt` con sal aleatoria por usuario. Estas cuentas son solo para desarrollo. El bloqueo después de tres intentos fallidos dura cinco minutos de forma predeterminada; se puede configurar con `LOCKOUT_MINUTES`. Las sesiones usan una cookie `HttpOnly`, `SameSite=Lax` y, en producción, `Secure`.

El catálogo de desarrollo incluye 18 equipos: seis de Cómputo, seis de Electrónica y seis de Redes. Tras entrar como estudiante, prueba los filtros Todos, Cómputo, Electrónica y Redes. La respuesta muestra nombre, código, categoría, estado e `imagen_url`. Los equipos en mantenimiento o inactivos se excluyen del catálogo de préstamo. Una categoría sin equipos devuelve `[]` y la interfaz muestra el mensaje definido en HU-02. El esquema define usuarios, equipos y reservas. Dos solicitudes pendientes pueden coincidir, pero no se pueden aprobar reservas simultáneas del mismo equipo ni dos reservas simultáneas para un estudiante. Una reserva rechazada exige motivo. Las horas acordadas se guardan en UTC como `YYYY-MM-DDTHH:mm:ssZ` y la devolución real conserva milisegundos.

Las fotos del catálogo están en `frontend/public/equipos/`. Para añadir otra, guarda allí un JPG con nombre descriptivo en minúsculas y guiones, por ejemplo `nuevo-equipo.jpg`, y asigna `/equipos/nuevo-equipo.jpg` a `equipos.imagen_url` en SQLite. Si forma parte del catálogo de ejemplo, añade también su código, nombre, categoría y archivo a la lista `catalog` de `backend/db.js`. El frontend muestra «Imagen no disponible» cuando la ruta falta o la imagen no carga.

Las reglas provienen de `Historias Usuario-LabTrack.docx` y `Desarrollo de Caso T3 -LabTrack.docx`. La ruta administrativa existente `GET /api/admin/resumen` sigue disponible y requiere sesión y rol ADMINISTRADOR. El documento no define duración de la penalización; el sistema conserva el estado `PENALIZADO` hasta que se establezca una regla para levantarla.
