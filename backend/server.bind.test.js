const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');

test('el proceso Express atiende /api/health por IPv6 e IPv4', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'labtrack-bind-'));
  const child = spawn(process.execPath, ['server.js'], {
    cwd: __dirname,
    env: {
      ...process.env,
      PORT: '0',
      DB_PATH: path.join(directory, 'bind.sqlite'),
      SEED_STUDENT_PASSWORD: '',
      SEED_ADMIN_PASSWORD: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  try {
    const port = await new Promise((resolve, reject) => {
      let output = '';
      const timer = setTimeout(() => reject(new Error('El servidor no inició a tiempo')), 10_000);
      child.stdout.on('data', (chunk) => {
        output += chunk;
        const match = output.match(/Servidor en http:\/\/\[::\]:(\d+)/);
        if (match) {
          clearTimeout(timer);
          resolve(Number(match[1]));
        }
      });
      child.once('error', (error) => { clearTimeout(timer); reject(error); });
      child.once('exit', (code) => {
        clearTimeout(timer);
        reject(new Error(`El servidor terminó antes de iniciar: ${code}`));
      });
    });

    for (const host of ['[::1]', '127.0.0.1']) {
      const response = await fetch(`http://${host}:${port}/api/health`);
      assert.equal(response.status, 200, host);
      assert.equal((await response.json()).estado, 'OK', host);
    }
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      const stopped = new Promise((resolve) => child.once('exit', resolve));
      child.kill();
      await stopped;
    }
    rmSync(directory, { recursive: true, force: true });
  }
});
