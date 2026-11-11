import { useState } from 'react'

const icons = {
  grid: <><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></>,
  list: <><rect x="4" y="4" width="16" height="16" rx="2" /><path d="M8 9h8M8 13h8M8 17h5" /></>,
  box: <><path d="m12 2 9 5-9 5-9-5 9-5ZM3 7v10l9 5 9-5V7M12 12v10" /></>,
  return: <><path d="M20 7v6a5 5 0 0 1-5 5H4m0 0 4-4m-4 4 4 4M4 7h11" /></>,
}

function NavIcon({ name }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{icons[name]}</svg>
}

export default function DashboardLayout({ usuario, sections, section, onSectionChange, onLogout, children }) {
  const [menuOpen, setMenuOpen] = useState(false)
  const current = sections.find((item) => item.id === section) || sections[0]
  const isAdmin = usuario.rol === 'ADMINISTRADOR'

  function navigate(id) {
    onSectionChange(id)
    setMenuOpen(false)
  }

  return (
    <div className="dashboard-shell">
      {menuOpen && <button className="sidebar-scrim" type="button" aria-label="Cerrar menú" onClick={() => setMenuOpen(false)} />}
      <aside className={`dashboard-sidebar ${menuOpen ? 'is-open' : ''}`} aria-label="Navegación principal">
        <div className="sidebar-brand"><span className="brand-icon"><img src="/labtrack-logo.png" alt="" /></span><span>LabTrack<small>GESTIÓN DE LABORATORIOS</small></span></div>
        <div className="sidebar-label">ESPACIO DE TRABAJO</div>
        <nav className="sidebar-nav" aria-label="Secciones">
          {sections.map((item) => (
            <button key={item.id} type="button" className={`sidebar-link ${section === item.id ? 'is-active' : ''}`}
              aria-current={section === item.id ? 'page' : undefined} onClick={() => navigate(item.id)}>
              <NavIcon name={item.icon} /><span>{item.label}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom"><span className="sidebar-bottom-dot" /> Laboratorio universitario</div>
      </aside>

      <div className="dashboard-workspace">
        <header className="dashboard-topbar">
          <div className="topbar-leading">
            <button className="menu-toggle" type="button" aria-label={menuOpen ? 'Cerrar menú' : 'Abrir menú'}
              aria-expanded={menuOpen} onClick={() => setMenuOpen((value) => !value)}>
              <span /><span /><span />
            </button>
            <div><span className="topbar-kicker">LabTrack / {isAdmin ? 'Administración' : 'Estudiantes'}</span><strong>{current.label}</strong></div>
          </div>
          <div className="topbar-actions">
            <div className="user-identity"><span className="user-avatar" aria-hidden="true">{usuario.nombre.charAt(0).toUpperCase()}</span><span><strong>{usuario.nombre}</strong><small>{isAdmin ? 'Administrador' : 'Estudiante'} · {usuario.codigo}</small></span></div>
            <button className="logout-button" type="button" onClick={onLogout}>Cerrar sesión</button>
          </div>
        </header>
        <main className="dashboard-content" id="main-content" key={section}>
          {children}
        </main>
      </div>
    </div>
  )
}
