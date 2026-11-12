# Casos de prueba por historia de usuario

Este catálogo integra los 30 casos del informe de pruebas de LabTrack y los vincula con las pruebas del backend. Los prefijos `[HU-xx][CP-xxx]` aparecen en la salida de `npm test` y en los nombres de las pruebas automatizadas.

**Ejecución automatizada:** desde `backend`, ejecutar `npm test`. Las pruebas usan bases SQLite temporales. `Automatizado` indica que el escenario funcional tiene una prueba automatizada; `Parcial` indica que el API está probado, pero falta verificar la interfaz; `Manual` requiere interacción visual o una herramienta externa. La cobertura se refiere al escenario probado, no a una certificación de toda la historia.

## HU-01 — Autenticación segura

| ID | Caso | Tipo | Resultado esperado | Cobertura |
| --- | --- | --- | --- | --- |
| CP-001 | Iniciar sesión con credenciales válidas | Positiva | Se autentica al estudiante y se establece una sesión. | Automatizado — `server.test.js` |
| CP-002 | Iniciar sesión con un código inexistente | Negativa | Se deniega el acceso con un mensaje genérico de credenciales inválidas. | Automatizado — `server.test.js` |
| CP-003 | Iniciar sesión con contraseña incorrecta | Negativa | Se deniega el acceso. | Automatizado — `server.test.js` |
| CP-004 | Enviar el formulario con campos vacíos | Negativa | La interfaz requiere los campos; el API rechaza los datos vacíos. | Parcial — API en `server.test.js`; falta validar el formulario visualmente. |
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
| CP-012 | Filtrar una categoría sin equipos | Negativa | El catálogo devuelve una lista vacía. | Automatizado — `server.test.js` |
| CP-013 | Consultar el catálogo con usuarios concurrentes | Rendimiento | Las consultas concurrentes no provocan errores ni resultados inconsistentes. | Manual — JMeter; el informe propone 50 usuarios por 60 segundos, pero no define umbrales de aceptación. |

## HU-03 — Reserva de equipos

| ID | Caso | Tipo | Resultado esperado | Cobertura |
| --- | --- | --- | --- | --- |
| CP-014 | Reservar un equipo disponible con horario válido | Positiva | Se registra una solicitud pendiente con el equipo y horario elegidos. | Automatizado — `server.test.js` |
| CP-015 | Intentar reservar un equipo que aparece prestado | Negativa | La interfaz impide seleccionar el equipo durante el préstamo. | Manual — requiere comprobar la interacción del catálogo; el API no prueba la interfaz. |
| CP-016 | Reservar un equipo en un horario que se cruza con otra aprobada | Negativa | Se rechaza la solicitud en conflicto. | Automatizado — `server.test.js` |
| CP-017 | Reservar un equipo después de una reserva existente | Positiva | Se permite el horario consecutivo, sin superposición. | Automatizado — `server.test.js` |
| CP-018 | Reservar dos equipos simultáneamente como el mismo estudiante | Negativa | Se rechaza la segunda reserva que se superpone. | Automatizado — `server.test.js` |
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
| CP-025 | Buscar una reserva activa | Positiva | El administrador encuentra la reserva por datos del estudiante o equipo. | Parcial — `returns.test.js` prueba el listado del API; la búsqueda en la interfaz es manual. |
| CP-026 | Registrar la devolución de un equipo | Positiva | La reserva cambia a Devuelta y se conserva en el historial. | Automatizado — `returns.test.js` |
| CP-027 | Verificar disponibilidad después de la devolución | Positiva | El equipo vuelve a mostrarse Disponible. | Automatizado — `returns.test.js` |
| CP-028 | Devolver antes de la hora de fin acordada | Positiva | La devolución se registra sin aplicar penalización. | Automatizado — `returns.test.js` |
| CP-029 | Devolver después de la hora de fin acordada | Negativa | Se registra el retraso y se penaliza al estudiante. | Automatizado — `returns.test.js` |
| CP-030 | Devolver exactamente a la hora de fin acordada | Límite | Se registra la devolución sin considerarla tardía. | Automatizado — `returns.test.js` |

## Cobertura manual pendiente

- **CP-004:** comprobar en el navegador la validación visual de campos obligatorios.
- **CP-013:** ejecutar la carga con JMeter y acordar previamente latencia máxima y tasa de errores aceptable; el informe no define esos límites.
- **CP-015:** comprobar que la interfaz no permita solicitar un equipo que se muestra como Prestado.
- **CP-025:** verificar que la búsqueda visual de devoluciones filtre por estudiante y equipo; la prueba automatizada cubre el listado del API, no los controles de búsqueda.

Los demás escenarios CP-001–CP-030 están vinculados a pruebas automatizadas del backend. También existen pruebas adicionales de autorización, validación, migración, conflictos y reglas de base de datos que no forman parte de los 30 casos del informe.
