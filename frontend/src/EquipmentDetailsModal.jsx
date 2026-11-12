import { useEffect, useRef, useState } from 'react'

export default function EquipmentDetailsModal({ equipo, returnFocusTo, onClose, onReserve }) {
  const [imageFailed, setImageFailed] = useState(false)
  const dialogRef = useRef(null)
  const closeButton = useRef(null)
  const reserveButton = useRef(null)
  const openingReservation = useRef(false)
  const disponible = equipo.estado === 'Disponible'

  useEffect(() => {
    const previousFocus = document.activeElement
    const dialog = dialogRef.current
    function keepFocusInside(event) {
      if (event.key !== 'Tab') return
      if (event.shiftKey && document.activeElement === closeButton.current) {
        event.preventDefault()
        reserveButton.current?.focus()
      } else if (!event.shiftKey && document.activeElement === reserveButton.current) {
        event.preventDefault()
        closeButton.current?.focus()
      }
    }
    dialog.addEventListener('keydown', keepFocusInside)
    dialog.showModal()
    closeButton.current?.focus()
    return () => {
      dialog.removeEventListener('keydown', keepFocusInside)
      dialog.close()
      requestAnimationFrame(() => {
        if (dialog.open) return
        const target = openingReservation.current ? document.getElementById('reservation-date') : returnFocusTo || previousFocus
        if (target?.isConnected) target.focus()
      })
    }
  }, [returnFocusTo])

  return (
    <dialog ref={dialogRef} className="equipment-modal-backdrop" aria-modal="true" aria-labelledby="equipment-details-title"
      aria-describedby="equipment-details-description" onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}>
      <button type="button" className="equipment-modal-dismiss" tabIndex={-1} aria-hidden="true" onClick={onClose} />
      <section className="equipment-modal">
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
          <button ref={reserveButton} type="button" className="reserve-button" onClick={() => {
            openingReservation.current = true
            onReserve(equipo)
          }}>
            {disponible ? 'Reservar' : 'Consultar horario'}
          </button>
        </div>
      </section>
    </dialog>
  )
}
