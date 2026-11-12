const { DatabaseSync } = require('node:sqlite');
const { existsSync, mkdirSync, statSync } = require('node:fs');
const path = require('node:path');

const sourcePath = process.env.DB_PATH || path.join(__dirname, 'data', 'labtrack.sqlite');
const destination = process.argv[2] && path.resolve(process.argv[2]);

if (!destination || !existsSync(sourcePath) || existsSync(destination) ||
    path.resolve(sourcePath) === destination) {
  console.error('Indica una ruta nueva de respaldo y comprueba que la base de origen exista.');
  process.exit(1);
}

mkdirSync(path.dirname(destination), { recursive: true });
const source = new DatabaseSync(sourcePath, { readOnly: true });
try {
  source.prepare('VACUUM INTO ?').run(destination);
} finally {
  source.close();
}

const backup = new DatabaseSync(destination, { readOnly: true });
try {
  const integrity = backup.prepare('PRAGMA integrity_check').get().integrity_check;
  const foreignKeys = backup.prepare('PRAGMA foreign_key_check').all().length;
  if (integrity !== 'ok' || foreignKeys !== 0) throw new Error('El respaldo no pasó la verificación de integridad.');
  console.log(JSON.stringify({ destination, bytes: statSync(destination).size, integrity, foreignKeys }));
} finally {
  backup.close();
}
