const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');

const testDirectory = mkdtempSync(path.join(tmpdir(), 'labtrack-admin-test-'));
process.env.DB_PATH = path.join(testDirectory, 'test.sqlite');
const { db, hashPassword } = require('./db');
const app = require('./server');

const studentId = db.prepare("SELECT id FROM usuarios WHERE codigo = '20240001'").get().id;
const otherId = db.prepare(`
  INSERT INTO usuarios (nombre, email, codigo, password_hash, rol)
  VALUES ('Otra estudiante', 'otra@labtrack.test', '20240002', ?, 'ESTUDIANTE')
`).run(hashPassword('Otra123!')).lastInsertRowid;
const equipment = db.prepare('SELECT id, codigo FROM equipos ORDER BY id').all();

function request(method, pathname, body = {}, cookie = '', params = {}) {
  const route = app.router.stack.find((layer) => layer.route?.path === pathname && layer.route.methods[method.toLowerCase()]);
  assert.ok(route, `Falta ${method} ${pathname}`);
  const req = { body, params, query: {}, headers: { cookie } };
  const result = { status: 200, body: null, cookie: '' };
  const res = {
    status(code) { result.status = code; return this; },
    json(data) { result.body = data; return this; },
    cookie(name, value) { result.cookie = `${name}=${value}`; return this; },
  };
  let index = 0;
  function next() {
    const handler = route.route.stack[index++]?.handle;
    if (handler) handler(req, res, next);
  }
  next();
  return result;
}

function login(codigo, password) {
  return request('POST', '/api/auth/login', { codigo, password }).cookie;
}

const adminCookie = login('ADM001', 'Admin123!');
const studentCookie = login('20240001', 'Estudiante123!');

function date(days) {
  return new Date(Date.now() + (400 + days) * 86_400_000).toISOString().slice(0, 10);
}

function utc(day, hour) {
  return new Date(`${day}T${hour}:00-05:00`).toISOString().slice(0, 19) + 'Z';
}

function pending(userId, equipmentId, day, start = '10:00', end = '11:00') {
  return Number(db.prepare('INSERT INTO reservas (usuario_id, equipo_id, inicio, fin) VALUES (?, ?, ?, ?)')
    .run(userId, equipmentId, utc(day, start), utc(day, end)).lastInsertRowid);
}

function approve(id, cookie = adminCookie) {
  return request('PATCH', '/api/admin/reservas/:id/aprobar', {}, cookie, { id: String(id) });
}

function reject(id, motivo, cookie = adminCookie) {
  return request('PATCH', '/api/admin/reservas/:id/rechazar', { motivo }, cookie, { id: String(id) });
}

test('solo administrador puede consultar y decidir solicitudes', () => {
  const id = pending(studentId, equipment[0].id, date(1));
  assert.equal(request('GET', '/api/admin/reservas').status, 401);
  assert.equal(request('GET', '/api/admin/reservas', {}, studentCookie).status, 403);
  assert.equal(approve(id, '').status, 401);
  assert.equal(approve(id, studentCookie).status, 403);
  assert.equal(reject(id, 'No disponible', studentCookie).status, 403);
  assert.equal(db.prepare('SELECT estado FROM reservas WHERE id = ?').get(id).estado, 'PENDIENTE');
});

test('lista pendiente incluye datos del estudiante, equipo y horario de Lima', () => {
  const day = date(2);
  const id = pending(studentId, equipment[0].id, day, '09:00', '10:00');
  const result = request('GET', '/api/admin/reservas', {}, adminCookie);
  assert.equal(result.status, 200);
  const row = result.body.find((item) => item.id === id);
  assert.deepEqual({ ...row }, {
    id, estudianteNombre: 'Estudiante de prueba', estudianteCodigo: '20240001',
    equipoNombre: 'Laptop Dell Latitude', equipoCodigo: 'COMP-001',
    fecha: day, horaInicio: '09:00', horaFin: '10:00', estado: 'PENDIENTE',
  });
  assert.ok(result.body.every((item) => item.estado === 'PENDIENTE'));
});

