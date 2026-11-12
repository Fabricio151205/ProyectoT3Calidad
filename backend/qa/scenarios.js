const { mkdtempSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');

const scenarios = new Set(['active-loans', 'empty-category']);

function populateScenario(db, hashPassword, scenario, now = new Date()) {
  if (!scenarios.has(scenario)) throw new Error('Escenario QA desconocido.');
  const studentPassword = process.env.SEED_STUDENT_PASSWORD;
  if (!studentPassword) throw new Error('Configura SEED_STUDENT_PASSWORD para el escenario QA.');
  const addStudent = db.prepare(`
    INSERT INTO usuarios (nombre, email, codigo, password_hash, rol)
    VALUES (?, ?, ?, ?, 'ESTUDIANTE')
  `);
  const studentId = Number(addStudent.run('Juan Pérez', 'juan.qa@labtrack.test',
    '20261001', hashPassword(studentPassword)).lastInsertRowid);
  const secondStudentId = Number(addStudent.run('Ana QA', 'ana.qa@labtrack.test',
    '20261002', hashPassword(studentPassword)).lastInsertRowid);
  const addEquipment = db.prepare(`
    INSERT INTO equipos (codigo, nombre, descripcion, categoria, ubicacion)
    VALUES (?, ?, ?, 'Cómputo', 'Laboratorio QA')
  `);
  const laptopId = Number(addEquipment.run('HP-001', 'Laptop HP-001',
    'Equipo portátil para las prácticas de laboratorio.').lastInsertRowid);
  const projectorId = Number(addEquipment.run('PR-002', 'Proyector PR-002',
    'Equipo de proyección para actividades del laboratorio.').lastInsertRowid);
  const otherEquipmentId = db.prepare("SELECT id FROM equipos WHERE codigo = 'ELEC-003'").get().id;
  const pendingEquipmentId = db.prepare("SELECT id FROM equipos WHERE codigo = 'COMP-002'").get().id;
  const rejectedEquipmentId = db.prepare("SELECT id FROM equipos WHERE codigo = 'ELEC-002'").get().id;
  const at = (minutes) => new Date(now.getTime() + minutes * 60_000).toISOString().slice(0, 19) + 'Z';
  const addReservation = db.prepare(`
    INSERT INTO reservas (usuario_id, equipo_id, inicio, fin, estado, motivo_rechazo)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const activeId = Number(addReservation.run(studentId, laptopId, at(-60), at(60),
    'APROBADA', null).lastInsertRowid);
  const overdueId = Number(addReservation.run(secondStudentId, otherEquipmentId,
    at(-180), at(-60), 'APROBADA', null).lastInsertRowid);
  const futureId = Number(addReservation.run(studentId, projectorId, at(180), at(240),
    'APROBADA', null).lastInsertRowid);
  const pendingId = Number(addReservation.run(studentId, pendingEquipmentId,
    at(300), at(360), 'PENDIENTE', null).lastInsertRowid);
  const rejectedId = Number(addReservation.run(studentId, rejectedEquipmentId,
    at(300), at(360), 'RECHAZADA', 'Equipo reservado para otra práctica').lastInsertRowid);

  if (scenario === 'empty-category') {
    // Se eliminan solo los equipos Redes de esta base recién creada en %TEMP%.
    db.prepare("DELETE FROM equipos WHERE categoria = 'Redes'").run();
  }
  if (db.prepare('PRAGMA foreign_key_check').all().length !== 0 ||
      db.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok') {
    throw new Error('La base QA no superó las comprobaciones de integridad.');
  }
  return { studentId, secondStudentId, laptopId, projectorId,
    activeId, overdueId, futureId, pendingId, rejectedId };
}

if (require.main === module) {
  const scenario = process.argv[2];
  let prefix;
  if (scenario === 'active-loans') prefix = 'labtrack-qa-active-loans-';
  else if (scenario === 'empty-category') prefix = 'labtrack-qa-empty-category-';
  if (!scenarios.has(scenario) || !prefix) {
    console.error('Uso: node qa/scenarios.js active-loans|empty-category');
    process.exitCode = 1;
  } else if (!process.env.SEED_STUDENT_PASSWORD || !process.env.SEED_ADMIN_PASSWORD) {
    console.error('Configura SEED_STUDENT_PASSWORD y SEED_ADMIN_PASSWORD antes de ejecutar el escenario QA.');
    process.exitCode = 1;
  } else {
    const directory = mkdtempSync(path.join(tmpdir(), prefix));
    process.env.DB_PATH = path.join(directory, 'qa.sqlite');
    process.env.NODE_ENV = 'development';
    const { db, hashPassword } = require('../db');
    const ids = populateScenario(db, hashPassword, scenario);
    const app = require('../server');
    const port = Number(process.env.QA_PORT || 3000);
    app.listen(port, '127.0.0.1', () => {
      console.log(JSON.stringify({ scenario, databasePath: process.env.DB_PATH,
        backendUrl: `http://127.0.0.1:${port}`, ids,
        demoAccounts: ['20261001', '20261002', 'ADM001'] }, null, 2));
    });
  }
}

module.exports = { populateScenario };
