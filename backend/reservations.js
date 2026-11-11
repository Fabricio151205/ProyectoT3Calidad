const { db } = require('./db');

function parseSchedule(body) {
  const { fecha, horaInicio, horaFin } = body || {};
  if (typeof fecha !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(fecha) ||
      typeof horaInicio !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(horaInicio) ||
      typeof horaFin !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(horaFin)) {
    return { error: 'Indica una fecha y horas válidas (HH:mm).' };
  }

  const [year, month, day] = fecha.split('-').map(Number);
  const calendarDate = new Date(Date.UTC(year, month - 1, day));
  if (calendarDate.getUTCFullYear() !== year || calendarDate.getUTCMonth() !== month - 1 ||
      calendarDate.getUTCDate() !== day) {
    return { error: 'La fecha de reserva no es válida.' };
  }

  // LabTrack usa la hora local de Lima (UTC-05:00) para los formularios.
  const startMs = Date.parse(`${fecha}T${horaInicio}:00-05:00`);
  const endMs = Date.parse(`${fecha}T${horaFin}:00-05:00`);
  if (endMs <= startMs) return { error: 'La hora de finalización debe ser posterior a la de inicio.' };
  if (startMs <= Date.now()) return { error: 'No se permiten reservas en fechas u horarios pasados.' };
  return {
    start: new Date(startMs).toISOString().slice(0, 19) + 'Z',
    end: new Date(endMs).toISOString().slice(0, 19) + 'Z',
  };
}

function createReservation(req, res) {
  const equipoId = req.body?.equipoId;
  if (!Number.isSafeInteger(equipoId) || equipoId <= 0) {
    return res.status(400).json({ mensaje: 'Selecciona un equipo válido.' });
  }
  const schedule = parseSchedule(req.body);
  if (schedule.error) return res.status(400).json({ mensaje: schedule.error });

  // El bloqueo de escritura serializa la verificación y el alta con futuras aprobaciones.
  let inTransaction = false;
  try {
    db.exec('BEGIN IMMEDIATE');
    inTransaction = true;
    const equipo = db.prepare('SELECT id, estado FROM equipos WHERE id = ?').get(equipoId);
    if (!equipo) {
      db.exec('ROLLBACK');
      inTransaction = false;
      return res.status(404).json({ mensaje: 'El equipo no existe.' });
    }
    if (equipo.estado !== 'DISPONIBLE') {
      db.exec('ROLLBACK');
      inTransaction = false;
      return res.status(409).json({ mensaje: 'El equipo no está disponible para reservas.' });
    }

    const overlappingEquipment = db.prepare(`
      SELECT 1 FROM reservas
      WHERE equipo_id = ? AND estado = 'APROBADA' AND inicio < ? AND fin > ?
      LIMIT 1
    `).get(equipoId, schedule.end, schedule.start);
    if (overlappingEquipment) {
      db.exec('ROLLBACK');
      inTransaction = false;
      return res.status(409).json({ mensaje: 'El equipo ya tiene una reserva aprobada en ese horario.' });
    }

    const overlappingStudent = db.prepare(`
      SELECT 1 FROM reservas
      WHERE usuario_id = ? AND estado = 'APROBADA' AND inicio < ? AND fin > ?
      LIMIT 1
    `).get(req.user.id, schedule.end, schedule.start);
    if (overlappingStudent) {
      db.exec('ROLLBACK');
      inTransaction = false;
      return res.status(409).json({ mensaje: 'Ya tienes otro equipo reservado en ese horario.' });
    }

    const result = db.prepare(`
      INSERT INTO reservas (usuario_id, equipo_id, inicio, fin, estado)
      VALUES (?, ?, ?, ?, 'PENDIENTE')
    `).run(req.user.id, equipoId, schedule.start, schedule.end);
    db.exec('COMMIT');
    inTransaction = false;
    return res.status(201).json({
      id: Number(result.lastInsertRowid),
      estado: 'PENDIENTE',
      mensaje: 'Solicitud registrada. Está pendiente de aprobación.',
    });
  } catch (error) {
    if (inTransaction) db.exec('ROLLBACK');
    if (/database is locked|SQLITE_BUSY/i.test(error.message)) {
      return res.status(503).json({ mensaje: 'El sistema está ocupado. Inténtalo de nuevo.' });
    }
    throw error;
  }
}

function listMyReservations(req, res) {
  const reservas = db.prepare(`
    SELECT r.id, r.equipo_id AS equipoId, e.nombre AS equipoNombre,
      e.codigo AS equipoCodigo, r.inicio, r.fin, r.estado, r.creado_en AS creadoEn
    FROM reservas r JOIN equipos e ON e.id = r.equipo_id
    WHERE r.usuario_id = ? ORDER BY r.creado_en DESC, r.id DESC
  `).all(req.user.id);
  return res.json(reservas);
}

module.exports = { createReservation, listMyReservations };
