const { randomBytes, createHash } = require('node:crypto');
const { db, verifyPassword, hashPassword } = require('./db');

const configuredLockMinutes = Number(process.env.LOCKOUT_MINUTES ?? 5);
const lockoutMs = Number.isFinite(configuredLockMinutes) && configuredLockMinutes > 0
  ? configuredLockMinutes * 60_000 : 5 * 60_000;
const sessionMs = 8 * 60 * 60_000;
const cookieName = 'labtrack_session';
const dummyHash = hashPassword(randomBytes(32).toString('base64url'));

function tokenHash(token) {
  return createHash('sha256').update(token).digest('hex');
}

function cookieOptions() {
  return { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/' };
}

function publicUser(user) {
  return { id: user.id, nombre: user.nombre, codigo: user.codigo, rol: user.rol,
    estadoEstudiante: user.estado_estudiante };
}

function login(req, res) {
  const codigo = typeof req.body?.codigo === 'string' ? req.body.codigo.trim() : '';
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  if (!codigo || !password || codigo.length > 64 || password.length > 1024) {
    return res.status(401).json({ mensaje: 'Credenciales inválidas' });
  }

  const user = db.prepare('SELECT * FROM usuarios WHERE codigo = ?').get(codigo);
  const now = Date.now();
  if (user?.bloqueado_hasta && Date.parse(user.bloqueado_hasta) > now) {
    return res.status(423).json({ mensaje: 'Cuenta bloqueada temporalmente. Inténtalo más tarde.' });
  }

  const valid = verifyPassword(password, user?.password_hash || dummyHash);
  if (!user || !valid || !user.activo) {
    db.prepare('INSERT INTO intentos_login (usuario_id, codigo) VALUES (?, ?)')
      .run(user?.id ?? null, codigo);
    if (user && user.activo) {
      const attempts = user.bloqueado_hasta && Date.parse(user.bloqueado_hasta) <= now
        ? 1 : user.intentos_fallidos + 1;
      db.prepare('UPDATE usuarios SET intentos_fallidos = ?, bloqueado_hasta = ? WHERE id = ?')
        .run(attempts, attempts >= 3 ? new Date(now + lockoutMs).toISOString() : null, user.id);
      if (attempts >= 3) {
        return res.status(423).json({
          mensaje: 'Credenciales inválidas',
          alerta: 'Cuenta bloqueada temporalmente. Inténtalo más tarde.',
        });
      }
    }
    return res.status(401).json({ mensaje: 'Credenciales inválidas' });
  }

  db.prepare('UPDATE usuarios SET intentos_fallidos = 0, bloqueado_hasta = NULL WHERE id = ?').run(user.id);
  const token = randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sesiones (token_hash, usuario_id, expira_en) VALUES (?, ?, ?)')
    .run(tokenHash(token), user.id, new Date(now + sessionMs).toISOString());
  res.cookie(cookieName, token, { ...cookieOptions(), maxAge: sessionMs });
  return res.json({ usuario: publicUser(user) });
}

function sessionToken(req) {
  const cookie = req.headers.cookie?.split(';').map((part) => part.trim())
    .find((part) => part.startsWith(`${cookieName}=`));
  return cookie?.slice(cookieName.length + 1) || null;
}

function requireAuth(req, res, next) {
  const token = sessionToken(req);
  if (!token || !/^[0-9a-f]{64}$/.test(token)) {
    return res.status(401).json({ mensaje: 'No autorizado' });
  }
  const user = db.prepare(`
    SELECT u.id, u.nombre, u.codigo, u.rol, u.estado_estudiante
    FROM sesiones s JOIN usuarios u ON u.id = s.usuario_id
    WHERE s.token_hash = ? AND s.expira_en > ? AND u.activo = 1
      AND (u.bloqueado_hasta IS NULL OR u.bloqueado_hasta <= ?)
  `).get(tokenHash(token), new Date().toISOString(), new Date().toISOString());
  if (!user) return res.status(401).json({ mensaje: 'No autorizado' });
  req.user = user;
  req.sessionToken = token;
  return next();
}

function requireAdmin(req, res, next) {
  if (req.user.rol !== 'ADMINISTRADOR') {
    return res.status(403).json({ mensaje: 'Acceso denegado' });
  }
  return next();
}

function requireStudent(req, res, next) {
  if (req.user.rol !== 'ESTUDIANTE') {
    return res.status(403).json({ mensaje: 'Acceso reservado a estudiantes' });
  }
  return next();
}

function logout(req, res) {
  db.prepare('DELETE FROM sesiones WHERE token_hash = ?').run(tokenHash(req.sessionToken));
  res.clearCookie(cookieName, cookieOptions());
  res.status(204).end();
}

module.exports = { login, logout, requireAuth, requireAdmin, requireStudent, publicUser };
