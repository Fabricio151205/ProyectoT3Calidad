# Entorno local aislado para CP-013

Desde la raíz de LabTrack, crea `.env.jmeter` con dos contraseñas de QA elegidas por el equipo:

```text
SEED_STUDENT_PASSWORD=<contraseña de QA del estudiante>
SEED_ADMIN_PASSWORD=<contraseña de QA del administrador>
```

El archivo `.env.jmeter` está excluido de Git. No uses credenciales de Railway ni compartas la salida de `docker compose config`, que puede mostrar variables del contenedor. Para iniciar y detener **solo** este entorno:

```powershell
docker compose -f compose.jmeter.yaml config --quiet
docker compose -f compose.jmeter.yaml up --build -d
docker compose -f compose.jmeter.yaml ps
docker compose -f compose.jmeter.yaml logs -f backend frontend
docker compose -f compose.jmeter.yaml down
```

La URL probada de QA es `http://127.0.0.1:8081`. El backend no publica un puerto al host; Nginx reenvía `/api` al servicio `backend:3000` dentro de la red `labtrack-jmeter_jmeter_net`. La SQLite de QA está en `/data/jmeter.sqlite` sobre `tmpfs`: se crea al iniciar el contenedor y se pierde al ejecutar `down`. No hay volúmenes Docker en este Compose. La configuración habitual `compose.yaml` y su volumen no se utilizan.

Una base nueva contiene los códigos `20240001` (estudiante) y `ADM001` (administrador), con las contraseñas del archivo local. El catálogo contiene 18 equipos: seis de Cómputo, seis de Electrónica y seis de Redes; Mecánica permanece vacía. Comprueba `/api/health`, inicia sesión con `POST /api/auth/login`, conserva la cookie `labtrack_session`, consulta `GET /api/equipos` y crea una solicitud futura con `POST /api/reservas` antes de iniciar la carga.

En Apache JMeter, cambia **HTTP Request Defaults → Server Name or IP** a `127.0.0.1` y **Port Number** de `8080` a `8081`; deja `http`. Añade **HTTP Cookie Manager** para conservar la cookie por usuario virtual. El archivo `CP-013 - 50 usuarios LabTrack.jmx` contiene por ahora el Thread Group y HTTP Request Defaults, pero **no tiene HTTP Request samplers**; prepara las solicitudes y las comprobaciones de respuesta antes de ejecutar CP-013. Evita que los 50 hilos usen el mismo horario de reserva: los conflictos `409` serían válidos por la regla de negocio, no necesariamente fallos de rendimiento. No ejecutes esta carga contra `localhost:8080` ni Railway.

## Monitoreo durante las pruebas de carga

Desde otra ventana de PowerShell, en la raíz del proyecto, inicia el monitor **antes** de comenzar la prueba de JMeter:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\jmeter\monitor.ps1 -Nombre cp013-300
```

Detenlo con **Ctrl+C** después de que termine la prueba. Para la etapa siguiente, usa `-Nombre cp013-400`. El monitor no inicia JMeter ni modifica los contenedores; requiere Node.js y Docker disponibles en PowerShell. Solo lee los dos servicios de `compose.jmeter.yaml`. Guarda dos CSV por ejecución en `jmeter/resultados/`, carpeta excluida de Git: `*-metricas.csv` (conexiones, CPU y memoria) y `*-errores.csv` (conteos de errores de conexión y HTTP 502). No guarda las líneas de acceso, cookies ni datos personales.

Las filas llevan hora UTC (`utc`) e intervalo real en segundos. Compara ese tiempo con el inicio y fin de JMeter; si el plan exporta un JTL, sus marcas de tiempo suelen estar en milisegundos Unix y se pueden convertir a UTC. Busca si aumentan `nginx_hacia_backend_time_wait` y `nginx_connect_eaddrnotavail` en los mismos segundos que los HTTP 502. La primera fila de CPU/memoria puede estar vacía mientras Docker entrega su primer dato. Estas métricas son del entorno local y no miden la capacidad de Railway.
