const { DatabaseSync } = require('node:sqlite');
const { scryptSync, randomBytes, timingSafeEqual } = require('node:crypto');
const { mkdirSync } = require('node:fs');
const path = require('node:path');

const databasePath = process.env.DB_PATH || path.join(__dirname, 'data', 'labtrack.sqlite');
mkdirSync(path.dirname(databasePath), { recursive: true });

const db = new DatabaseSync(databasePath);
db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');

db.exec(`
  CREATE TABLE IF NOT EXISTS usuarios (
    id INTEGER PRIMARY KEY,
    nombre TEXT NOT NULL CHECK (length(trim(nombre)) > 0),
    email TEXT NOT NULL COLLATE NOCASE UNIQUE CHECK (length(trim(email)) > 0),
    codigo TEXT UNIQUE,
    password_hash TEXT NOT NULL,
    rol TEXT NOT NULL CHECK (rol IN ('ESTUDIANTE', 'ADMINISTRADOR')),
    activo INTEGER NOT NULL DEFAULT 1 CHECK (activo IN (0, 1)),
    estado_estudiante TEXT NOT NULL DEFAULT 'REGULAR'
      CHECK (estado_estudiante IN ('REGULAR', 'PENALIZADO')),
    intentos_fallidos INTEGER NOT NULL DEFAULT 0 CHECK (intentos_fallidos >= 0),
    bloqueado_hasta TEXT,
    creado_en TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );

  CREATE TABLE IF NOT EXISTS equipos (
    id INTEGER PRIMARY KEY,
    codigo TEXT NOT NULL COLLATE NOCASE UNIQUE,
    nombre TEXT NOT NULL CHECK (length(trim(nombre)) > 0),
    descripcion TEXT NOT NULL DEFAULT '',
    categoria TEXT NOT NULL CHECK (categoria IN ('Cómputo', 'Electrónica', 'Redes')),
    ubicacion TEXT NOT NULL CHECK (length(trim(ubicacion)) > 0),
    imagen_url TEXT,
    estado TEXT NOT NULL DEFAULT 'DISPONIBLE'
      CHECK (estado IN ('DISPONIBLE', 'MANTENIMIENTO', 'INACTIVO')),
    creado_en TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );

  CREATE TABLE IF NOT EXISTS reservas (
    id INTEGER PRIMARY KEY,
    usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT,
    equipo_id INTEGER NOT NULL REFERENCES equipos(id) ON DELETE RESTRICT,
    inicio TEXT NOT NULL,
    fin TEXT NOT NULL,
    estado TEXT NOT NULL DEFAULT 'PENDIENTE'
      CHECK (estado IN ('PENDIENTE', 'APROBADA', 'RECHAZADA', 'CANCELADA', 'DEVUELTA')),
    motivo TEXT NOT NULL DEFAULT '',
    motivo_rechazo TEXT,
    aprobada_en TEXT,
    devuelta_en TEXT,
    retraso INTEGER NOT NULL DEFAULT 0 CHECK (retraso IN (0, 1)),
    creado_en TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    actualizado_en TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    CHECK (inicio < fin),
    CHECK (inicio GLOB '????-??-??T??:??:??Z'),
    CHECK (fin GLOB '????-??-??T??:??:??Z'),
    CHECK (estado != 'RECHAZADA' OR (motivo_rechazo IS NOT NULL AND length(trim(motivo_rechazo)) > 0)),
    CHECK (estado != 'DEVUELTA' OR devuelta_en IS NOT NULL),
    CHECK (devuelta_en IS NULL OR estado = 'DEVUELTA'),
    CHECK (retraso = 0 OR (devuelta_en IS NOT NULL AND julianday(devuelta_en) > julianday(fin)))
  );

  CREATE TABLE IF NOT EXISTS intentos_login (
    id INTEGER PRIMARY KEY,
    usuario_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
    codigo TEXT NOT NULL,
    ocurrido_en TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );

  CREATE TABLE IF NOT EXISTS sesiones (
    token_hash TEXT PRIMARY KEY,
    usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    expira_en TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_reservas_usuario ON reservas(usuario_id, inicio);
  CREATE INDEX IF NOT EXISTS idx_reservas_equipo_periodo ON reservas(equipo_id, inicio, fin);
`);

function hasColumn(table, column) {
  return db.prepare(`PRAGMA table_info(${table})`).all().some((entry) => entry.name === column);
}

if (!hasColumn('equipos', 'imagen_url')) {
  db.exec('ALTER TABLE equipos ADD COLUMN imagen_url TEXT');
}

