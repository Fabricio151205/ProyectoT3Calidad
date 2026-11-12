
const express = require("express");
const cors = require("cors");
const { db, equipmentDescription } = require("./db");
const { login, logout, requireAuth, requireAdmin, requireStudent, publicUser } = require("./auth");
const { createReservation, listMyReservations } = require('./reservations');
const { listPending, listActive, approve, reject, registerReturn } = require('./adminReservations');

const app = express();
app.disable('x-powered-by');
const PORT = Number(process.env.PORT || 3000);

if (process.env.CORS_ORIGIN) {
  app.use(cors({ origin: process.env.CORS_ORIGIN, credentials: true }));
}
app.use(express.json());

// Comprobar que el servidor funciona
app.get("/api/health", (req, res) => {
  res.json({
    mensaje: "Backend de LabTrack funcionando",
    estado: "OK"
  });
});

const categorias = new Set(['Cómputo', 'Electrónica', 'Redes', 'Mecánica']);

// El estado visible se calcula para el instante actual, sin modificar el inventario.
app.get("/api/equipos", requireAuth, (req, res) => {
  const categoria = req.query.categoria;
  if (Object.keys(req.query).some((key) => key !== 'categoria') ||
      (categoria !== undefined && (typeof categoria !== 'string' || !categorias.has(categoria)))) {
    return res.status(400).json({ mensaje: 'Categoría inválida' });
  }
  const ahora = new Date().toISOString().slice(0, 19) + 'Z';
  const equipos = db.prepare(`
    SELECT e.id, e.nombre, e.codigo, e.categoria, e.imagen_url, e.descripcion,
      CASE WHEN EXISTS (
        SELECT 1 FROM reservas r
        WHERE r.equipo_id = e.id AND r.estado = 'APROBADA'
          AND r.inicio <= ?
      ) THEN 'Prestado' ELSE 'Disponible' END AS estado
    FROM equipos e
    WHERE e.estado = 'DISPONIBLE' AND (? IS NULL OR e.categoria = ?)
    ORDER BY e.categoria, e.nombre
  `).all(ahora, categoria ?? null, categoria ?? null);
  return res.json(equipos.map((equipo) => ({
    ...equipo, descripcion: equipmentDescription(equipo),
  })));
});

app.post('/api/auth/login', login);
app.get('/api/auth/me', requireAuth, (req, res) => res.json({ usuario: publicUser(req.user) }));
app.post('/api/auth/logout', requireAuth, logout);
app.post('/api/reservas', requireAuth, requireStudent, createReservation);
app.get('/api/mis-reservas', requireAuth, requireStudent, listMyReservations);
app.get('/api/admin/resumen', requireAuth, requireAdmin, (req, res) => {
  const pendientes = db.prepare("SELECT count(*) AS total FROM reservas WHERE estado = 'PENDIENTE'").get().total;
  res.json({ pendientes });
});
app.get('/api/admin/reservas', requireAuth, requireAdmin, listPending);
app.get('/api/admin/reservas/activas', requireAuth, requireAdmin, listActive);
app.patch('/api/admin/reservas/:id/aprobar', requireAuth, requireAdmin, approve);
app.patch('/api/admin/reservas/:id/rechazar', requireAuth, requireAdmin, reject);
app.patch('/api/admin/reservas/:id/devolver', requireAuth, requireAdmin, registerReturn);

if (require.main === module) {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Servidor en http://localhost:${PORT}`);
  });
}

module.exports = app;

