import { useEffect, useRef, useState } from 'react'

function normalized(value) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
}

export default function Returns({ api, refreshVersion }) {
  const [loans, setLoans] = useState([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busyId, setBusyId] = useState(null)
  const [refresh, setRefresh] = useState(0)
  const inFlight = useRef(new Set())

  useEffect(() => {
    let active = true
    api('/api/admin/reservas/activas')
      .then((items) => { if (active) { setLoans(items); setError('') } })
      .catch((err) => { if (active) setError(err.message) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [api, refreshVersion, refresh])

  function reload() {
    setLoading(true)
    setRefresh((value) => value + 1)
  }

  async function markReturned(item) {
    if (inFlight.current.has(item.id)) return
    if (!window.confirm(`¿Marcar la devolución de ${item.equipoNombre} por ${item.estudianteNombre}?`)) return
    inFlight.current.add(item.id)
    setBusyId(item.id)
    setError('')
    setNotice('')
    try {
      const result = await api(`/api/admin/reservas/${item.id}/devolver`, { method: 'PATCH' })
      setNotice(result.mensaje)
      reload()
    } catch (err) {
      setError(err.message)
    } finally {
      inFlight.current.delete(item.id)
      setBusyId(null)
    }
  }

  const term = normalized(search.trim())
  const visible = loans.filter((item) => normalized([
    item.estudianteNombre, item.estudianteCodigo, item.equipoNombre, item.equipoCodigo,
  ].join(' ')).includes(term))

  return (
    <section className="returns-section" aria-labelledby="returns-title">
      <div className="catalog-heading">
        <div><span className="eyebrow">Préstamos activos</span><h2 id="returns-title">Devoluciones</h2></div>
        <p>Registra la entrega física de los equipos.</p>
      </div>
      <div className="returns-search">
        <label htmlFor="returns-search">Buscar por estudiante, código o equipo</label>
        <input id="returns-search" type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Nombre, código universitario o equipo" />
      </div>
      {notice && <p className="catalog-success" role="status">{notice}</p>}
      {error && <div className="form-error" role="alert">{error}<button className="text-button" onClick={reload}>Reintentar</button></div>}
      {loading ? <p className="catalog-feedback" role="status">Cargando préstamos…</p> : loans.length === 0 ? (
        !error && <p className="catalog-feedback">No hay préstamos pendientes de devolución.</p>
      ) : visible.length === 0 ? <p className="catalog-feedback">No hay préstamos que coincidan con la búsqueda.</p> : (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead><tr><th>Estudiante</th><th>Equipo</th><th>Fecha y horario</th><th>Estado</th><th>Acción</th></tr></thead>
            <tbody>{visible.map((item) => (
              <tr key={item.id}>
                <td data-label="Estudiante"><strong>{item.estudianteNombre}</strong><small>{item.estudianteCodigo}</small></td>
                <td data-label="Equipo"><strong>{item.equipoNombre}</strong><small>{item.equipoCodigo}</small></td>
                <td data-label="Fecha y horario"><strong>{item.fecha}</strong><small>{item.horaInicio} – {item.horaFin} · Lima</small></td>
                <td data-label="Estado"><span className="reservation-status status-aprobada">Aprobada</span></td>
                <td data-label="Acción"><button type="button" className="approve-button" disabled={busyId !== null} onClick={() => markReturned(item)}>{busyId === item.id ? 'Registrando…' : 'Marcar devolución'}</button></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </section>
  )
}