// Migra la base de la primera fase sin borrar usuarios, equipos ni reservas.
if (!hasColumn('usuarios', 'codigo')) {
  db.exec(`
    ALTER TABLE usuarios ADD COLUMN codigo TEXT;
    CREATE UNIQUE INDEX idx_usuarios_codigo ON usuarios(codigo);
    ALTER TABLE usuarios ADD COLUMN estado_estudiante TEXT NOT NULL DEFAULT 'REGULAR'
      CHECK (estado_estudiante IN ('REGULAR', 'PENALIZADO'));
    ALTER TABLE usuarios ADD COLUMN intentos_fallidos INTEGER NOT NULL DEFAULT 0
      CHECK (intentos_fallidos >= 0);
    ALTER TABLE usuarios ADD COLUMN bloqueado_hasta TEXT;
  `);
}

if (!hasColumn('reservas', 'motivo_rechazo')) {
  db.exec('BEGIN');
  try {
    db.exec(`
      DROP TRIGGER IF EXISTS reservas_sin_cruce_insert;
      DROP TRIGGER IF EXISTS reservas_sin_cruce_update;
      CREATE TABLE reservas_nueva (
        id INTEGER PRIMARY KEY,
        usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT,
        equipo_id INTEGER NOT NULL REFERENCES equipos(id) ON DELETE RESTRICT,
        inicio TEXT NOT NULL,
        fin TEXT NOT NULL,
        estado TEXT NOT NULL DEFAULT 'PENDIENTE'
          CHECK (estado IN ('PENDIENTE', 'APROBADA', 'RECHAZADA', 'CANCELADA', 'DEVUELTA')),
        motivo TEXT NOT NULL DEFAULT '',
        motivo_rechazo TEXT,
        aprobada_en TEXT,
        devuelta_en TEXT,
        retraso INTEGER NOT NULL DEFAULT 0 CHECK (retraso IN (0, 1)),
        creado_en TEXT NOT NULL,
        actualizado_en TEXT NOT NULL,
        CHECK (inicio < fin),
        CHECK (inicio GLOB '????-??-??T??:??:??Z'),
        CHECK (fin GLOB '????-??-??T??:??:??Z'),
        CHECK (estado != 'RECHAZADA' OR (motivo_rechazo IS NOT NULL AND length(trim(motivo_rechazo)) > 0)),
        CHECK (estado != 'DEVUELTA' OR devuelta_en IS NOT NULL),
        CHECK (devuelta_en IS NULL OR estado = 'DEVUELTA'),
        CHECK (retraso = 0 OR (devuelta_en IS NOT NULL AND julianday(devuelta_en) > julianday(fin)))
      );
      INSERT INTO reservas_nueva
        (id, usuario_id, equipo_id, inicio, fin, estado, motivo, devuelta_en, creado_en, actualizado_en)
      SELECT id, usuario_id, equipo_id, inicio, fin,
        CASE estado WHEN 'CONFIRMADA' THEN 'APROBADA'
          WHEN 'FINALIZADA' THEN 'DEVUELTA' ELSE estado END,
        motivo, CASE WHEN estado = 'FINALIZADA' THEN actualizado_en END,
        creado_en, actualizado_en FROM reservas;
      DROP TABLE reservas;
      ALTER TABLE reservas_nueva RENAME TO reservas;
      CREATE INDEX idx_reservas_usuario ON reservas(usuario_id, inicio);
      CREATE INDEX idx_reservas_equipo_periodo ON reservas(equipo_id, inicio, fin);
    `);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

// Corrige la comparación temporal de las bases anteriores sin perder reservas.
const reservationSchema = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'reservas'").get().sql;
if (!reservationSchema.includes('julianday(devuelta_en)')) {
  db.exec('BEGIN');
  try {
    db.exec(`
      CREATE TABLE reservas_hu05 (
        id INTEGER PRIMARY KEY,
        usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT,
        equipo_id INTEGER NOT NULL REFERENCES equipos(id) ON DELETE RESTRICT,
        inicio TEXT NOT NULL,
        fin TEXT NOT NULL,
        estado TEXT NOT NULL DEFAULT 'PENDIENTE'
          CHECK (estado IN ('PENDIENTE', 'APROBADA', 'RECHAZADA', 'CANCELADA', 'DEVUELTA')),
        motivo TEXT NOT NULL DEFAULT '',
        motivo_rechazo TEXT,
        aprobada_en TEXT,
        devuelta_en TEXT,
        retraso INTEGER NOT NULL DEFAULT 0 CHECK (retraso IN (0, 1)),
        creado_en TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        actualizado_en TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        CHECK (inicio < fin),
        CHECK (inicio GLOB '????-??-??T??:??:??Z'),
        CHECK (fin GLOB '????-??-??T??:??:??Z'),
        CHECK (estado != 'RECHAZADA' OR (motivo_rechazo IS NOT NULL AND length(trim(motivo_rechazo)) > 0)),
        CHECK (estado != 'DEVUELTA' OR devuelta_en IS NOT NULL),
        CHECK (devuelta_en IS NULL OR estado = 'DEVUELTA'),
        CHECK (retraso = 0 OR (devuelta_en IS NOT NULL AND julianday(devuelta_en) > julianday(fin)))
      );
      INSERT INTO reservas_hu05
        (id, usuario_id, equipo_id, inicio, fin, estado, motivo, motivo_rechazo,
         aprobada_en, devuelta_en, retraso, creado_en, actualizado_en)
      SELECT id, usuario_id, equipo_id, inicio, fin, estado, motivo, motivo_rechazo,
        aprobada_en, devuelta_en, retraso, creado_en, actualizado_en FROM reservas;
      DROP TABLE reservas;
      ALTER TABLE reservas_hu05 RENAME TO reservas;
      CREATE INDEX idx_reservas_usuario ON reservas(usuario_id, inicio);
      CREATE INDEX idx_reservas_equipo_periodo ON reservas(equipo_id, inicio, fin);
    `);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

db.exec(`
  DROP TRIGGER IF EXISTS reservas_sin_cruce_insert;
  DROP TRIGGER IF EXISTS reservas_sin_cruce_update;
  CREATE TRIGGER reservas_sin_cruce_insert BEFORE INSERT ON reservas
  WHEN NEW.estado = 'APROBADA'
  BEGIN
    SELECT RAISE(ABORT, 'Equipo reservado en ese horario') WHERE EXISTS (
      SELECT 1 FROM reservas r WHERE r.equipo_id = NEW.equipo_id
        AND r.estado = 'APROBADA' AND NEW.inicio < r.fin AND NEW.fin > r.inicio
    );
    SELECT RAISE(ABORT, 'Estudiante con otra reserva simultánea') WHERE EXISTS (
      SELECT 1 FROM reservas r WHERE r.usuario_id = NEW.usuario_id
        AND r.estado = 'APROBADA' AND NEW.inicio < r.fin AND NEW.fin > r.inicio
    );
  END;
  CREATE TRIGGER reservas_sin_cruce_update
  BEFORE UPDATE OF equipo_id, usuario_id, inicio, fin, estado ON reservas
  WHEN NEW.estado = 'APROBADA'
  BEGIN
    SELECT RAISE(ABORT, 'Equipo reservado en ese horario') WHERE EXISTS (
      SELECT 1 FROM reservas r WHERE r.id != NEW.id AND r.equipo_id = NEW.equipo_id
        AND r.estado = 'APROBADA' AND NEW.inicio < r.fin AND NEW.fin > r.inicio
    );
    SELECT RAISE(ABORT, 'Estudiante con otra reserva simultánea') WHERE EXISTS (
      SELECT 1 FROM reservas r WHERE r.id != NEW.id AND r.usuario_id = NEW.usuario_id
        AND r.estado = 'APROBADA' AND NEW.inicio < r.fin AND NEW.fin > r.inicio
    );
  END;
  DROP TRIGGER IF EXISTS reservas_devolucion_insert;
  DROP TRIGGER IF EXISTS reservas_devolucion_update;
  CREATE TRIGGER reservas_devolucion_insert AFTER INSERT ON reservas
  WHEN NEW.estado = 'DEVUELTA'
  BEGIN
    UPDATE reservas SET retraso = (julianday(NEW.devuelta_en) > julianday(NEW.fin)) WHERE id = NEW.id;
    UPDATE usuarios SET estado_estudiante = 'PENALIZADO'
      WHERE id = NEW.usuario_id AND julianday(NEW.devuelta_en) > julianday(NEW.fin) AND rol = 'ESTUDIANTE';
  END;
  CREATE TRIGGER reservas_devolucion_update AFTER UPDATE OF estado, devuelta_en ON reservas
  WHEN NEW.estado = 'DEVUELTA'
  BEGIN
    UPDATE reservas SET retraso = (julianday(NEW.devuelta_en) > julianday(NEW.fin)) WHERE id = NEW.id;
    UPDATE usuarios SET estado_estudiante = 'PENALIZADO'
      WHERE id = NEW.usuario_id AND julianday(NEW.devuelta_en) > julianday(NEW.fin) AND rol = 'ESTUDIANTE';
  END;
`);

function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64);
  return `scrypt:${salt.toString('hex')}:${hash.toString('hex')}`;
}

function verifyPassword(password, storedHash) {
  const [algorithm, saltHex, hashHex] = storedHash.split(':');
  if (algorithm !== 'scrypt' || !/^[0-9a-f]{32}$/.test(saltHex || '') ||
      !/^[0-9a-f]{128}$/.test(hashHex || '')) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length);
  return timingSafeEqual(actual, expected);
}

function seedDevelopmentData() {
  const production = process.env.NODE_ENV === 'production';
  if (production && (!process.env.SEED_STUDENT_PASSWORD || !process.env.SEED_ADMIN_PASSWORD)) return;

  const localPasswords = !production && (!process.env.SEED_STUDENT_PASSWORD || !process.env.SEED_ADMIN_PASSWORD)
    ? require('./devSeed') : null;
  const studentPassword = process.env.SEED_STUDENT_PASSWORD || localPasswords.studentPassword;
  const adminPassword = process.env.SEED_ADMIN_PASSWORD || localPasswords.adminPassword;

  const addUser = db.prepare(`
    INSERT INTO usuarios (nombre, email, codigo, password_hash, rol)
    VALUES (?, ?, ?, ?, ?) ON CONFLICT(email) DO NOTHING
  `);
  const addEquipment = db.prepare(`
    INSERT INTO equipos (codigo, nombre, descripcion, categoria, ubicacion, imagen_url)
    SELECT ?, ?, ?, ?, ?, ?
    WHERE NOT EXISTS (
      SELECT 1 FROM equipos WHERE codigo = ? OR (nombre = ? COLLATE NOCASE AND categoria = ?)
    )
  `);
  const addImage = db.prepare(`
    UPDATE equipos SET imagen_url = ?
    WHERE (codigo = ? OR (nombre = ? COLLATE NOCASE AND categoria = ?))
      AND (imagen_url IS NULL OR trim(imagen_url) = '')
  `);
  const catalog = [
    ['COMP-001', 'Laptop Dell Latitude', 'laptop-dell-latitude.jpg', 'Cómputo'],
    ['ELEC-001', 'Osciloscopio digital', 'osciloscopio-digital.jpg', 'Electrónica'],
    ['RED-001', 'Switch administrable', 'switch-administrable.jpg', 'Redes'],
    ['COMP-002', 'PC HP ProDesk', 'pc-hp-prodesk.jpg', 'Cómputo'],
    ['COMP-003', 'Monitor LG 24"', 'monitor-lg-24.jpg', 'Cómputo'],
    ['COMP-004', 'Teclado mecánico Logitech', 'teclado-logitech.jpg', 'Cómputo'],
    ['COMP-005', 'Mouse inalámbrico Logitech', 'mouse-logitech.jpg', 'Cómputo'],
    ['COMP-006', 'Impresora Epson EcoTank', 'impresora-epson-ecotank.jpg', 'Cómputo'],
    ['ELEC-002', 'Multímetro Fluke', 'multimetro-fluke.jpg', 'Electrónica'],
    ['ELEC-003', 'Fuente de alimentación DC', 'fuente-alimentacion-dc.jpg', 'Electrónica'],
    ['ELEC-004', 'Protoboard', 'protoboard.jpg', 'Electrónica'],
    ['ELEC-005', 'Arduino Uno', 'arduino-uno.jpg', 'Electrónica'],
    ['ELEC-006', 'Cautín de precisión', 'cautin-precision.jpg', 'Electrónica'],
    ['RED-002', 'Router Cisco', 'router-cisco.jpg', 'Redes'],
    ['RED-003', 'Access Point', 'access-point.jpg', 'Redes'],
    ['RED-004', 'Patch Panel', 'patch-panel.jpg', 'Redes'],
    ['RED-005', 'Crimpadora RJ45', 'crimpadora-rj45.jpg', 'Redes'],
    ['RED-006', 'Probador de cables', 'probador-cables.jpg', 'Redes'],
  ];

  db.exec('BEGIN');
  try {
    if (!db.prepare('SELECT 1 FROM usuarios WHERE email = ?').get('estudiante@labtrack.test')) {
      addUser.run('Estudiante de prueba', 'estudiante@labtrack.test', '20240001', hashPassword(studentPassword), 'ESTUDIANTE');
    }
    if (!db.prepare('SELECT 1 FROM usuarios WHERE email = ?').get('admin@labtrack.test')) {
      addUser.run('Administrador de prueba', 'admin@labtrack.test', 'ADM001', hashPassword(adminPassword), 'ADMINISTRADOR');
    }
    db.prepare('UPDATE usuarios SET codigo = ? WHERE email = ? AND codigo IS NULL')
      .run('20240001', 'estudiante@labtrack.test');
    db.prepare('UPDATE usuarios SET codigo = ? WHERE email = ? AND codigo IS NULL')
      .run('ADM001', 'admin@labtrack.test');
    for (const [codigo, nombre, imagen, categoria] of catalog) {
      const imagenUrl = `/equipos/${imagen}`;
      const ubicacion = `Laboratorio de ${categoria}`;
      addEquipment.run(codigo, nombre, `Equipo de ${categoria}`, categoria, ubicacion,
        imagenUrl, codigo, nombre, categoria);
      addImage.run(imagenUrl, codigo, nombre, categoria);
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

seedDevelopmentData();

module.exports = { db, databasePath, hashPassword, verifyPassword };
