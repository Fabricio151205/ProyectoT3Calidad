const assert = require('node:assert/strict');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');

const tempDirectory = mkdtempSync(path.join(tmpdir(), 'labtrack-http-flow-'));
process.env.DB_PATH = path.join(tempDirectory, 'flow.sqlite');

const { db, hashPassword } = require('../db');
const app = require('../server');

async function main() {
  let server;
  try {
    server = await new Promise((resolve, reject) => {
      const running = app.listen(0, '127.0.0.1');
      running.once('listening', () => resolve(running));
      running.once('error', reject);
    });
    const base = `http://127.0.0.1:${server.address().port}`;

    async function request(method, route, cookie = '', body) {
      const response = await fetch(base + route, {
        method,
        headers: {
          ...(cookie ? { Cookie: cookie } : {}),
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      return {
        status: response.status,
        body: response.status === 204 ? null : await response.json(),
        cookie: response.headers.get('set-cookie')?.split(';')[0] || '',
      };
    }

    const secondStudentId = Number(db.prepare(`
      INSERT INTO usuarios (nombre, email, codigo, password_hash, rol)
      VALUES ('Estudiante QA', 'qa@labtrack.test', 'QA002', ?, 'ESTUDIANTE')
    `).run(hashPassword('Prueba123!')).lastInsertRowid);
    const studentLogin = await request('POST', '/api/auth/login', '',
      { codigo: '20240001', password: 'Estudiante123!' });
    assert.equal(studentLogin.status, 200);
    const student = studentLogin.cookie;
    const allEquipment = await request('GET', '/api/equipos', student);
    assert.equal(allEquipment.status, 200);
    assert.equal(allEquipment.body.length, 18);
    const filtered = await request('GET', '/api/equipos?categoria=C%C3%B3mputo', student);
    assert.equal(filtered.body.length, 6);
    const equipmentId = filtered.body[0].id;

    const day = new Date(Date.now() + 400 * 86_400_000).toISOString().slice(0, 10);
    const booking = { equipoId: equipmentId, fecha: day, horaInicio: '10:00', horaFin: '11:00' };
    const created = await request('POST', '/api/reservas', student, booking);
    assert.equal(created.status, 201);
    const bookingId = created.body.id;
    assert.equal(created.body.estado, 'PENDIENTE');
    assert.ok((await request('GET', '/api/mis-reservas', student)).body
      .some((item) => item.id === bookingId && item.estado === 'PENDIENTE'));

    const otherLogin = await request('POST', '/api/auth/login', '',
      { codigo: 'QA002', password: 'Prueba123!' });
    assert.equal(otherLogin.status, 200);
    const other = otherLogin.cookie;
    const competing = await request('POST', '/api/reservas', other, booking);
    assert.equal(competing.status, 201);

    const simultaneousDay = new Date(Date.now() + 401 * 86_400_000).toISOString().slice(0, 10);
    const simultaneous = await Promise.all([equipmentId, filtered.body[1].id].map((equipoId) =>
      request('POST', '/api/reservas', student,
        { equipoId, fecha: simultaneousDay, horaInicio: '10:00', horaFin: '11:00' })));
    assert.deepEqual(simultaneous.map((result) => result.status).sort((a, b) => a - b), [201, 409]);
    assert.match(simultaneous.find((result) => result.status === 409).body.mensaje, /solicitud pendiente/i);

    const adminLogin = await request('POST', '/api/auth/login', '',
      { codigo: 'ADM001', password: 'Admin123!' });
    assert.equal(adminLogin.status, 200);
    const admin = adminLogin.cookie;
    assert.ok((await request('GET', '/api/admin/reservas', admin)).body
      .some((item) => item.id === bookingId));
    assert.equal((await request('PATCH', `/api/admin/reservas/${bookingId}/aprobar`, admin)).status, 200);
    assert.ok((await request('GET', '/api/mis-reservas', student)).body
      .some((item) => item.id === bookingId && item.estado === 'APROBADA'));
    assert.equal((await request('PATCH', `/api/admin/reservas/${competing.body.id}/aprobar`, admin)).status, 409);
    assert.equal((await request('GET', '/api/equipos', student)).body
      .find((item) => item.id === equipmentId).estado, 'Disponible');

    // En esta base temporal, avanzar el horario acordado simula el paso del tiempo.
    const start = new Date(Date.now() - 120 * 60_000).toISOString().slice(0, 19) + 'Z';
    const end = new Date(Date.now() - 60 * 60_000).toISOString().slice(0, 19) + 'Z';
    db.prepare('UPDATE reservas SET inicio = ?, fin = ? WHERE id = ?').run(start, end, bookingId);
    assert.equal((await request('GET', '/api/equipos', student)).body
      .find((item) => item.id === equipmentId).estado, 'Prestado');
    assert.ok((await request('GET', '/api/admin/reservas/activas', admin)).body
      .some((item) => item.id === bookingId));
    const returned = await request('PATCH', `/api/admin/reservas/${bookingId}/devolver`, admin);
    assert.equal(returned.status, 200);
    assert.equal(returned.body.retraso, true);
    assert.equal(returned.body.penalizacionAplicada, true);
    assert.equal((await request('GET', '/api/equipos', student)).body
      .find((item) => item.id === equipmentId).estado, 'Disponible');
    assert.equal((await request('GET', '/api/auth/me', student)).body.usuario.estadoEstudiante, 'PENALIZADO');
    assert.ok((await request('GET', '/api/mis-reservas', student)).body
      .some((item) => item.id === bookingId && item.estado === 'DEVUELTA'));
    assert.equal(db.prepare('SELECT estado, retraso FROM reservas WHERE id = ?').get(bookingId).retraso, 1);

    const reason = 'Equipo solicitado en otro horario';
    assert.equal((await request('PATCH', `/api/admin/reservas/${competing.body.id}/rechazar`, admin,
      { motivo: reason })).status, 200);
    assert.equal(db.prepare('SELECT motivo_rechazo FROM reservas WHERE id = ?').get(competing.body.id).motivo_rechazo, reason);
    // CP-030: reloj controlado por el proceso, estudiante real y devolución HTTP exacta.
    const exactStudent = Number(db.prepare(`
      INSERT INTO usuarios (nombre, email, codigo, password_hash, rol)
      VALUES ('Estudiante CP-030', 'cp030@labtrack.test', '20261001', ?, 'ESTUDIANTE')
    `).run(hashPassword('Estudiante123')).lastInsertRowid);
    const exactEnd = new Date(Date.now() + 60 * 60_000).toISOString().slice(0, 19) + 'Z';
    const exactStart = new Date(Date.now() - 60 * 60_000).toISOString().slice(0, 19) + 'Z';
    const exactEquipmentId = filtered.body[2].id;
    const exactId = Number(db.prepare(`
      INSERT INTO reservas (usuario_id, equipo_id, inicio, fin, estado)
      VALUES (?, ?, ?, ?, 'APROBADA')
    `).run(exactStudent, exactEquipmentId, exactStart, exactEnd).lastInsertRowid);
    assert.equal((await request('GET', '/api/equipos', student)).body
      .find((item) => item.id === exactEquipmentId).estado, 'Prestado');
    app.locals.returnClock = () => new Date(exactEnd);
    let exactReturn;
    try {
      exactReturn = await request('PATCH', `/api/admin/reservas/${exactId}/devolver`, admin);
    } finally {
      delete app.locals.returnClock;
    }
    assert.equal(exactReturn.status, 200);
    assert.equal(exactReturn.body.devueltaEn, new Date(exactEnd).toISOString());
    assert.equal(exactReturn.body.retraso, false);
    assert.equal(exactReturn.body.penalizacionAplicada, false);
    const exactStored = db.prepare('SELECT estado, retraso FROM reservas WHERE id = ?').get(exactId);
    assert.equal(exactStored.estado, 'DEVUELTA');
    assert.equal(exactStored.retraso, 0);
    assert.equal(db.prepare('SELECT estado_estudiante FROM usuarios WHERE id = ?')
      .get(exactStudent).estado_estudiante, 'REGULAR');
    assert.equal((await request('GET', '/api/equipos', student)).body
      .find((item) => item.id === exactEquipmentId).estado, 'Disponible');
    assert.equal((await request('GET', '/api/admin/reservas', student)).status, 403);
    assert.equal((await request('GET', '/api/admin/reservas')).status, 401);
    assert.equal((await request('PATCH', `/api/admin/reservas/${bookingId}/devolver`, student)).status, 403);
    assert.equal((await request('POST', '/api/auth/logout', student)).status, 204);
    assert.equal((await request('GET', '/api/auth/me', student)).status, 401);
    assert.equal(db.prepare('PRAGMA foreign_key_check').all().length, 0);
    console.log('Flujo HTTP completo aprobado; base temporal íntegra; estudiante QA:', secondStudentId);
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    db.close();
    rmSync(tempDirectory, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
