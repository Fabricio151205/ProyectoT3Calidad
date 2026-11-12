import { useState } from 'react'

function limaToday() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Lima', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date())
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${values.year}-${values.month}-${values.day}`
}

export default function ReservationForm({ equipo, api, onCancel, onCreated }) {
  const [fecha, setFecha] = useState('')
  const [horaInicio, setHoraInicio] = useState('')
  const [horaFin, setHoraFin] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  async function submit(event) {
    event.preventDefault()
    setError('')
    if (!fecha || !horaInicio || !horaFin) {
      setError('Completa la fecha y las dos horas.')
      return
    }
    if (horaFin <= horaInicio) {
      setError('La hora de finalización debe ser posterior a la de inicio.')
      return
    }
    if (Date.parse(`${fecha}T${horaInicio}:00-05:00`) <= Date.now()) {
      setError('Selecciona una fecha y un horario futuros.')
      return
    }
    setSubmitting(true)
    try {
      const result = await api('/api/reservas', {
        method: 'POST',
        body: JSON.stringify({ equipoId: equipo.id, fecha, horaInicio, horaFin }),
      })
      onCreated(result.mensaje)
    } catch (err) {
      setError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <section className="reservation-form-panel" aria-labelledby="reservation-form-title">
      <div className="reservation-form-heading">
        <div><span className="eyebrow">Nueva solicitud</span><h3 id="reservation-form-title">Reservar {equipo.nombre}</h3></div>
        <button type="button" className="text-button" onClick={onCancel} disabled={submitting}>Cerrar</button>
      </div>
      <p>Indica el horario de tu práctica. Las horas se interpretan en la zona de Lima (UTC−05:00).</p>
      {equipo.estado === 'Prestado' && <p>Este equipo está prestado ahora. Su disponibilidad se comprobará para el horario que indiques.</p>}
      <form className="reservation-form" onSubmit={submit}>
        <div className="reservation-fields">
          <div><label htmlFor="reservation-date">Fecha</label><input id="reservation-date" type="date" min={limaToday()} value={fecha} onChange={(event) => setFecha(event.target.value)} required /></div>
          <div><label htmlFor="reservation-start">Hora de inicio</label><input id="reservation-start" type="time" value={horaInicio} onChange={(event) => setHoraInicio(event.target.value)} required /></div>
          <div><label htmlFor="reservation-end">Hora de finalización</label><input id="reservation-end" type="time" value={horaFin} onChange={(event) => setHoraFin(event.target.value)} required /></div>
        </div>
        {error && <p className="form-error" role="alert">{error}</p>}
        <button type="submit" className="primary-button" disabled={submitting}>{submitting ? 'Registrando solicitud…' : 'Enviar solicitud'}</button>
      </form>
    </section>
  )
}
