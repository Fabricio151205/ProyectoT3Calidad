# LabTrack: traspaso al equipo de calidad

## Preparación del entorno

Requiere Node.js 24.14.1 y npm. Instala dependencias con `npm install` en `backend` y `frontend`. El backend escucha en `http://localhost:3000` por defecto. Ejecuta Vite con `npm run dev` desde `frontend` y utiliza **la URL exacta que muestre su terminal**; el proxy de Vite dirige `/api` a `http://localhost:3000`.

Para pruebas manuales, Selenium o JMeter, usa una base distinta de `backend/data/labtrack.sqlite`. En PowerShell, desde `backend` y antes de iniciar el servidor:

```powershell
$env:DB_PATH = Join-Path $env:TEMP 'labtrack-qa-equipo.sqlite'
$env:NODE_ENV = 'development'
npm start
```

Elige un nombre de archivo distinto por ejecución o equipo. Comprueba el valor de `DB_PATH` antes de arrancar. No apuntes a la base actual ni la reinicies. En desarrollo, `backend/db.js` crea el esquema y carga las cuentas y equipos de ejemplo en una base nueva. Para aislar pruebas simultáneas, usa archivos y procesos backend distintos; configura `PORT` y el proxy de Vite si necesitas puertos diferentes. La prueba `npm run qa:flow` crea y elimina su propia base temporal, sin usar `DB_PATH` del entorno.

| Rol | Código | Contraseña de desarrollo |
| --- | --- | --- |
| ESTUDIANTE | `20240001` | `Estudiante123!` |
| ADMINISTRADOR | `ADM001` | `Admin123!` |

Estas credenciales son solo para bases de desarrollo. Las contraseñas se almacenan con `scrypt` y sal, nunca en texto plano.

## Autenticación y rutas

`POST /api/auth/login` recibe JSON `{ "codigo": "20240001", "password": "Estudiante123!" }` y responde con `Set-Cookie: labtrack_session=...`. La cookie es `HttpOnly`, `SameSite=Lax` y `Secure` cuando `NODE_ENV=production`. No envíes un rol desde el cliente. En Selenium conserva la cookie con el mismo navegador; en JMeter usa **HTTP Cookie Manager** y una sesión por usuario virtual. `POST /api/auth/logout` elimina la sesión y la cookie. Una petición sin cookie a rutas protegidas responde `401`; un estudiante en rutas administrativas recibe `403`.

| Método | Ruta | Rol | Cuerpo o parámetro |
| --- | --- | --- | --- |
| GET | `/api/health` | Público | Ninguno |
| POST | `/api/auth/login` | Público | `codigo`, `password` |
| GET | `/api/auth/me` | Autenticado | Ninguno |
| POST | `/api/auth/logout` | Autenticado | Ninguno |
| GET | `/api/equipos` | Autenticado | `categoria` opcional: `Cómputo`, `Electrónica`, `Redes` |
| POST | `/api/reservas` | Estudiante | `equipoId`, `fecha` (`YYYY-MM-DD`), `horaInicio`, `horaFin` (`HH:mm`) |
| GET | `/api/mis-reservas` | Estudiante | Ninguno |
| GET | `/api/admin/resumen` | Administrador | Ninguno |
| GET | `/api/admin/reservas` | Administrador | Ninguno |
| GET | `/api/admin/reservas/activas` | Administrador | Ninguno |
| PATCH | `/api/admin/reservas/:id/aprobar` | Administrador | Ninguno |
| PATCH | `/api/admin/reservas/:id/rechazar` | Administrador | JSON `{ "motivo": "..." }` no vacío |
| PATCH | `/api/admin/reservas/:id/devolver` | Administrador | Ninguno; el servidor fija la hora real |

Usa `Content-Type: application/json` en los envíos JSON. Las fechas y horas de los formularios se interpretan en `America/Lima` y se almacenan en UTC. Los intervalos de reserva son `[inicio, fin)`. Una aprobación futura no marca el equipo como **Prestado** hasta que comience. Una reserva aprobada que ya comenzó figura en `/api/admin/reservas/activas` hasta la devolución, incluso si pasó su hora acordada de fin. La devolución cambia el estado visible del equipo a **Disponible**; una devolución tardía penaliza al estudiante.

## Flujos críticos para Selenium

1. Iniciar sesión como estudiante; verificar catálogo, filtros exactos y cierre de sesión.
2. Crear una solicitud futura; comprobar **Pendiente** en **Mis reservas**.
3. Iniciar sesión como administrador; aprobar la solicitud; comprobar **Aprobada** al volver a la sesión del estudiante.
4. Crear una solicitud concurrente para el mismo equipo con otro estudiante de QA; comprobar rechazo de aprobación por conflicto. También comprobar conflicto por horario simultáneo del mismo estudiante.
5. Crear otra solicitud y rechazarla: exigir motivo, guardar el rechazo y comprobar que desaparece de pendientes.
6. Para devolución, usar una reserva aprobada cuyo inicio ya ocurrió. Buscarla en **Devoluciones**, marcarla y comprobar que desaparece del listado, conserva el historial y libera el equipo. Comprobar la penalización con una devolución posterior al fin acordado. En automatización, prepara el horario controlado únicamente en la base aislada.
7. Comprobar `401` sin sesión, `403` para estudiante en rutas de administrador, mensajes de error, carga y que cada operación actualiza la vista sin recargar la página.

Los datos semilla solo incluyen un estudiante. Crea estudiantes adicionales **solo en la base de QA** cuando pruebes conflictos entre usuarios. No uses la base actual para escenarios destructivos o cargas.

## JMeter y SonarQube

En JMeter usa el origen del backend (`http://localhost:3000`) y HTTP Cookie Manager. Inicia sesión por usuario virtual antes de las rutas protegidas. Para pruebas de lectura, consulta `/api/health`, `/api/equipos` y los listados autorizados. Para escritura, genera fechas futuras e identificadores de reserva propios dentro de la base aislada. Las aprobaciones sobre el mismo horario deben producir como máximo un éxito; las demás pueden responder `409`. No interpretes un `409` esperado como caída del servicio. Registra distribución de latencia, tasa de errores inesperados, concurrencia y configuración del entorno.

En SonarQube analiza `backend` y `frontend/src`. Excluye `node_modules`, `frontend/dist`, bases `.sqlite` y artefactos temporales. Ejecuta primero `npm test` en `backend` y `npm run lint` y `npm run build` en `frontend`; conserva los resultados y reporta por separado cualquier cobertura o regla de SonarQube que realmente se haya medido. No hay configuración ni resultado de SonarQube generado por este proyecto.

## Comandos de comprobación

```powershell
cd backend
npm test
npm run qa:flow

cd ..\frontend
npm run build
npm run lint
```

`qa:flow` verifica por HTTP login, catálogo, reserva, aprobación, conflicto, devolución tardía, penalización, rechazo, autorización y cierre de sesión. Para verificar integridad de una base de QA, ejecuta `PRAGMA integrity_check` y `PRAGMA foreign_key_check` con `node:sqlite` en modo de solo lectura. Conserva la salida de Selenium, JMeter y SonarQube como evidencia independiente; una prueba HTTP no sustituye la comprobación visual.
