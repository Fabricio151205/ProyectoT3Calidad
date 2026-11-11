import { useEffect, useState } from 'react'
import ReservationForm from './ReservationForm'

const filters = ['Todos', 'Cómputo', 'Electrónica', 'Redes']

function EquipmentCard({ equipo, onReserve }) {
  const disponible = equipo.estado === 'Disponible'
  const [imageFailed, setImageFailed] = useState(false)
  return (
    <article className="equipment-card">
      <div className="equipment-image">
        {equipo.imagen_url && !imageFailed ? (
          <img src={equipo.imagen_url} alt={equipo.nombre} loading="lazy" onError={() => setImageFailed(true)} />
        ) : <span className="equipment-image-placeholder">Imagen no disponible</span>}
      </div>
      <div className="equipment-card-top">
        <span className="equipment-category">{equipo.categoria}</span>
        <span className={`equipment-status ${disponible ? 'is-available' : 'is-borrowed'}`}>
          <span aria-hidden="true" className="status-dot" />{equipo.estado}
        </span>
      </div>
      <h3>{equipo.nombre}</h3>
      <p>Código de inventario</p>
      <strong className="equipment-code">{equipo.codigo}</strong>
      {disponible && <button type="button" className="reserve-button" onClick={() => onReserve(equipo)}>Reservar</button>}
    </article>
  )
}

export default function EquipmentCatalog({ api, onReserved }) {
  const [filter, setFilter] = useState('Todos')
  const [equipment, setEquipment] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  const [selected, setSelected] = useState(null)
  const [notice, setNotice] = useState('')

  useEffect(() => {
    let active = true
    const category = filter === 'Todos' ? '' : `?categoria=${encodeURIComponent(filter)}`
    api(`/api/equipos${category}`)
      .then((items) => { if (active) { setEquipment(items); setError('') } })
      .catch((err) => { if (active) setError(err.message) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [api, filter, retry])

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

  function selectFilter(value) {
    if (value === filter) return
    setFilter(value)
    setEquipment([])
    setError('')
    setLoading(true)
  }

  function retryLoad() {
    setError('')
    setLoading(true)
    setRetry((value) => value + 1)
  }

  function created(message) {
    setSelected(null)
    setNotice(message)
    onReserved()
  }

  return (
    <section className="catalog-section" aria-labelledby="catalog-title">
      <div className="catalog-heading">
        <div><span className="eyebrow">Inventario</span><h2 id="catalog-title">Catálogo de equipos</h2></div>
        <p>Explora los equipos del laboratorio por categoría.</p>
      </div>
      <div className="catalog-filters" role="group" aria-label="Filtrar por categoría">
        {filters.map((item) => (
          <button key={item} type="button" className={filter === item ? 'filter-button active' : 'filter-button'}
            aria-pressed={filter === item} onClick={() => selectFilter(item)}>{item}</button>
        ))}
      </div>
      {notice && <p className="catalog-success" role="status">{notice}</p>}
      {selected && <ReservationForm key={selected.id} equipo={selected} api={api} onCancel={() => setSelected(null)} onCreated={created} />}
      {loading ? <p className="catalog-feedback" role="status">Cargando equipos…</p> : error ? (
        <div className="catalog-feedback" role="alert">
          <p>No se pudieron cargar los equipos: {error}</p>
          <button type="button" className="secondary-button" onClick={retryLoad}>Reintentar</button>
        </div>
      ) : equipment.length === 0 ? (
        <p className="catalog-feedback">No hay equipos disponibles en esta categoría</p>
      ) : (
        <div className="equipment-grid">
          {equipment.map((item) => <EquipmentCard key={item.codigo} equipo={item} onReserve={(equipo) => { setNotice(''); setSelected(equipo) }} />)}
        </div>
      )}
    </section>
  )
}
