const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');

const directory = mkdtempSync(path.join(tmpdir(), 'labtrack-scenario-test-'));
process.env.DB_PATH = path.join(directory, 'qa.sqlite');
const { db, hashPassword } = require('../db');
const app = require('../server');
const { populateScenario } = require('./scenarios');
const ids = populateScenario(db, hashPassword, 'empty-category');

function request(method, pathname, body = {}, cookie = '', query = {}) {
  const route = app.router.stack.find((layer) => layer.route?.path === pathname && layer.route.methods[method.toLowerCase()]);
  assert.ok(route);
  const req = { app, body, query, headers: { cookie } };
  const result = { status: 200, body: null, cookie: '' };
  const res = {
    status(code) { result.status = code; return this; },
    json(data) { result.body = data; return this; },
    cookie(name, value) { result.cookie = `${name}=${value}`; return this; },
  };
  let index = 0;
  function next() { route.route.stack[index++]?.handle(req, res, next); }
  next();
  return result;
}

test('[HU-02][CP-012] escenario QA conserva otras categorías y deja Redes vacía', () => {
  const login = request('POST', '/api/auth/login',
    { codigo: '20261001', password: 'Estudiante123' });
  assert.equal(login.status, 200);
  const cookie = login.cookie;
  assert.deepEqual(request('GET', '/api/equipos', {}, cookie, { categoria: 'Redes' }).body, []);
  for (const categoria of ['Cómputo', 'Electrónica']) {
    const response = request('GET', '/api/equipos', {}, cookie, { categoria });
    assert.equal(response.status, 200);
    assert.ok(response.body.length > 0);
    assert.ok(response.body.every((item) => item.categoria === categoria));
  }
});

test('[HU-05][CP-025] escenario QA expone préstamo activo y excluye la aprobación futura', () => {
  const login = request('POST', '/api/auth/login',
    { codigo: 'ADM001', password: 'Admin123!' });
  assert.equal(login.status, 200);
  const response = request('GET', '/api/admin/reservas/activas', {}, login.cookie);
  assert.equal(response.status, 200);
  const active = response.body.find((item) => item.id === ids.activeId);
  assert.equal(active.estudianteNombre, 'Juan Pérez');
  assert.equal(active.estudianteCodigo, '20261001');
  assert.equal(active.equipoNombre, 'Laptop HP-001');
  assert.equal(active.equipoCodigo, 'HP-001');
  assert.equal(active.estado, 'APROBADA');
  assert.ok(!response.body.some((item) => item.id === ids.futureId));
  assert.ok(!response.body.some((item) => item.id === ids.pendingId || item.id === ids.rejectedId));
});

after(() => {
  db.close();
  rmSync(directory, { recursive: true, force: true });
});
