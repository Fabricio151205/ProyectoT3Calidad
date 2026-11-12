# Casos de prueba por historia de usuario

Este catálogo integra los 30 casos del informe de pruebas de LabTrack y los vincula con las pruebas del backend. Los prefijos `[HU-xx][CP-xxx]` aparecen en la salida de `npm test` y en los nombres de las pruebas automatizadas.

**Evidencia diferenciada:** `npm test` ejecuta pruebas automatizadas con bases SQLite temporales; `npm run qa` recorre un flujo HTTP real también aislado. Las comprobaciones visuales indicadas abajo se hicieron en un navegador con escenarios QA temporales, pero aún no forman una suite Selenium reproducible. La cobertura de una fila no equivale a certificar toda la historia. CP-013 continúa sin verificar hasta ejecutar JMeter.

## Importar los casos a TestLink

1. Desde esta carpeta `backend`, ejecutar `npm run qa:testlink:export`. Esto genera `qa/testlink-import.xml` a partir de las tablas de este documento, agrupando los casos por HU y conservando ID, tipo, cobertura y resultado esperado.
2. En TestLink, crear o abrir el proyecto de pruebas LabTrack y usar la opción de importar casos de prueba desde XML en el árbol de especificaciones.
3. Seleccionar `backend/qa/testlink-import.xml`. TestLink creará una suite por historia de usuario y un caso por cada CP-001–CP-030. Los casos se importan como ejecución manual; la columna Cobertura indica si hay una prueba automatizada vinculada en el backend.

La importación incorpora un paso general por caso con el resultado esperado; no reemplaza los pasos detallados del informe ni registra ejecuciones automáticamente. El proyecto no contiene instancia, credenciales ni plan/build de TestLink configurados. Las ejecuciones automatizadas se verifican actualmente con `npm test`.

## HU-01 — Autenticación segura

| ID | Caso | Tipo | Resultado esperado | Cobertura |
| --- | --- | --- | --- | --- |
| CP-001 | Iniciar sesión con credenciales válidas | Positiva | Se autentica al estudiante y se establece una sesión. | Automatizado — `server.test.js` |
| CP-002 | Iniciar sesión con un código inexistente | Negativa | Se deniega el acceso con un mensaje genérico de credenciales inválidas. | Automatizado — `server.test.js` |
| CP-003 | Iniciar sesión con contraseña incorrecta | Negativa | Se deniega el acceso. | Automatizado — `server.test.js` |
| CP-004 | Enviar el formulario con campos vacíos | Negativa | La interfaz requiere los campos; el API rechaza los datos vacíos. | Automatizado — `server.test.js`; visual — navegador mostró «Completa este campo». |
| CP-005 | Fallar tres inicios de sesión consecutivos | Negativa | La cuenta queda bloqueada temporalmente al tercer intento. | Automatizado — `server.test.js` |
| CP-006 | Iniciar sesión mientras la cuenta está bloqueada | Seguridad | El acceso se mantiene denegado hasta que expire el bloqueo. | Automatizado — `server.test.js` |

## HU-02 — Catálogo y filtrado de equipos

| ID | Caso | Tipo | Resultado esperado | Cobertura |
| --- | --- | --- | --- | --- |
| CP-007 | Visualizar el catálogo | Positiva | Se muestra el catálogo de equipos registrados. | Automatizado — `server.test.js` |
| CP-008 | Verificar los datos de los equipos | Positiva | Cada equipo expone nombre, código, categoría e información de disponibilidad. | Automatizado — `server.test.js` |
| CP-009 | Filtrar por Cómputo | Positiva | Solo aparecen equipos de Cómputo. | Automatizado — `server.test.js` |
| CP-010 | Filtrar por Electrónica | Positiva | Solo aparecen equipos de Electrónica. | Automatizado — `server.test.js` |
| CP-011 | Filtrar por Redes | Positiva | Solo aparecen equipos de Redes. | Automatizado — `server.test.js` |
| CP-012 | Filtrar una categoría sin equipos | Negativa | El API devuelve una lista vacía y React muestra «No hay equipos disponibles en esta categoría». | Automatizado — `server.test.js` y `qa/scenarios.test.js`; visual — filtro Redes vacío en base QA aislada. |
| CP-013 | Consultar el catálogo con usuarios concurrentes | Rendimiento | Las consultas concurrentes no provocan errores ni resultados inconsistentes. | SIN VERIFICAR — pendiente de JMeter; el informe propone 50 usuarios por 60 segundos, pero no define umbrales de aceptación. |

## HU-03 — Reserva de equipos

