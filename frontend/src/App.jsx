import { useEffect, useState } from 'react'
import EquipmentCatalog from './EquipmentCatalog'
import MyReservations from './MyReservations'
import AdminReservations from './AdminReservations'
import DashboardLayout from './DashboardLayout'
import LoginScreen from './LoginScreen'
import './App.css'

const studentSections = [
  { id: 'catalogo', label: 'Catálogo de equipos', icon: 'box' },
  { id: 'mis-reservas', label: 'Mis reservas', icon: 'list' },
]
const adminSections = [
  { id: 'resumen', label: 'Resumen', icon: 'grid' },
  { id: 'solicitudes', label: 'Solicitudes', icon: 'list' },
  { id: 'devoluciones', label: 'Devoluciones', icon: 'return' },
]

async function api(path, options = {}) {
  let response
  try {
    response = await fetch(path, {
      credentials: 'same-origin',
      ...options,
      headers: { 'Content-Type': 'application/json', ...options.headers },
    })
  } catch {
    throw new Error('No se pudo conectar con el servidor.')
  }
  const data = response.status === 204 ? null : await response.json().catch(() => null)
  if (!response.ok) {
    const error = new Error(data?.mensaje || 'No se pudo completar la solicitud')
    error.status = response.status
    error.alerta = data?.alerta || ''
    throw error
  }
  return data
}

function App() {
  const [usuario, setUsuario] = useState(null)
  const [cargando, setCargando] = useState(true)
  const [enviando, setEnviando] = useState(false)
  const [codigo, setCodigo] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [section, setSection] = useState('catalogo')
  const [error, setError] = useState('')
  const [alerta, setAlerta] = useState('')
  const [reservationsVersion, setReservationsVersion] = useState(0)

  useEffect(() => {
    api('/api/auth/me').then(({ usuario: actual }) => setUsuario(actual))
      .catch(() => {}).finally(() => setCargando(false))
    function refreshSession() {
      api('/api/auth/me').then(({ usuario: actual }) => setUsuario(actual))
        .catch((err) => { if (err.status === 401) setUsuario(null) })
    }
    function onVisibility() {
      if (document.visibilityState === 'visible') refreshSession()
    }
    window.addEventListener('focus', refreshSession)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('focus', refreshSession)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [])

  async function iniciarSesion(event) {
    event.preventDefault()
    setError('')
    setAlerta('')
    setEnviando(true)
    try {
      const data = await api('/api/auth/login', {
        method: 'POST', body: JSON.stringify({ codigo, password }),
      })
      setUsuario(data.usuario)
      setSection(data.usuario.rol === 'ESTUDIANTE' ? 'catalogo' : 'resumen')
      setPassword('')
    } catch (err) {
      setError(err.message)
      setAlerta(err.alerta || '')
    } finally {
      setEnviando(false)
    }
  }

  async function cerrarSesion() {
    try {
      await api('/api/auth/logout', { method: 'POST' })
      setUsuario(null)
      setCodigo('')
      setAlerta('')
      setError('')
      setSection('catalogo')
    } catch (err) {
      setError(err.message)
    }
  }

  if (cargando) return <div className="session-loading" role="status"><span className="loading-spinner" />Cargando sesión…</div>

  if (!usuario) return <LoginScreen codigo={codigo} setCodigo={setCodigo} password={password} setPassword={setPassword}
    showPassword={showPassword} setShowPassword={setShowPassword} error={error} alerta={alerta} enviando={enviando} onSubmit={iniciarSesion} />

  const isStudent = usuario.rol === 'ESTUDIANTE'
  const sections = isStudent ? studentSections : adminSections
  const selected = sections.some((item) => item.id === section) ? section : sections[0].id
  return (
    <DashboardLayout usuario={usuario} sections={sections} section={selected} onSectionChange={setSection} onLogout={cerrarSesion}>
      {error && <p className="form-error" role="alert">{error}</p>}
      {isStudent ? (
        <div className="student-dashboard">
          <div className="page-intro"><div><span className="eyebrow">Panel estudiantil</span>
            <h1>{selected === 'catalogo' ? 'Explora el laboratorio' : 'Mis reservas'}</h1>
            <p>{selected === 'catalogo' ? 'Encuentra el equipo que necesitas para tu próxima práctica.' : 'Consulta el progreso de tus solicitudes.'}</p></div>
            <span className={`account-state ${usuario.estadoEstudiante === 'PENALIZADO' ? 'is-penalized' : ''}`}>Estado: {usuario.estadoEstudiante}</span>
          </div>
          {selected === 'catalogo' ? <EquipmentCatalog api={api} onReserved={() => setReservationsVersion((value) => value + 1)} />
            : <MyReservations api={api} refreshVersion={reservationsVersion} />}
        </div>
      ) : <AdminReservations api={api} usuario={usuario} section={selected} onNavigate={setSection} />}
    </DashboardLayout>
  )
}

export default App
