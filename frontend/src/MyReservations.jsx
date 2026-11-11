import { useEffect, useState } from 'react'

const dateTime = new Intl.DateTimeFormat('es-PE', {
  timeZone: 'America/Lima', dateStyle: 'medium', timeStyle: 'short',
})

export default function MyReservations({ api, refreshVersion }) {
  const [reservations, setReservations] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)

  useEffect(() => {
    let active = true
    api('/api/mis-reservas')
      .then((items) => { if (active) { setReservations(items); setError('') } })
      .catch((err) => { if (active) setError(err.message) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [api, refreshVersion, retry])

  useEffect(() => {
    function refreshOnFocus() { setLoading(true); setRetry((value) => value + 1) }
    function refreshOnVisible() {
      if (document.visibilityState === 'visible') refreshOnFocus()
    }
    window.addEventListener('focus', refreshOnFocus)
    document.addEventListener('visibilitychange', refreshOnVisible)
    return () => {
      window.removeEventListener('focus', refreshOnFocus)
      document.removeEventListener('visibilitychange', refreshOnVisible)
    }
  }, [])

  function retryLoad() {
    setError('')
    setLoading(true)
    setRetry((value) => value + 1)
  }

  return (
    <section className="my-reservations" aria-labelledby="my-reservations-title">
      <div className="catalog-heading"><div><span className="eyebrow">Seguimiento</span><h2 id="my-reservations-title">Mis reservas</h2></div><button type="button" className="text-button" onClick={retryLoad}>Actualizar</button></div>
      {loading ? <p className="catalog-feedback" role="status">Cargando reservas…</p> : error ? (
        <div className="catalog-feedback" role="alert"><p>No se pudieron cargar las reservas: {error}</p><button className="secondary-button" onClick={retryLoad}>Reintentar</button></div>
      ) : reservations.length === 0 ? <p className="catalog-feedback">Aún no tienes solicitudes de reserva.</p> : (
        <div className="reservation-list">
          {reservations.map((item) => (
            <article className="reservation-item" key={item.id}>
              <div><h3>{item.equipoNombre}</h3><p>{item.equipoCodigo} · {dateTime.format(new Date(item.inicio))} – {dateTime.format(new Date(item.fin))}</p></div>
              <span className={`reservation-status status-${item.estado.toLowerCase()}`}>{item.estado.charAt(0) + item.estado.slice(1).toLowerCase()}</span>
            </article>
          ))}
        </div>
      )}
    </section>
  )
}
