import { useEffect, useRef, useState } from 'react'

export default function EquipmentDetailsModal({ equipo, onClose, onReserve }) {
  const [imageFailed, setImageFailed] = useState(false)
  const closeButton = useRef(null)
  const disponible = equipo.estado === 'Disponible'

  useEffect(() => {
    const previousFocus = document.activeElement
    closeButton.current?.focus()
    function onKeyDown(event) {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      previousFocus?.focus?.()
    }
  }, [onClose])

  return (
    <div className="equipment-modal-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose()
    }}>
      <section className="equipment-modal" role="dialog" aria-modal="true"
        aria-labelledby="equipment-details-title" aria-describedby="equipment-details-description">
        <div className="equipment-modal-image">
          {equipo.imagen_url && !imageFailed ? (
            <img src={equipo.imagen_url} alt={equipo.nombre} onError={() => setImageFailed(true)} />
          ) : <span className="equipment-image-placeholder">Imagen no disponible</span>}
        </div>
        <div className="equipment-modal-content">
          <div className="equipment-modal-header">
            <span className="eyebrow">Detalle del equipo</span>
            <button ref={closeButton} type="button" className="secondary-button" onClick={onClose}>Cerrar</button>
          </div>
          <h2 id="equipment-details-title">{equipo.nombre}</h2>
          <div className="equipment-modal-tags">
            <span className="equipment-category">{equipo.categoria}</span>
            <span className={`equipment-status ${disponible ? 'is-available' : 'is-borrowed'}`}>
              <span aria-hidden="true" className="status-dot" />{equipo.estado}
            </span>
          </div>
          <p className="equipment-modal-label">Código de inventario</p>
          <strong className="equipment-code">{equipo.codigo}</strong>
          <p id="equipment-details-description" className="equipment-modal-description">
            {equipo.descripcion || 'Descripción no disponible'}
          </p>
          <button type="button" className="reserve-button" onClick={() => onReserve(equipo)}>
            {disponible ? 'Reservar' : 'Consultar horario'}
          </button>
        </div>
      </section>
    </div>
  )
}
