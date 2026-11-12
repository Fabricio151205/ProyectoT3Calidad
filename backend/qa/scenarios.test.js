const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');
const { studentPassword, adminPassword } = require('./testCredentials');

const directory = mkdtempSync(path.join(tmpdir(), 'labtrack-scenario-test-'));
process.env.DB_PATH = path.join(directory, 'qa.sqlite');
const { db, hashPassword } = require('../db');
const app = require('../server');
const { populateScenario } = require('./scenarios');
const ids = populateScenario(db, hashPassword, 'empty-category');

test('argumentos de escenario desconocidos no crean directorios', () => {
  const isolatedTemp = path.join(directory, 'cli-temp');
  mkdirSync(isolatedTemp);
  const absoluteArgument = path.join(directory, 'ruta-absoluta');
  const before = readdirSync(directory).sort();
  for (const scenario of ['desconocido', '../escape', '..\\escape', absoluteArgument,
    'active-loans/otro', 'empty-category\\otro']) {
    const result = spawnSync(process.execPath, [path.join(__dirname, 'scenarios.js'), scenario], {
      env: { ...process.env, TEMP: isolatedTemp, TMP: isolatedTemp, TMPDIR: isolatedTemp },
      encoding: 'utf8',
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Uso: node qa\/scenarios\.js/);
  }
  assert.deepEqual(readdirSync(isolatedTemp), []);
  assert.deepEqual(readdirSync(directory).sort(), before);
  assert.equal(existsSync(absoluteArgument), false);
});

test('escenario válido sin credenciales rechaza el inicio sin crear directorios ni revelar secretos', () => {
  const isolatedTemp = path.join(directory, 'cli-no-credentials');
  mkdirSync(isolatedTemp);
  const result = spawnSync(process.execPath, [path.join(__dirname, 'scenarios.js'), 'active-loans'], {
    env: { ...process.env, TEMP: isolatedTemp, TMP: isolatedTemp, TMPDIR: isolatedTemp,
      SEED_STUDENT_PASSWORD: '', SEED_ADMIN_PASSWORD: '' },
    encoding: 'utf8',
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Configura SEED_STUDENT_PASSWORD y SEED_ADMIN_PASSWORD/);
  assert.deepEqual(readdirSync(isolatedTemp), []);
  assert.ok(!`${result.stdout}${result.stderr}`.includes(studentPassword));
  assert.ok(!`${result.stdout}${result.stderr}`.includes(adminPassword));
});

function launchScenario(scenario, isolatedTemp) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(__dirname, 'scenarios.js'), scenario], {
      env: { ...process.env, TEMP: isolatedTemp, TMP: isolatedTemp, TMPDIR: isolatedTemp, QA_PORT: '0' },
    });
    let output = '';
    let errors = '';
    let details;
    const timeout = setTimeout(() => child.kill(), 15_000);
    child.stdout.on('data', (chunk) => {
      output += chunk;
      try {
        details = JSON.parse(output);
        child.kill();
      } catch (error) {
        if (!(error instanceof SyntaxError)) reject(error);
      }
    });
    child.stderr.on('data', (chunk) => { errors += chunk; });
    child.on('error', reject);
    child.on('close', () => {
      clearTimeout(timeout);
      if (details) resolve(details);
      else reject(new Error(`El escenario no inició: ${errors || output}`));
    });
  });
}

test('argumentos válidos crean solo su SQLite temporal y conservan ambos escenarios', async () => {
  for (const scenario of ['active-loans', 'empty-category']) {
    const isolatedTemp = path.join(directory, `cli-${scenario}`);
    mkdirSync(isolatedTemp);
    const details = await launchScenario(scenario, isolatedTemp);
    assert.equal(details.scenario, scenario);
    assert.ok(!JSON.stringify(details).includes(studentPassword));
    assert.ok(!JSON.stringify(details).includes(adminPassword));
    const qaDirectory = path.dirname(details.databasePath);
    const relative = path.relative(isolatedTemp, qaDirectory);
    assert.ok(relative.startsWith(`labtrack-qa-${scenario}-`));
    assert.equal(path.dirname(relative), '.');
    assert.deepEqual(readdirSync(isolatedTemp), [relative]);
    const qaDb = new DatabaseSync(details.databasePath, { readOnly: true });
    try {
      assert.equal(qaDb.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
      assert.equal(qaDb.prepare("SELECT count(*) AS total FROM reservas WHERE estado = 'APROBADA'").get().total, 3);
      assert.equal(qaDb.prepare("SELECT count(*) AS total FROM equipos WHERE categoria = 'Redes'").get().total,
        scenario === 'empty-category' ? 0 : 6);
    } finally {
      qaDb.close();
    }
  }
});

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
    { codigo: '20261001', password: studentPassword });
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
    { codigo: 'ADM001', password: adminPassword });
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
