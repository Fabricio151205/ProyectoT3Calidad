const { db } = require('./db');

function reservationId(req, res) {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id <= 0 || String(id) !== req.params.id) {
    res.status(400).json({ mensaje: 'ID de reserva inválido.' });
    return null;
  }
  return id;
}

function withTransaction(res, action) {
  let open = false;
  try {
    db.exec('BEGIN IMMEDIATE');
    open = true;
    const result = action();
    db.exec(result.status < 400 ? 'COMMIT' : 'ROLLBACK');
    open = false;
    return res.status(result.status).json(result.body);
  } catch (error) {
    if (open) db.exec('ROLLBACK');
    if (/database is locked|SQLITE_BUSY/i.test(error.message)) {
      return res.status(503).json({ mensaje: 'El sistema está ocupado. Inténtalo de nuevo.' });
    }
    if (/Equipo reservado en ese horario|Estudiante con otra reserva simultánea/.test(error.message)) {
      return res.status(409).json({ mensaje: 'La solicitud entra en conflicto con otra reserva aprobada.' });
    }
    throw error;
  }
}

const listAdminReservations = db.prepare(`
    SELECT r.id, u.nombre AS estudianteNombre, u.codigo AS estudianteCodigo,
      e.nombre AS equipoNombre, e.codigo AS equipoCodigo,
      date(r.inicio, '-5 hours') AS fecha,
      strftime('%H:%M', r.inicio, '-5 hours') AS horaInicio,
      strftime('%H:%M', r.fin, '-5 hours') AS horaFin,
      r.estado
    FROM reservas r
    JOIN usuarios u ON u.id = r.usuario_id
    JOIN equipos e ON e.id = r.equipo_id
    WHERE r.estado = ? AND u.rol = 'ESTUDIANTE'
      AND (? = 'PENDIENTE' OR r.inicio <= ?)
    ORDER BY r.inicio, r.id
`);

function listPending(req, res) {
  return res.json(listAdminReservations.all('PENDIENTE', 'PENDIENTE', new Date().toISOString().slice(0, 19) + 'Z'));
}

function listActive(req, res) {
  return res.json(listAdminReservations.all('APROBADA', 'APROBADA', new Date().toISOString().slice(0, 19) + 'Z'));
}

function approve(req, res) {
  const id = reservationId(req, res);
  if (id === null) return;
  return withTransaction(res, () => {
    const reservation = db.prepare(`
      SELECT r.id, r.usuario_id, r.equipo_id, r.inicio, r.fin, r.estado,
        e.estado AS equipoEstado
      FROM reservas r JOIN equipos e ON e.id = r.equipo_id WHERE r.id = ?
    `).get(id);
    if (!reservation) return { status: 404, body: { mensaje: 'La solicitud no existe.' } };
    if (reservation.estado !== 'PENDIENTE') {
      return { status: 409, body: { mensaje: 'La solicitud ya fue procesada.' } };
    }
    if (reservation.equipoEstado !== 'DISPONIBLE') {
      return { status: 409, body: { mensaje: 'El equipo no está disponible.' } };
    }

    const equipmentConflict = db.prepare(`
      SELECT 1 FROM reservas WHERE id != ? AND equipo_id = ? AND estado = 'APROBADA'
        AND inicio < ? AND fin > ? LIMIT 1
    `).get(id, reservation.equipo_id, reservation.fin, reservation.inicio);
    if (equipmentConflict) {
      return { status: 409, body: { mensaje: 'El equipo ya tiene una reserva aprobada en ese horario.' } };
    }

    const studentConflict = db.prepare(`
      SELECT 1 FROM reservas WHERE id != ? AND usuario_id = ? AND estado = 'APROBADA'
        AND inicio < ? AND fin > ? LIMIT 1
    `).get(id, reservation.usuario_id, reservation.fin, reservation.inicio);
    if (studentConflict) {
      return { status: 409, body: { mensaje: 'El estudiante ya tiene otro equipo aprobado en ese horario.' } };
    }

    const now = new Date().toISOString();
    const update = db.prepare(`
      UPDATE reservas SET estado = 'APROBADA', aprobada_en = ?, actualizado_en = ?
      WHERE id = ? AND estado = 'PENDIENTE'
    `).run(now, now, id);
    if (update.changes !== 1) return { status: 409, body: { mensaje: 'La solicitud ya fue procesada.' } };
    return { status: 200, body: { id, estado: 'APROBADA', mensaje: 'Solicitud aprobada correctamente.' } };
  });
}

