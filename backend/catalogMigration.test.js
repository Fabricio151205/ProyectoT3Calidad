const { test } = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve, sep } = require('node:path');
const { spawnSync } = require('node:child_process');

test('migra equipos existentes, conserva sus IDs y completa el catálogo sin duplicados', () => {
  const directory = mkdtempSync(join(tmpdir(), 'labtrack-catalog-'));
  const databasePath = join(directory, 'catalog.sqlite');
  try {
    const legacy = new DatabaseSync(databasePath);
    legacy.exec(`
      CREATE TABLE equipos (
        id INTEGER PRIMARY KEY, codigo TEXT UNIQUE, nombre TEXT, descripcion TEXT,
        categoria TEXT, ubicacion TEXT, estado TEXT, creado_en TEXT
      );
      INSERT INTO equipos (id, codigo, nombre, descripcion, categoria, ubicacion, estado, creado_en)
      VALUES (42, 'COMP-001', 'Laptop Dell Latitude', 'Existente', 'Cómputo',
        'Laboratorio de Cómputo', 'DISPONIBLE', '2026-01-01T00:00:00Z');
    `);
    legacy.close();

    const inspect = `
      const { db } = require('./db');
      const rows = db.prepare('SELECT id, codigo, descripcion, imagen_url FROM equipos ORDER BY id').all();
      console.log(JSON.stringify(rows));
      db.close();
    `;
    for (let run = 0; run < 2; run++) {
      const result = spawnSync(process.execPath, ['-e', inspect], {
        cwd: __dirname, encoding: 'utf8',
        env: { ...process.env, DB_PATH: databasePath, NODE_ENV: 'development' },
      });
      assert.equal(result.status, 0, result.stderr);
      const rows = JSON.parse(result.stdout);
      assert.equal(rows.length, 18);
      assert.equal(new Set(rows.map((row) => row.codigo)).size, 18);
      assert.deepEqual(rows.find((row) => row.codigo === 'COMP-001'), {
        id: 42, codigo: 'COMP-001', descripcion: 'Existente',
        imagen_url: '/equipos/laptop-dell-latitude.jpg',
      });
    }
  } finally {
    if (!resolve(directory).startsWith(resolve(tmpdir()) + sep)) {
      throw new Error('La base temporal está fuera del directorio esperado.');
    }
    rmSync(directory, { recursive: true, force: true });
  }
});
