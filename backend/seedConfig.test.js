const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const inspect = `
  const { db } = require('./db');
  const users = db.prepare('SELECT count(*) AS total FROM usuarios').get().total;
  const equipment = db.prepare('SELECT count(*) AS total FROM equipos').get().total;
  console.log(JSON.stringify({ users, equipment }));
  db.close();
`;

test('el sembrado requiere ambas variables en desarrollo y producción, sin exponerlas', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'labtrack-seed-config-'));
  const student = randomBytes(24).toString('base64url');
  const admin = randomBytes(24).toString('base64url');
  try {
    for (const mode of ['development', 'production']) {
      for (const [label, credentials, expectedUsers] of [
        ['none', {}, 0],
        ['partial', { SEED_STUDENT_PASSWORD: student }, 0],
        ['both', { SEED_STUDENT_PASSWORD: student, SEED_ADMIN_PASSWORD: admin }, 2],
      ]) {
        const env = { ...process.env, NODE_ENV: mode,
          DB_PATH: path.join(directory, `${mode}-${label}.sqlite`),
          SEED_STUDENT_PASSWORD: '', SEED_ADMIN_PASSWORD: '', ...credentials };
        const result = spawnSync(process.execPath, ['-e', inspect], {
          cwd: __dirname, env, encoding: 'utf8',
        });
        assert.equal(result.status, 0, result.stderr);
        assert.deepEqual(JSON.parse(result.stdout), {
          users: expectedUsers, equipment: expectedUsers ? 18 : 0,
        });
        assert.ok(!`${result.stdout}${result.stderr}`.includes(student));
        assert.ok(!`${result.stdout}${result.stderr}`.includes(admin));
      }
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
