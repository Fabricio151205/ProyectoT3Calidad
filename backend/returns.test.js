const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');

const testDirectory = mkdtempSync(path.join(tmpdir(), 'labtrack-returns-test-'));
process.env.DB_PATH = path.join(testDirectory, 'test.sqlite');
const { db } = require('./db');
const app = require('./server');

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
const studentId = db.prepare("SELECT id FROM usuarios WHERE codigo = '20240001'").get().id;
const equipment = db.prepare('SELECT id FROM equipos ORDER BY id').all();

function at(minutes) {
  return new Date(Date.now() + minutes * 60_000).toISOString().slice(0, 19) + 'Z';
}

function reservation(status, equipmentId = equipment[0].id, start = -120, end = 60) {
  return Number(db.prepare(`
    INSERT INTO reservas (usuario_id, equipo_id, inicio, fin, estado, motivo_rechazo)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(studentId, equipmentId, at(start), at(end), status,
    status === 'RECHAZADA' ? 'Equipo en mantenimiento' : null).lastInsertRowid);
}

function markReturned(id, cookie = adminCookie, body = {}) {
  return request('PATCH', '/api/admin/reservas/:id/devolver', body, cookie, { id: String(id) });
}

function active(cookie = adminCookie) {
  return request('GET', '/api/admin/reservas/activas', {}, cookie);
}

test('lista solo aprobadas sin devolución con datos de estudiante, equipo y horario', () => {
  const approved = reservation('APROBADA');
  const pending = reservation('PENDIENTE', equipment[1].id);
  const rejected = reservation('RECHAZADA', equipment[2].id);
  const result = active();
  assert.equal(result.status, 200);
  const row = result.body.find((item) => item.id === approved);
  assert.equal(row.estudianteNombre, 'Estudiante de prueba');
  assert.equal(row.estudianteCodigo, '20240001');
  assert.equal(row.equipoCodigo, 'COMP-001');
  assert.equal(row.estado, 'APROBADA');
  assert.ok(row.fecha && row.horaInicio && row.horaFin);
  assert.ok(result.body.every((item) => item.id !== pending && item.id !== rejected));
  assert.equal(markReturned(approved).status, 200);
  assert.ok(!active().body.some((item) => item.id === approved));
});

test('devolución puntual conserva estado del estudiante y el historial', () => {
  const id = reservation('APROBADA');
  const before = db.prepare('SELECT estado_estudiante FROM usuarios WHERE id = ?').get(studentId).estado_estudiante;
  const result = markReturned(id);
  assert.equal(result.status, 200);
  assert.equal(result.body.estado, 'DEVUELTA');
  assert.equal(result.body.retraso, false);
  assert.equal(result.body.penalizacionAplicada, false);
  assert.equal(db.prepare('SELECT estado_estudiante FROM usuarios WHERE id = ?').get(studentId).estado_estudiante, before);
  const row = db.prepare('SELECT estado, devuelta_en, retraso FROM reservas WHERE id = ?').get(id);
  assert.equal(row.estado, 'DEVUELTA');
  assert.ok(row.devuelta_en);
  assert.equal(row.retraso, 0);
  assert.ok(request('GET', '/api/mis-reservas', {}, studentCookie).body.some((item) => item.id === id && item.estado === 'DEVUELTA'));
});

test('devolución tardía penaliza y libera inmediatamente equipo vencido', () => {
  const id = reservation('APROBADA', equipment[0].id, -180, -60);
  const catalog = () => request('GET', '/api/equipos', {}, studentCookie).body.find((item) => item.id === equipment[0].id);
  assert.equal(catalog().estado, 'Prestado');
  const result = markReturned(id);
  assert.equal(result.status, 200);
  assert.equal(result.body.retraso, true);
  assert.equal(result.body.penalizacionAplicada, true);
  assert.equal(db.prepare('SELECT retraso FROM reservas WHERE id = ?').get(id).retraso, 1);
  assert.equal(db.prepare('SELECT estado_estudiante FROM usuarios WHERE id = ?').get(studentId).estado_estudiante, 'PENALIZADO');
  assert.equal(catalog().estado, 'Disponible');
  assert.equal(db.prepare('SELECT estado FROM equipos WHERE id = ?').get(equipment[0].id).estado, 'DISPONIBLE');
});

test('devolución puntual mantiene PENALIZADO si el estudiante ya lo estaba', () => {
  const id = reservation('APROBADA');
  const result = markReturned(id);
  assert.equal(result.status, 200);
  assert.equal(result.body.retraso, false);
  assert.equal(result.body.penalizacionAplicada, false);
  assert.equal(db.prepare('SELECT estado_estudiante FROM usuarios WHERE id = ?').get(studentId).estado_estudiante, 'PENALIZADO');
});

test('no permite una segunda devolución', () => {
  const id = reservation('APROBADA');
  assert.equal(markReturned(id).status, 200);
  assert.equal(markReturned(id).status, 409);
  assert.equal(db.prepare('SELECT count(*) AS total FROM reservas WHERE id = ?').get(id).total, 1);
});

test('rechaza devolución de solicitud pendiente o rechazada', () => {
  const pending = reservation('PENDIENTE', equipment[1].id);
  const rejected = reservation('RECHAZADA', equipment[2].id);
  assert.equal(markReturned(pending).status, 409);
  assert.equal(markReturned(rejected).status, 409);
  assert.equal(markReturned(999999).status, 404);
  assert.equal(db.prepare('SELECT devuelta_en FROM reservas WHERE id = ?').get(pending).devuelta_en, null);
});

test('deniega consulta y devolución a estudiantes y usuarios sin sesión', () => {
  const id = reservation('APROBADA', equipment[1].id);
  assert.equal(active('').status, 401);
  assert.equal(active(studentCookie).status, 403);
  assert.equal(markReturned(id, '').status, 401);
  assert.equal(markReturned(id, studentCookie).status, 403);
  assert.equal(db.prepare('SELECT estado FROM reservas WHERE id = ?').get(id).estado, 'APROBADA');
});

test('ignora fecha enviada por React y usa el reloj del servidor', () => {
  const id = reservation('APROBADA', equipment[0].id, -300, -180);
  const before = Date.now() - 1000;
  const result = markReturned(id, adminCookie, { devueltaEn: '2020-01-01T00:00:00Z' });
  const after = Date.now() + 1000;
  assert.equal(result.status, 200);
  assert.equal(result.body.retraso, true);
  const persisted = db.prepare('SELECT devuelta_en FROM reservas WHERE id = ?').get(id).devuelta_en;
  assert.ok(Date.parse(persisted) >= before && Date.parse(persisted) <= after);
  assert.notEqual(persisted, '2020-01-01T00:00:00Z');
});

test('aprobada futura no figura como préstamo activo ni se puede devolver', () => {
  const id = reservation('APROBADA', equipment[2].id, 120, 180);
  assert.ok(!active().body.some((item) => item.id === id));
  assert.equal(markReturned(id).status, 409);
  const item = request('GET', '/api/equipos', {}, studentCookie).body.find((row) => row.id === equipment[2].id);
  assert.equal(item.estado, 'Disponible');
  assert.equal(db.prepare('SELECT estado FROM reservas WHERE id = ?').get(id).estado, 'APROBADA');
});

test('un milisegundo después del fin acordado cuenta como retraso', () => {
  const end = at(-350);
  const id = Number(db.prepare(`
    INSERT INTO reservas (usuario_id, equipo_id, inicio, fin, estado)
    VALUES (?, ?, ?, ?, 'APROBADA')
  `).run(studentId, equipment[0].id, at(-400), end).lastInsertRowid);
  const returnedAt = new Date(Date.parse(end) + 1).toISOString();
  db.prepare("UPDATE reservas SET estado = 'DEVUELTA', devuelta_en = ? WHERE id = ?")
    .run(returnedAt, id);
  assert.equal(db.prepare('SELECT retraso FROM reservas WHERE id = ?').get(id).retraso, 1);
});

test.after(() => {
  db.close();
  rmSync(testDirectory, { recursive: true, force: true });
});
