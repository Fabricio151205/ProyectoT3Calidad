const { DatabaseSync } = require('node:sqlite');
const { closeSync, existsSync, lstatSync, mkdirSync, openSync, realpathSync, statSync } = require('node:fs');
const path = require('node:path');

const sourcePath = process.env.DB_PATH || path.join(__dirname, 'data', 'labtrack.sqlite');
const requestedPath = process.argv[2] && path.resolve(process.argv[2]);
const localBackupDir = path.join(__dirname, 'backups');
const allowedDirectories = process.env.BACKUP_DIR
  ? [path.resolve(process.env.BACKUP_DIR)]
  : [localBackupDir, ...(process.platform === 'win32' ? [] : ['/backup'])];

function fail(message) {
  console.error(message);
  process.exit(1);
}

if (!requestedPath || !existsSync(sourcePath)) {
  fail('Indica una ruta nueva de respaldo y comprueba que la base de origen exista.');
}

const fileName = path.basename(requestedPath);
if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,120}\.(?:sqlite|db)$/.test(fileName) || fileName.includes('..')) {
  fail('El nombre del respaldo debe ser un archivo .sqlite o .db sin espacios ni rutas.');
}

// Solo se admiten archivos directos en el directorio de respaldos autorizado.
const backupDir = allowedDirectories.find((directory) => {
  const relative = path.relative(directory, requestedPath);
  return relative && path.dirname(relative) === '.' && !path.isAbsolute(relative);
});
if (!backupDir) fail('El respaldo debe guardarse directamente en un directorio autorizado.');

if (backupDir === localBackupDir) mkdirSync(localBackupDir, { recursive: true });
if (!existsSync(backupDir) || lstatSync(backupDir).isSymbolicLink() ||
    !statSync(backupDir).isDirectory()) {
  fail('El directorio de respaldos no existe o es un enlace simbólico.');
}
const canonicalBackupDir = realpathSync(backupDir);
if (path.relative(backupDir, canonicalBackupDir) !== '' ||
    realpathSync(path.dirname(requestedPath)) !== canonicalBackupDir) {
  fail('El directorio de respaldos contiene un enlace simbólico.');
}

// La ruta utilizada para escribir se construye solo desde el directorio comprobado y el nombre validado.
const destination = path.join(canonicalBackupDir, fileName);
if (path.resolve(sourcePath) === destination) fail('El destino no puede ser la base de origen.');

// La creación exclusiva impide sobrescribir incluso un archivo vacío o un enlace existente.
try {
  closeSync(openSync(destination, 'wx', 0o600));
} catch (error) {
  if (error.code === 'EEXIST') fail('El respaldo de destino ya existe.');
  throw error;
}

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
