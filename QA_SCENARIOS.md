# Escenarios aislados para CP-012, CP-025 y CP-030

Estos comandos crean **una base SQLite nueva en `%TEMP%` en cada ejecución** y levantan Express solo en `127.0.0.1:3000`. El script imprime la ruta exacta de la base y los identificadores de las reservas. No usa la base local de LabTrack, el volumen Docker ni Railway. No ejecutes estos escenarios en producción.

## Iniciar un escenario

En una terminal, desde `backend`:

```powershell
$env:SEED_STUDENT_PASSWORD = (Read-Host 'Contraseña de estudiante QA' -AsSecureString | ConvertFrom-SecureString -AsPlainText)
$env:SEED_ADMIN_PASSWORD = (Read-Host 'Contraseña de administrador QA' -AsSecureString | ConvertFrom-SecureString -AsPlainText)
node qa/scenarios.js empty-category
```

Para CP-025 con las tres categorías pobladas, utiliza otra ejecución independiente:

```powershell
node qa/scenarios.js active-loans
```

Detén la primera ejecución antes de iniciar la segunda: ambas escuchan en el puerto 3000. Cada comando conserva su propia base temporal para inspección posterior. En otra terminal, desde `frontend`, ejecuta `npm run dev` y abre **la URL que Vite imprima**. El proxy de Vite dirige `/api` a `localhost:3000`.

Credenciales configuradas por cada integrante para estas bases:

| Rol | Código | Contraseña |
| --- | --- | --- |
| Estudiante Juan Pérez | `20261001` | Valor de `SEED_STUDENT_PASSWORD` |
| Administrador de prueba | `ADM001` | Valor de `SEED_ADMIN_PASSWORD` |

Las contraseñas se guardan mediante el `scrypt` existente. No se incluyen contraseñas de Railway. El escenario `active-loans` contiene los 18 equipos de demostración, más `Laptop HP-001` (`HP-001`) y `Proyector PR-002` (`PR-002`), con equipos en Cómputo, Electrónica y Redes. Ambos escenarios incluyen una solicitud pendiente, una rechazada con motivo, una reserva aprobada vigente de Juan Pérez para la laptop, una aprobación futura del proyector y un préstamo vencido de Ana QA para probar una devolución tardía. `empty-category` deja Redes sin equipos **solo en su propia base QA**.

## Pasos para Selenium o revisión manual

**CP-012:** inicia `empty-category`, entra como `20261001`, abre Catálogo y elige Redes. Comprueba que el catálogo muestre exactamente `No hay equipos disponibles en esta categoría`. Cambia a Cómputo y Electrónica y comprueba que ambas muestren equipos. La API `GET /api/equipos?categoria=Redes` debe responder `[]` con la cookie de sesión.

**CP-025:** inicia `active-loans`, entra como administrador y abre Devoluciones. Comprueba que figure Juan Pérez con `Laptop HP-001` y el botón `Marcar devolución`. Busca sucesivamente `Juan Pérez`, `20261001`, `Laptop HP-001` y `HP-001`; la misma fila debe permanecer visible. `Proyector PR-002` tiene una aprobación futura y no debe aparecer en Devoluciones. La búsqueda se realiza en React sobre la respuesta de `GET /api/admin/reservas/activas`.

**CP-030:** ejecuta `npm test` y `npm run qa` desde `backend`. Ambas pruebas utilizan bases temporales y un reloj controlado dentro del proceso para llamar a `PATCH /api/admin/reservas/:id/devolver` exactamente a la hora final. Verifican estado `DEVUELTA`, ausencia de retraso y penalización, y disponibilidad del equipo. No envían la hora desde HTTP ni cambian el reloj de Windows.

Si usas Selenium, inicia un navegador con perfil limpio para que no conserve cookies de otra instancia de LabTrack. La URL de Vite y la ruta de SQLite se obtienen de la salida de cada proceso; no las presupongas. Conserva el proceso del escenario activo durante la prueba. No uses `docker compose down -v` ni los datos persistentes del proyecto.