function reject(req, res) {
  const id = reservationId(req, res);
  if (id === null) return;
  const reason = typeof req.body?.motivo === 'string' ? req.body.motivo.trim() : '';
  if (!reason || reason.length > 500) {
    return res.status(400).json({ mensaje: 'Escribe un motivo de rechazo válido (máximo 500 caracteres).' });
  }
  return withTransaction(res, () => {
    const reservation = db.prepare('SELECT estado FROM reservas WHERE id = ?').get(id);
    if (!reservation) return { status: 404, body: { mensaje: 'La solicitud no existe.' } };
    if (reservation.estado !== 'PENDIENTE') {
      return { status: 409, body: { mensaje: 'La solicitud ya fue procesada.' } };
    }
    const now = new Date().toISOString();
    const update = db.prepare(`
      UPDATE reservas SET estado = 'RECHAZADA', motivo_rechazo = ?, actualizado_en = ?
      WHERE id = ? AND estado = 'PENDIENTE'
    `).run(reason, now, id);
    if (update.changes !== 1) return { status: 409, body: { mensaje: 'La solicitud ya fue procesada.' } };
    return { status: 200, body: { id, estado: 'RECHAZADA', mensaje: 'Solicitud rechazada correctamente.' } };
  });
}

function registerReturn(req, res) {
  const id = reservationId(req, res);
  if (id === null) return;
  return withTransaction(res, () => {
    const reservation = db.prepare(`
      SELECT r.estado, r.devuelta_en, r.inicio, r.fin, r.usuario_id,
        u.estado_estudiante AS estadoEstudiante
      FROM reservas r JOIN usuarios u ON u.id = r.usuario_id WHERE r.id = ?
    `).get(id);
    if (!reservation) return { status: 404, body: { mensaje: 'La reserva no existe.' } };
    if (reservation.estado !== 'APROBADA' || reservation.devuelta_en !== null) {
      return { status: 409, body: { mensaje: 'La reserva no está aprobada o ya fue devuelta.' } };
    }
    // El reloj se puede sustituir desde el proceso de QA; nunca se lee del cliente HTTP.
    const returnedAt = (req.app?.locals?.returnClock?.() ?? new Date()).toISOString();
    if (reservation.inicio > returnedAt.slice(0, 19) + 'Z') {
      return { status: 409, body: { mensaje: 'El préstamo aún no ha comenzado.' } };
    }

    // UTC con milisegundos conserva el instante real; la interfaz lo muestra en Lima.
    const update = db.prepare(`
      UPDATE reservas SET estado = 'DEVUELTA', devuelta_en = ?, actualizado_en = ?
      WHERE id = ? AND estado = 'APROBADA' AND devuelta_en IS NULL
    `).run(returnedAt, returnedAt, id);
    if (update.changes !== 1) {
      return { status: 409, body: { mensaje: 'La reserva ya fue devuelta.' } };
    }

    // El disparador de SQLite actualiza retraso y estado del estudiante en esta transacción.
    const persisted = db.prepare(`
      SELECT r.retraso, u.estado_estudiante AS estadoEstudiante
      FROM reservas r JOIN usuarios u ON u.id = r.usuario_id WHERE r.id = ?
    `).get(id);
    const late = persisted.retraso === 1;
    const penaltyApplied = late && reservation.estadoEstudiante !== 'PENALIZADO' &&
      persisted.estadoEstudiante === 'PENALIZADO';
    return {
      status: 200,
      body: {
        id, estado: 'DEVUELTA', devueltaEn: returnedAt,
        retraso: late, penalizacionAplicada: penaltyApplied,
        mensaje: late
          ? 'Devolución registrada con retraso. El estudiante está penalizado.'
          : 'Devolución registrada a tiempo.',
      },
    };
  });
}

module.exports = { listPending, listActive, approve, reject, registerReturn };