test('aprueba pendiente y la elimina del listado; no permite decidirla otra vez', () => {
  const id = pending(studentId, equipment[0].id, date(3));
  const result = approve(id);
  assert.equal(result.status, 200);
  assert.equal(result.body.estado, 'APROBADA');
  const stored = db.prepare('SELECT estado, aprobada_en FROM reservas WHERE id = ?').get(id);
  assert.equal(stored.estado, 'APROBADA');
  assert.ok(stored.aprobada_en);
  assert.ok(!request('GET', '/api/admin/reservas', {}, adminCookie).body.some((item) => item.id === id));
  assert.equal(approve(id).status, 409);
  assert.equal(reject(id, 'Tarde').status, 409);
});

test('rechaza solicitudes incompatibles del mismo equipo con HTTP 409', () => {
  const day = date(4);
  const first = pending(studentId, equipment[0].id, day, '10:00', '12:00');
  const second = pending(otherId, equipment[0].id, day, '11:00', '13:00');
  assert.equal(approve(first).status, 200);
  const conflict = approve(second);
  assert.equal(conflict.status, 409);
  assert.match(conflict.body.mensaje, /equipo/i);
  assert.equal(db.prepare('SELECT estado FROM reservas WHERE id = ?').get(second).estado, 'PENDIENTE');
});

test('rechaza segunda reserva aprobada simultánea del estudiante', () => {
  const day = date(5);
  const first = pending(studentId, equipment[0].id, day, '10:00', '12:00');
  const second = pending(studentId, equipment[1].id, day, '11:00', '13:00');
  assert.equal(approve(first).status, 200);
  const conflict = approve(second);
  assert.equal(conflict.status, 409);
  assert.match(conflict.body.mensaje, /estudiante/i);
});

test('permite aprobaciones consecutivas sin cruce', () => {
  const day = date(6);
  const first = pending(studentId, equipment[0].id, day, '10:00', '12:00');
  const second = pending(studentId, equipment[0].id, day, '12:00', '13:00');
  assert.equal(approve(first).status, 200);
  assert.equal(approve(second).status, 200);
});

test('rechazo exige motivo, lo recorta y modifica solo la solicitud elegida', () => {
  const day = date(7);
  const first = pending(studentId, equipment[0].id, day);
  const second = pending(otherId, equipment[1].id, day);
  assert.equal(reject(first, '').status, 400);
  assert.equal(reject(first, '   ').status, 400);
  assert.equal(reject(first, null).status, 400);
  assert.equal(reject(first, '  Equipo en mantenimiento  ').status, 200);
  assert.deepEqual({ ...db.prepare('SELECT estado, motivo_rechazo FROM reservas WHERE id = ?').get(first) },
    { estado: 'RECHAZADA', motivo_rechazo: 'Equipo en mantenimiento' });
  assert.equal(db.prepare('SELECT estado FROM reservas WHERE id = ?').get(second).estado, 'PENDIENTE');
  assert.equal(reject(first, 'Otro motivo').status, 409);
  assert.equal(approve(first).status, 409);
});

test('ID inexistente o inválido devuelve error sin cambios', () => {
  assert.equal(approve(999999).status, 404);
  assert.equal(reject(999999, 'Motivo').status, 404);
  assert.equal(approve('x').status, 400);
});

test('aprobar una reserva vigente refleja Prestado en el catálogo horario', () => {
  const start = new Date(Date.now() - 3_600_000).toISOString().slice(0, 19) + 'Z';
  const end = new Date(Date.now() + 3_600_000).toISOString().slice(0, 19) + 'Z';
  const id = Number(db.prepare('INSERT INTO reservas (usuario_id, equipo_id, inicio, fin) VALUES (?, ?, ?, ?)')
    .run(otherId, equipment[2].id, start, end).lastInsertRowid);
  assert.equal(approve(id).status, 200);
  const item = request('GET', '/api/equipos', {}, studentCookie).body.find((row) => row.id === equipment[2].id);
  assert.equal(item.estado, 'Prestado');
  assert.equal(db.prepare('SELECT estado FROM equipos WHERE id = ?').get(equipment[2].id).estado, 'DISPONIBLE');
});

test.after(() => {
  db.close();
  rmSync(testDirectory, { recursive: true, force: true });
});
