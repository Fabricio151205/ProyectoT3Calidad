import { useEffect, useState } from 'react'
import Returns from './Returns'

export default function AdminReservations({ api, usuario, section, onNavigate }) {
  const [reservations, setReservations] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busyId, setBusyId] = useState(null)
  const [rejectId, setRejectId] = useState(null)
  const [reason, setReason] = useState('')
  const [refresh, setRefresh] = useState(0)

  useEffect(() => {
    let active = true
    api('/api/admin/reservas')
      .then((items) => { if (active) { setReservations(items); setError('') } })
      .catch((err) => { if (active) setError(err.message) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [api, refresh])

  function reload() {
    setLoading(true)
    setRefresh((value) => value + 1)
  }

  async function approve(item) {
    if (!window.confirm(`¿Aprobar la solicitud de ${item.estudianteNombre} para ${item.equipoNombre}?`)) return
    setBusyId(item.id)
    setNotice('')
    setError('')
    try {
      const result = await api(`/api/admin/reservas/${item.id}/aprobar`, { method: 'PATCH' })
      setNotice(result.mensaje)
      reload()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusyId(null)
    }
  }

  async function reject(event, item) {
    event.preventDefault()
    const motivo = reason.trim()
    if (!motivo) {
      setError('Escribe un motivo para rechazar la solicitud.')
      return
    }
    setBusyId(item.id)
    setNotice('')
    setError('')
    try {
      const result = await api(`/api/admin/reservas/${item.id}/rechazar`, {
        method: 'PATCH', body: JSON.stringify({ motivo }),
      })
      setNotice(result.mensaje)
      setRejectId(null)
      setReason('')
      reload()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="admin-dashboard">
      <div className="page-intro">
        <div><span className="eyebrow">Panel administrativo</span>
          <h1>{section === 'resumen' ? `Bienvenido, ${usuario.nombre}` : section === 'solicitudes' ? 'Solicitudes de reserva' : 'Devoluciones'}</h1>
          <p>{section === 'resumen' ? 'Supervisa la actividad del laboratorio desde un solo lugar.' : section === 'solicitudes' ? 'Revisa y decide sobre las solicitudes pendientes.' : 'Registra el retorno de los equipos prestados.'}</p>
        </div>
      </div>
      {section === 'resumen' && <section className="admin-overview" aria-labelledby="overview-title">
        <div className="overview-heading"><span className="eyebrow">Actividad actual</span><h2 id="overview-title">Resumen administrativo</h2></div>
        <div className="overview-grid">
          <div className="overview-card"><span>Solicitudes pendientes</span><strong>{loading ? '…' : error ? '—' : reservations.length}</strong><small>{error ? 'No se pudo actualizar el dato' : 'Esperan revisión'}</small></div>
          <div className="overview-next"><span className="overview-symbol" aria-hidden="true">↗</span><h3>Gestiona las solicitudes</h3><p>Revisa horarios, aprueba o registra un motivo de rechazo.</p><button type="button" className="primary-button" onClick={() => onNavigate('solicitudes')}>Ver solicitudes</button></div>
        </div>
        {error && <p className="form-error" role="alert">{error} <button className="text-button" type="button" onClick={reload}>Reintentar</button></p>}
      </section>}
      {section === 'solicitudes' && <>
      <section className="catalog-section" aria-labelledby="pending-title">
        <div className="catalog-heading">
          <div><span className="eyebrow">Gestión</span><h2 id="pending-title">Pendientes de revisión</h2></div>
          <p>Aprueba o rechaza cada solicitud después de revisar el horario.</p>
        </div>
        {notice && <p className="catalog-success" role="status">{notice}</p>}
        {error && <div className="form-error" role="alert">{error}{loading === false && reservations.length === 0 && <button className="text-button" onClick={reload}>Reintentar</button>}</div>}
        {loading ? <p className="catalog-feedback" role="status">Cargando solicitudes…</p> : reservations.length === 0 ? (
          !error && <p className="catalog-feedback">No hay solicitudes pendientes.</p>
        ) : (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead><tr><th>Estudiante</th><th>Equipo</th><th>Fecha y horario</th><th>Estado</th><th>Acciones</th></tr></thead>
              <tbody>
                {reservations.map((item) => (
                  <FragmentRow key={item.id} item={item} busy={busyId === item.id} locked={busyId !== null}
                    rejectOpen={rejectId === item.id} reason={reason} setReason={setReason}
                    onApprove={() => approve(item)} onReject={(event) => reject(event, item)}
                    onOpenReject={() => { setRejectId(item.id); setReason(''); setError('') }}
                    onCancelReject={() => { setRejectId(null); setReason('') }} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      </>}
      {section === 'devoluciones' && <Returns api={api} refreshVersion={refresh} />}
    </div>
  )
}

function FragmentRow({ item, busy, locked, rejectOpen, reason, setReason, onApprove, onReject, onOpenReject, onCancelReject }) {
  return (
    <>
      <tr>
        <td data-label="Estudiante"><strong>{item.estudianteNombre}</strong><small>{item.estudianteCodigo}</small></td>
        <td data-label="Equipo"><strong>{item.equipoNombre}</strong><small>{item.equipoCodigo}</small></td>
        <td data-label="Fecha y horario"><strong>{item.fecha}</strong><small>{item.horaInicio} – {item.horaFin} · Lima</small></td>
        <td data-label="Estado"><span className="reservation-status">Pendiente</span></td>
        <td data-label="Acciones" className="admin-actions">
          <button type="button" className="approve-button" disabled={locked} onClick={onApprove}>{busy ? 'Procesando…' : 'Aprobar'}</button>
          <button type="button" className="reject-button" disabled={locked} onClick={onOpenReject}>Rechazar</button>
        </td>
      </tr>
      {rejectOpen && <tr className="reject-form-row"><td colSpan="5">
        <form onSubmit={onReject}>
          <label htmlFor={`reject-reason-${item.id}`}>Motivo del rechazo</label>
          <textarea id={`reject-reason-${item.id}`} value={reason} onChange={(event) => setReason(event.target.value)} maxLength="500" required placeholder="Escribe una justificación breve" />
          <div><button className="reject-button" type="submit" disabled={locked}>{busy ? 'Guardando…' : 'Confirmar rechazo'}</button><button className="text-button" type="button" disabled={locked} onClick={onCancelReject}>Cancelar</button></div>
        </form>
      </td></tr>}
    </>
  )
}