| ID | Caso | Tipo | Resultado esperado | Cobertura |
| --- | --- | --- | --- | --- |
| CP-014 | Reservar un equipo disponible con horario válido | Positiva | Se registra una solicitud pendiente con el equipo y horario elegidos. | Automatizado — `server.test.js` |
| CP-015 | Intentar reservar un equipo que aparece prestado | Negativa | «Consultar horario» permite elegir fecha y horas; el backend rechaza con 409 el horario cubierto por una reserva aprobada. | Automatizado — `server.test.js`; visual — Laptop HP-001 mostró el formulario y el rechazo del horario ocupado en base QA. |
| CP-016 | Reservar un equipo en un horario que se cruza con otra aprobada | Negativa | Se rechaza la solicitud en conflicto. | Automatizado — `server.test.js` |
| CP-017 | Reservar un equipo después de una reserva existente | Positiva | Se permite el horario consecutivo, sin superposición. | Automatizado — `server.test.js` |
| CP-018 | Reservar dos equipos simultáneamente como el mismo estudiante | Negativa | Se rechaza la segunda solicitud superpuesta cuando la primera está PENDIENTE o APROBADA; los horarios consecutivos siguen permitidos. | Automatizado — `server.test.js`; HTTP — `qa/full-flow.js` comprueba solicitudes simultáneas 201/409. |
| CP-019 | Reservar otro equipo después de que finalice la reserva anterior | Positiva | Se permite la nueva solicitud posterior. | Automatizado — `server.test.js` |

## HU-04 — Gestión de solicitudes del administrador

| ID | Caso | Tipo | Resultado esperado | Cobertura |
| --- | --- | --- | --- | --- |
| CP-020 | Ver las solicitudes pendientes | Positiva | El administrador ve estudiante, equipo y horario de cada solicitud. | Automatizado — `adminReservations.test.js` |
| CP-021 | Aprobar una solicitud pendiente | Positiva | La solicitud cambia a Aprobada y deja la lista de pendientes. | Automatizado — `adminReservations.test.js` |
| CP-022 | Rechazar una solicitud con justificación | Positiva | La solicitud queda Rechazada y conserva el motivo. | Automatizado — `adminReservations.test.js` |
| CP-023 | Rechazar una solicitud sin justificación | Negativa | Se impide el rechazo y se solicita un motivo válido. | Automatizado — `adminReservations.test.js` |
| CP-024 | Verificar el estado del equipo tras aprobar una reserva vigente | Positiva | El catálogo muestra el equipo como Prestado durante el préstamo. | Automatizado — `adminReservations.test.js` |

## HU-05 — Devolución y penalización automática

| ID | Caso | Tipo | Resultado esperado | Cobertura |
| --- | --- | --- | --- | --- |
| CP-025 | Buscar una reserva activa | Positiva | El administrador encuentra la reserva activa por nombre o código del estudiante o equipo; una aprobación futura no figura. | Automatizado — `returns.test.js` y `qa/scenarios.test.js` verifican el API; visual — cuatro búsquedas y «Marcar devolución» en base QA. |
| CP-026 | Registrar la devolución de un equipo | Positiva | La reserva cambia a Devuelta y se conserva en el historial. | Automatizado — `returns.test.js` |
| CP-027 | Verificar disponibilidad después de la devolución | Positiva | El equipo vuelve a mostrarse Disponible. | Automatizado — `returns.test.js` |
| CP-028 | Devolver antes de la hora de fin acordada | Positiva | La devolución se registra sin aplicar penalización. | Automatizado — `returns.test.js` |
| CP-029 | Devolver después de la hora de fin acordada | Negativa | Se registra el retraso y se penaliza al estudiante. | Automatizado — `returns.test.js` |
| CP-030 | Devolver exactamente a la hora de fin acordada | Límite | El endpoint registra DEVUELTA sin retraso ni penalización y el equipo vuelve a Disponible. | Automatizado — `returns.test.js`; HTTP — `qa/full-flow.js` usa un reloj controlado dentro del proceso. |

## Pruebas adicionales pendientes

- **CP-013:** ejecutar la carga con JMeter y acordar previamente latencia máxima y tasa de errores aceptable; el informe no define esos límites. Es el único caso aún sin verificar de la matriz de 30.
- **Selenium:** repetir automáticamente las comprobaciones visuales de CP-004, CP-012, CP-015 y CP-025; las observaciones manuales/asistidas por navegador no sustituyen una suite de regresión. Los escenarios están descritos en `../QA_SCENARIOS.md`.

Los demás escenarios CP-001–CP-030 están vinculados a pruebas automatizadas del backend. También existen pruebas adicionales de autorización, validación, migración, conflictos y reglas de base de datos que no forman parte de los 30 casos del informe.
