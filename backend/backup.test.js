const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const directory = mkdtempSync(path.join(tmpdir(), 'labtrack-backup-test-'));
const sourcePath = path.join(directory, 'source.sqlite');
const backupDir = path.join(directory, 'allowed');
const outsideDir = path.join(directory, 'outside');
mkdirSync(backupDir);
mkdirSync(outsideDir);
const source = new DatabaseSync(sourcePath);
source.exec('CREATE TABLE prueba (valor TEXT NOT NULL); INSERT INTO prueba VALUES (\'conservado\');');
source.close();

function backup(destination, allowedDir = backupDir) {
  return spawnSync(process.execPath, [path.join(__dirname, 'backup.js'), destination], {
    env: { ...process.env, DB_PATH: sourcePath, BACKUP_DIR: allowedDir },
    encoding: 'utf8',
  });
}

test('crea un respaldo SQLite íntegro dentro del directorio autorizado', () => {
  const destination = path.join(backupDir, 'nuevo.sqlite');
  const result = backup(destination);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).destination, destination);
  const copy = new DatabaseSync(destination, { readOnly: true });
  try {
    assert.equal(copy.prepare('SELECT valor FROM prueba').get().valor, 'conservado');
    assert.equal(copy.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
  } finally {
    copy.close();
  }
});

test('no sobrescribe un respaldo existente', () => {
  const destination = path.join(backupDir, 'existente.sqlite');
  writeFileSync(destination, 'contenido existente');
  assert.notEqual(backup(destination).status, 0);
  assert.equal(readFileSync(destination, 'utf8'), 'contenido existente');
  const empty = path.join(backupDir, 'vacio.sqlite');
  writeFileSync(empty, '');
  assert.notEqual(backup(empty).status, 0);
  assert.equal(readFileSync(empty).length, 0);
});

test('rechaza rutas fuera del directorio autorizado y rutas anidadas', () => {
  const outside = path.join(outsideDir, 'escape.sqlite');
  assert.notEqual(backup(outside).status, 0);
  assert.equal(existsSync(outside), false);
  const nestedDir = path.join(backupDir, 'nested');
  mkdirSync(nestedDir);
  const nested = path.join(nestedDir, 'escape.sqlite');
  assert.notEqual(backup(nested).status, 0);
  assert.equal(existsSync(nested), false);
});

test('rechaza un directorio autorizado que sea enlace simbólico', (t) => {
  const linkedDir = path.join(directory, 'linked');
  try {
    symlinkSync(outsideDir, linkedDir, process.platform === 'win32' ? 'junction' : 'dir');
  } catch (error) {
    if (error.code === 'EPERM' || error.code === 'ENOTSUP') return t.skip('El sistema no permite crear enlaces simbólicos.');
    throw error;
  }
  const destination = path.join(linkedDir, 'escape.sqlite');
  assert.notEqual(backup(destination, linkedDir).status, 0);
  assert.equal(existsSync(path.join(outsideDir, 'escape.sqlite')), false);
});

test('no sigue un enlace simbólico usado como archivo de destino', (t) => {
  const target = path.join(outsideDir, 'protegido.sqlite');
  writeFileSync(target, 'contenido protegido');
  const destination = path.join(backupDir, 'enlace.sqlite');
  try {
    symlinkSync(target, destination, 'file');
  } catch (error) {
    if (error.code === 'EPERM' || error.code === 'ENOTSUP') return t.skip('El sistema no permite crear enlaces simbólicos.');
    throw error;
  }
  assert.notEqual(backup(destination).status, 0);
  assert.equal(readFileSync(target, 'utf8'), 'contenido protegido');
});

after(() => rmSync(directory, { recursive: true, force: true }));
