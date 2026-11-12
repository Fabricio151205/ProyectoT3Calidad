const { test } = require('node:test');
const assert = require('node:assert/strict');
const { existsSync, mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');

const testDirectory = mkdtempSync(path.join(tmpdir(), 'labtrack-test-'));
process.env.DB_PATH = path.join(testDirectory, 'test.sqlite');

const { db, hashPassword } = require('./db');
const app = require('./server');

test('[HU-02][CP-007, CP-008] la ruta Express consulta los equipos guardados en SQLite', () => {
  const sesion = request('POST', '/api/auth/login', { codigo: '20240001', password: 'Estudiante123!' }).cookie;
  const equipos = request('GET', '/api/equipos', {}, sesion).body;
  assert.equal(equipos.length, 18);
  assert.deepEqual(new Set(equipos.map((equipo) => equipo.categoria)),
    new Set(['Cómputo', 'Electrónica', 'Redes']));
  assert.ok(equipos.every((equipo) => Object.keys(equipo).sort().join() === 'categoria,codigo,descripcion,estado,id,imagen_url,nombre'));
  assert.ok(equipos.every((equipo) => equipo.descripcion.length > 25 &&
    equipo.descripcion !== `Equipo de ${equipo.categoria}`));
  assert.ok(equipos.every((equipo) => /^\/equipos\/[a-z0-9-]+\.jpg$/.test(equipo.imagen_url) &&
    existsSync(path.join(__dirname, '..', 'frontend', 'public', equipo.imagen_url.slice(1)))));
  assert.ok(['Cómputo', 'Electrónica', 'Redes'].every((categoria) =>
    equipos.filter((equipo) => equipo.categoria === categoria).length === 6));
  assert.equal(request('GET', '/api/health').body.estado, 'OK');
});

test('[HU-02][Mejora] descripción genérica histórica se presenta con detalle sin cambiar el registro', () => {
  const codigo = 'COMP-002';
  const original = db.prepare('SELECT descripcion FROM equipos WHERE codigo = ?').get(codigo).descripcion;
  const generic = 'Equipo de Cómputo';
  db.prepare('UPDATE equipos SET descripcion = ? WHERE codigo = ?').run(generic, codigo);
  try {
    const equipo = request('GET', '/api/equipos', {}, studentCookie()).body
      .find((item) => item.codigo === codigo);
    assert.notEqual(equipo.descripcion, generic);
    assert.equal(db.prepare('SELECT descripcion FROM equipos WHERE codigo = ?').get(codigo).descripcion, generic);
    db.prepare('UPDATE equipos SET descripcion = ? WHERE codigo = ?').run('Descripción propia', codigo);
    const personalizado = request('GET', '/api/equipos', {}, studentCookie()).body
      .find((item) => item.codigo === codigo);
    assert.equal(personalizado.descripcion, 'Descripción propia');
  } finally {
    db.prepare('UPDATE equipos SET descripcion = ? WHERE codigo = ?').run(original, codigo);
  }
});

test('usuarios de prueba tienen roles y contraseñas cifradas', () => {
  const usuarios = db.prepare('SELECT email, rol, password_hash FROM usuarios ORDER BY email').all();
  assert.equal(usuarios.length, 2);
  assert.deepEqual(new Set(usuarios.map((usuario) => usuario.rol)),
    new Set(['ESTUDIANTE', 'ADMINISTRADOR']));
  assert.ok(usuarios.every((usuario) => /^scrypt:[0-9a-f]{32}:[0-9a-f]{128}$/.test(usuario.password_hash)));
});

test('[HU-03][Adicional] reservas aprobadas respetan claves foráneas y no permiten cruces de equipo o estudiante', () => {
  const usuario = db.prepare('SELECT id FROM usuarios LIMIT 1').get();
  const otroUsuario = db.prepare('SELECT id FROM usuarios WHERE id != ? LIMIT 1').get(usuario.id);
  const equipo = db.prepare('SELECT id FROM equipos LIMIT 1').get();
  const otroEquipo = db.prepare('SELECT id FROM equipos WHERE id != ? LIMIT 1').get(equipo.id);
  const insert = db.prepare('INSERT INTO reservas (usuario_id, equipo_id, inicio, fin, estado) VALUES (?, ?, ?, ?, ?)');
  insert.run(usuario.id, equipo.id, '2027-01-01T10:00:00Z', '2027-01-01T11:00:00Z', 'APROBADA');
  const pendiente = insert.run(otroUsuario.id, equipo.id, '2027-01-01T10:30:00Z', '2027-01-01T11:30:00Z', 'PENDIENTE');
  assert.throws(() => db.prepare("UPDATE reservas SET estado = 'APROBADA' WHERE id = ?").run(pendiente.lastInsertRowid));
  assert.throws(() => insert.run(otroUsuario.id, equipo.id, '2027-01-01T10:30:00Z', '2027-01-01T11:30:00Z', 'APROBADA'));
  assert.throws(() => insert.run(usuario.id, otroEquipo.id, '2027-01-01T10:30:00Z', '2027-01-01T11:30:00Z', 'APROBADA'));
  assert.throws(() => insert.run(-1, equipo.id, '2027-01-02T10:00:00Z', '2027-01-02T11:00:00Z', 'PENDIENTE'));
  assert.throws(() => insert.run(usuario.id, equipo.id, '2027-01-03T11:00:00Z', '2027-01-03T10:00:00Z', 'PENDIENTE'));
  assert.throws(() => db.prepare("INSERT INTO reservas (usuario_id, equipo_id, inicio, fin, estado) VALUES (?, ?, ?, ?, 'RECHAZADA')")
    .run(usuario.id, equipo.id, '2027-01-04T10:00:00Z', '2027-01-04T11:00:00Z'));
});

function request(method, pathname, body = {}, cookie = '', query = {}) {
  const route = app.router.stack.find((layer) => layer.route?.path === pathname && layer.route.methods[method.toLowerCase()]);
  assert.ok(route, `Falta ${method} ${pathname}`);
  const req = { body, query, headers: { cookie } };
  const result = { status: 200, body: null, cookie: '' };
  const res = {
    status(code) { result.status = code; return this; },
    json(data) { result.body = data; return this; },
    cookie(name, value) { result.cookie = `${name}=${value}`; return this; },
    clearCookie() { return this; },
    end() { return this; },
  };
  let index = 0;
  function next() {
    const handler = route.route.stack[index++]?.handle;
    if (handler) handler(req, res, next);
  }
  next();
  return result;
}

function studentCookie() {
  return request('POST', '/api/auth/login', { codigo: '20240001', password: 'Estudiante123!' }).cookie;
}

function futureDate(extraDays = 0) {
  return new Date(Date.now() + (365 + extraDays) * 86_400_000).toISOString().slice(0, 10);
}

function utc(date, time) {
  return new Date(`${date}T${time}:00-05:00`).toISOString().slice(0, 19) + 'Z';
}

function reservationRequest(equipoId, fecha, horaInicio = '10:00', horaFin = '11:00', cookie = studentCookie()) {
  return request('POST', '/api/reservas', { equipoId, fecha, horaInicio, horaFin }, cookie);
}

test('[HU-03][CP-014] reserva válida queda pendiente, pertenece a la sesión y no presta el equipo', () => {
  const student = db.prepare("SELECT id FROM usuarios WHERE codigo = '20240001'").get();
  const admin = db.prepare("SELECT id FROM usuarios WHERE codigo = 'ADM001'").get();
  const equipment = db.prepare("SELECT id FROM equipos WHERE codigo = 'COMP-001'").get();
  const response = request('POST', '/api/reservas', {
    equipoId: equipment.id, fecha: futureDate(1), horaInicio: '10:00', horaFin: '11:00',
    usuarioId: admin.id,
  }, studentCookie());
  assert.equal(response.status, 201);
  assert.equal(response.body.estado, 'PENDIENTE');
  const stored = db.prepare('SELECT usuario_id, equipo_id, estado FROM reservas WHERE id = ?').get(response.body.id);
  assert.equal(stored.usuario_id, student.id);
  assert.equal(stored.equipo_id, equipment.id);
  assert.equal(stored.estado, 'PENDIENTE');
  assert.equal(db.prepare('SELECT estado FROM equipos WHERE id = ?').get(equipment.id).estado, 'DISPONIBLE');
  assert.equal(request('GET', '/api/equipos', {}, studentCookie()).body.find((item) => item.id === equipment.id).estado, 'Disponible');
});

test('[HU-03][Adicional] rechaza equipo inexistente y no disponible', () => {
  assert.equal(reservationRequest(999999, futureDate(2)).status, 404);
  const equipment = db.prepare("SELECT id FROM equipos WHERE codigo = 'ELEC-001'").get();
  db.prepare("UPDATE equipos SET estado = 'MANTENIMIENTO' WHERE id = ?").run(equipment.id);
  try {
    assert.equal(reservationRequest(equipment.id, futureDate(2)).status, 409);
  } finally {
    db.prepare("UPDATE equipos SET estado = 'DISPONIBLE' WHERE id = ?").run(equipment.id);
  }
});

test('[HU-03][Adicional] rechaza fecha pasada, fecha inexistente y fin no posterior al inicio', () => {
  const equipment = db.prepare('SELECT id FROM equipos LIMIT 1').get();
  assert.equal(reservationRequest(equipment.id, '2020-01-01').status, 400);
  assert.equal(reservationRequest(equipment.id, '2027-02-30').status, 400);
  assert.equal(reservationRequest(equipment.id, futureDate(3), '11:00', '10:00').status, 400);
  assert.equal(reservationRequest(equipment.id, futureDate(3), '11:00', '11:00').status, 400);
});

test('[HU-03][CP-016] rechaza cruce con reserva aprobada del mismo equipo', () => {
  const equipment = db.prepare("SELECT id FROM equipos WHERE codigo = 'COMP-001'").get();
  const other = db.prepare("SELECT id FROM usuarios WHERE codigo = 'ADM001'").get();
  const date = futureDate(4);
  db.prepare("INSERT INTO reservas (usuario_id, equipo_id, inicio, fin, estado) VALUES (?, ?, ?, ?, 'APROBADA')")
    .run(other.id, equipment.id, utc(date, '10:00'), utc(date, '12:00'));
  const response = reservationRequest(equipment.id, date, '11:00', '13:00');
  assert.equal(response.status, 409);
  assert.match(response.body.mensaje, /equipo.*reserva aprobada/i);
});

test('[HU-03][CP-018] rechaza que el estudiante tenga otro equipo aprobado al mismo tiempo', () => {
  const student = db.prepare("SELECT id FROM usuarios WHERE codigo = '20240001'").get();
  const equipment = db.prepare("SELECT id FROM equipos WHERE codigo = 'COMP-001'").get();
  const another = db.prepare("SELECT id FROM equipos WHERE codigo = 'RED-001'").get();
  const date = futureDate(5);
  db.prepare("INSERT INTO reservas (usuario_id, equipo_id, inicio, fin, estado) VALUES (?, ?, ?, ?, 'APROBADA')")
    .run(student.id, equipment.id, utc(date, '10:00'), utc(date, '12:00'));
  const response = reservationRequest(another.id, date, '11:00', '13:00');
  assert.equal(response.status, 409);
  assert.match(response.body.mensaje, /otro equipo reservado/i);
});

test('[HU-03][CP-018] rechaza otra solicitud pendiente simultánea sin bloquear a otros estudiantes', () => {
  const equipment = db.prepare("SELECT id FROM equipos WHERE codigo = 'COMP-001'").get();
  const another = db.prepare("SELECT id FROM equipos WHERE codigo = 'RED-001'").get();
  const date = futureDate(9);
  const first = reservationRequest(equipment.id, date, '10:00', '12:00');
  assert.equal(first.status, 201);
  const countBefore = db.prepare('SELECT count(*) AS total FROM reservas').get().total;
  const conflict = reservationRequest(another.id, date, '11:00', '13:00');
  assert.equal(conflict.status, 409);
  assert.match(conflict.body.mensaje, /solicitud pendiente/i);
  assert.equal(db.prepare('SELECT count(*) AS total FROM reservas').get().total, countBefore);

  db.prepare(`INSERT INTO usuarios (nombre, email, codigo, password_hash, rol)
    VALUES ('Estudiante adicional', 'adicional@labtrack.test', 'QA-018', ?, 'ESTUDIANTE')`)
    .run(hashPassword('Prueba018!'));
  const otherCookie = request('POST', '/api/auth/login',
    { codigo: 'QA-018', password: 'Prueba018!' }).cookie;
  assert.equal(reservationRequest(equipment.id, date, '11:00', '13:00', otherCookie).status, 201);
});

test('[HU-03][CP-018] reservas rechazadas y devueltas no bloquean el horario', () => {
  const equipment = db.prepare("SELECT id FROM equipos WHERE codigo = 'COMP-001'").get();
  const another = db.prepare("SELECT id FROM equipos WHERE codigo = 'RED-001'").get();
  const date = futureDate(10);
  const first = reservationRequest(equipment.id, date, '10:00', '12:00');
  assert.equal(first.status, 201);
  db.prepare("UPDATE reservas SET estado = 'RECHAZADA', motivo_rechazo = ? WHERE id = ?")
    .run('Equipo en mantenimiento', first.body.id);
  const second = reservationRequest(another.id, date, '11:00', '13:00');
  assert.equal(second.status, 201);
  db.prepare("UPDATE reservas SET estado = 'DEVUELTA', devuelta_en = ? WHERE id = ?")
    .run(utc(date, '13:00'), second.body.id);
  assert.equal(reservationRequest(equipment.id, date, '11:00', '13:00').status, 201);
});

test('[HU-03][CP-017, CP-019] permite horarios posteriores a reservas finalizadas', () => {
  const student = db.prepare("SELECT id FROM usuarios WHERE codigo = '20240001'").get();
  const equipment = db.prepare("SELECT id FROM equipos WHERE codigo = 'COMP-001'").get();
  const date = futureDate(6);
  db.prepare("INSERT INTO reservas (usuario_id, equipo_id, inicio, fin, estado) VALUES (?, ?, ?, ?, 'APROBADA')")
    .run(student.id, equipment.id, utc(date, '10:00'), utc(date, '12:00'));
  assert.equal(reservationRequest(equipment.id, date, '12:00', '13:00').status, 201);
  const anotherEquipment = db.prepare("SELECT id FROM equipos WHERE codigo = 'RED-001'").get();
  assert.equal(reservationRequest(anotherEquipment.id, date, '13:00', '14:00').status, 201);
  assert.equal(reservationRequest(equipment.id, date, '14:00', '15:00').status, 201);
});

test('[HU-03][CP-015] un préstamo vigente bloquea su horario, pero permite uno posterior', () => {
  const equipment = db.prepare("SELECT id FROM equipos WHERE codigo = 'ELEC-002'").get();
  const other = db.prepare(`INSERT INTO usuarios (nombre, email, codigo, password_hash, rol)
    VALUES ('Estudiante CP-015', 'cp015@labtrack.test', 'QA-015', ?, 'ESTUDIANTE')`)
    .run(hashPassword('Prueba015!'));
  const date = futureDate(11);
  const start = new Date(Date.now() - 3_600_000).toISOString().slice(0, 19) + 'Z';
  db.prepare("INSERT INTO reservas (usuario_id, equipo_id, inicio, fin, estado) VALUES (?, ?, ?, ?, 'APROBADA')")
    .run(other.lastInsertRowid, equipment.id, start, utc(date, '12:00'));
  const catalog = request('GET', '/api/equipos', {}, studentCookie()).body;
  assert.equal(catalog.find((item) => item.id === equipment.id).estado, 'Prestado');
  assert.equal(reservationRequest(equipment.id, date, '10:00', '11:00').status, 409);
  assert.equal(reservationRequest(equipment.id, date, '12:00', '13:00').status, 201);
});

test('[HU-03][Adicional] reserva y consulta propia requieren sesión de estudiante', () => {
  const equipment = db.prepare('SELECT id FROM equipos LIMIT 1').get();
  assert.equal(reservationRequest(equipment.id, futureDate(7), '10:00', '11:00', '').status, 401);
  assert.equal(request('GET', '/api/mis-reservas').status, 401);
  const admin = request('POST', '/api/auth/login', { codigo: 'ADM001', password: 'Admin123!' }).cookie;
  assert.equal(reservationRequest(equipment.id, futureDate(7), '10:00', '11:00', admin).status, 403);
});

test('[HU-03][Adicional] mis reservas no muestra solicitudes ajenas', () => {
  const student = db.prepare("SELECT id FROM usuarios WHERE codigo = '20240001'").get();
  const other = db.prepare("SELECT id FROM usuarios WHERE codigo = 'ADM001'").get();
  const equipment = db.prepare('SELECT id FROM equipos LIMIT 1').get();
  const date = futureDate(8);
  const own = db.prepare('INSERT INTO reservas (usuario_id, equipo_id, inicio, fin) VALUES (?, ?, ?, ?)')
    .run(student.id, equipment.id, utc(date, '10:00'), utc(date, '11:00'));
  const alien = db.prepare('INSERT INTO reservas (usuario_id, equipo_id, inicio, fin) VALUES (?, ?, ?, ?)')
    .run(other.id, equipment.id, utc(date, '11:00'), utc(date, '12:00'));
  const response = request('GET', '/api/mis-reservas', {}, studentCookie());
  assert.equal(response.status, 200);
  assert.ok(response.body.some((item) => item.id === Number(own.lastInsertRowid)));
  assert.ok(response.body.every((item) => item.id !== Number(alien.lastInsertRowid)));
});

test('[HU-04][Mejora] mis reservas muestra solo el motivo de rechazos propios', () => {
  const student = db.prepare("SELECT id FROM usuarios WHERE codigo = '20240001'").get();
  const other = db.prepare("SELECT id FROM usuarios WHERE codigo = 'ADM001'").get();
  const equipment = db.prepare('SELECT id FROM equipos LIMIT 1').get();
  const date = futureDate(31);
  const rejected = db.prepare(`INSERT INTO reservas
    (usuario_id, equipo_id, inicio, fin, estado, motivo_rechazo)
    VALUES (?, ?, ?, ?, 'RECHAZADA', ?)`)
    .run(student.id, equipment.id, utc(date, '10:00'), utc(date, '11:00'), 'Equipo no apto para la práctica');
  const alien = db.prepare(`INSERT INTO reservas
    (usuario_id, equipo_id, inicio, fin, estado, motivo_rechazo)
    VALUES (?, ?, ?, ?, 'RECHAZADA', ?)`)
    .run(other.id, equipment.id, utc(date, '11:00'), utc(date, '12:00'), 'Motivo ajeno');
  const response = request('GET', '/api/mis-reservas', {}, studentCookie());
  assert.equal(response.status, 200);
  assert.equal(response.body.find((item) => item.id === Number(rejected.lastInsertRowid)).motivo_rechazo,
    'Equipo no apto para la práctica');
  assert.ok(response.body.every((item) => item.id !== Number(alien.lastInsertRowid)));
  assert.ok(response.body.every((item) => item.estado === 'RECHAZADA' || item.motivo_rechazo === null));
});

test('[HU-02][CP-009, CP-010, CP-011] catálogo filtra cada categoría exacta', () => {
  const cookie = request('POST', '/api/auth/login', { codigo: '20240001', password: 'Estudiante123!' }).cookie;
  for (const categoria of ['Cómputo', 'Electrónica', 'Redes']) {
    const response = request('GET', '/api/equipos', {}, cookie, { categoria });
    assert.equal(response.status, 200);
    assert.equal(response.body.length, 6);
    assert.equal(response.body[0].categoria, categoria);
    assert.equal(response.body[0].estado, 'Disponible');
  }
  assert.equal(request('GET', '/api/equipos', {}, cookie, { categoria: 'computo' }).status, 400);
  assert.equal(request('GET', '/api/equipos', {}, cookie, { categoria: ['Redes'] }).status, 400);
  assert.equal(request('GET', '/api/equipos', {}, cookie, { ordenar: 'nombre' }).status, 400);
  assert.equal(request('GET', '/api/equipos').status, 401);
});

test('[HU-02][CP-012] categoría sin equipos devuelve lista vacía', () => {
  const cookie = request('POST', '/api/auth/login', { codigo: '20240001', password: 'Estudiante123!' }).cookie;
  db.exec('SAVEPOINT catalogo_vacio');
  try {
    db.prepare("UPDATE equipos SET estado = 'MANTENIMIENTO' WHERE categoria = 'Redes'").run();
    const response = request('GET', '/api/equipos', {}, cookie, { categoria: 'Redes' });
    assert.equal(response.status, 200);
    assert.deepEqual(response.body, []);
  } finally {
    db.exec('ROLLBACK TO catalogo_vacio; RELEASE catalogo_vacio');
  }
});

test('[HU-02][CP-008] reserva vigente refleja el estado Prestado en el catálogo', () => {
  const cookie = request('POST', '/api/auth/login', { codigo: '20240001', password: 'Estudiante123!' }).cookie;
  const usuario = db.prepare("SELECT id FROM usuarios WHERE codigo = '20240001'").get();
  const equipo = db.prepare("SELECT id FROM equipos WHERE codigo = 'COMP-001'").get();
  const start = new Date(Date.now() - 3_600_000).toISOString().slice(0, 19) + 'Z';
  const end = new Date(Date.now() + 3_600_000).toISOString().slice(0, 19) + 'Z';
  db.exec('SAVEPOINT catalogo_prestado');
  try {
    const reserva = db.prepare("INSERT INTO reservas (usuario_id, equipo_id, inicio, fin, estado) VALUES (?, ?, ?, ?, 'APROBADA')")
      .run(usuario.id, equipo.id, start, end);
    const equipoActual = () => request('GET', '/api/equipos', {}, cookie, { categoria: 'Cómputo' })
      .body.find((item) => item.id === equipo.id);
    assert.equal(equipoActual().estado, 'Prestado');
    db.prepare("UPDATE reservas SET estado = 'DEVUELTA', devuelta_en = ? WHERE id = ?")
      .run(new Date().toISOString(), reserva.lastInsertRowid);
    assert.equal(equipoActual().estado, 'Disponible');
  } finally {
    db.exec('ROLLBACK TO catalogo_prestado; RELEASE catalogo_prestado');
  }
});

test('[HU-01][CP-001, CP-003] inicio de sesión correcto y rechazo de contraseña incorrecta', () => {
  const bad = request('POST', '/api/auth/login', { codigo: '20240001', password: 'incorrecta' });
  assert.equal(bad.status, 401);
  assert.equal(bad.body.mensaje, 'Credenciales inválidas');
  const good = request('POST', '/api/auth/login', { codigo: '20240001', password: 'Estudiante123!' });
  assert.equal(good.status, 200);
  assert.equal(good.body.usuario.rol, 'ESTUDIANTE');
  assert.ok(good.cookie.startsWith('labtrack_session='));
  assert.equal(db.prepare("SELECT intentos_fallidos FROM usuarios WHERE codigo = '20240001'").get().intentos_fallidos, 0);
  assert.equal(request('GET', '/api/auth/me', {}, good.cookie).body.usuario.codigo, '20240001');
});

test('[HU-01][CP-004] inicio de sesión con campos vacíos es rechazado', () => {
  for (const body of [{}, { codigo: '', password: '' }, { codigo: '20240001', password: '' }]) {
    const response = request('POST', '/api/auth/login', body);
    assert.equal(response.status, 401);
    assert.equal(response.body.mensaje, 'Credenciales inválidas');
  }
});

test('[HU-01][CP-002] usuario inexistente recibe mensaje genérico', () => {
  const response = request('POST', '/api/auth/login', { codigo: 'NO_EXISTE', password: 'incorrecta' });
  assert.equal(response.status, 401);
  assert.equal(response.body.mensaje, 'Credenciales inválidas');
  assert.equal(db.prepare("SELECT count(*) AS total FROM intentos_login WHERE codigo = 'NO_EXISTE'").get().total, 1);
});

test('[HU-01][CP-005, CP-006] tres intentos fallidos bloquean temporalmente la cuenta', () => {
  const existingSession = studentCookie();
  for (let i = 1; i <= 3; i++) {
    const response = request('POST', '/api/auth/login', { codigo: '20240001', password: 'incorrecta' });
    assert.equal(response.status, i === 3 ? 423 : 401);
    assert.equal(response.body.mensaje, 'Credenciales inválidas');
    if (i === 3) assert.match(response.body.alerta, /bloqueada temporalmente/i);
  }
  assert.equal(request('GET', '/api/auth/me', {}, existingSession).status, 401);
  const locked = request('POST', '/api/auth/login', { codigo: '20240001', password: 'Estudiante123!' });
  assert.equal(locked.status, 423);
  const user = db.prepare("SELECT intentos_fallidos, bloqueado_hasta FROM usuarios WHERE codigo = '20240001'").get();
  assert.equal(user.intentos_fallidos, 3);
  assert.ok(Date.parse(user.bloqueado_hasta) > Date.now());
  db.prepare("UPDATE usuarios SET bloqueado_hasta = '2020-01-01T00:00:00.000Z' WHERE codigo = '20240001'").run();
  assert.equal(request('GET', '/api/auth/me', {}, existingSession).status, 200);
  assert.equal(request('POST', '/api/auth/login', { codigo: '20240001', password: 'incorrecta' }).status, 401);
  assert.equal(db.prepare("SELECT intentos_fallidos FROM usuarios WHERE codigo = '20240001'").get().intentos_fallidos, 1);
});

test('[HU-05][CP-029] devolución tardía registra retraso y penaliza al estudiante', () => {
  const student = db.prepare("SELECT id FROM usuarios WHERE codigo = '20240001'").get();
  const equipo = db.prepare('SELECT id FROM equipos LIMIT 1').get();
  const reserva = db.prepare(`
    INSERT INTO reservas (usuario_id, equipo_id, inicio, fin, estado)
    VALUES (?, ?, '2027-02-01T10:00:00Z', '2027-02-01T11:00:00Z', 'APROBADA')
  `).run(student.id, equipo.id);
  db.prepare("UPDATE reservas SET estado = 'DEVUELTA', devuelta_en = '2027-02-01T11:15:00Z' WHERE id = ?")
    .run(reserva.lastInsertRowid);
  assert.equal(db.prepare('SELECT retraso FROM reservas WHERE id = ?').get(reserva.lastInsertRowid).retraso, 1);
  assert.equal(db.prepare('SELECT estado_estudiante FROM usuarios WHERE id = ?').get(student.id).estado_estudiante, 'PENALIZADO');
});

test('[HU-04][Adicional] administrador accede a rutas administrativas; estudiante y anónimo no', () => {
  const admin = request('POST', '/api/auth/login', { codigo: 'ADM001', password: 'Admin123!' });
  assert.equal(admin.status, 200);
  assert.equal(admin.body.usuario.rol, 'ADMINISTRADOR');
  assert.equal(request('GET', '/api/admin/resumen', {}, admin.cookie).status, 200);
  assert.equal(request('GET', '/api/admin/resumen').status, 401);
  db.prepare("UPDATE usuarios SET intentos_fallidos = 0, bloqueado_hasta = NULL WHERE codigo = '20240001'").run();
  const student = request('POST', '/api/auth/login', { codigo: '20240001', password: 'Estudiante123!' });
  assert.equal(request('GET', '/api/admin/resumen', {}, student.cookie).status, 403);
});

test.after(() => {
  db.close();
  rmSync(testDirectory, { recursive: true, force: true });
});
