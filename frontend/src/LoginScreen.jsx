export default function LoginScreen({ codigo, setCodigo, password, setPassword, showPassword, setShowPassword, error, alerta, enviando, onSubmit }) {
  return (
    <div className="login-page">
      <main className="login-layout">
        <section className="intro-panel" aria-label="Bienvenida a LabTrack">
          <div className="intro-brand"><span className="brand-icon"><img src="/labtrack-logo.png" alt="" /></span><span>LabTrack</span></div>
          <div className="intro-copy">
            <span className="eyebrow">GESTIÓN DE LABORATORIOS</span>
            <h1>Tu laboratorio,<br />mejor conectado.</h1>
            <p>Un espacio para consultar equipos, organizar reservas y mantener cada práctica en movimiento.</p>
          </div>
          <div className="lab-illustration" aria-hidden="true">
            <div className="illustration-orbit orbit-one" /><div className="illustration-orbit orbit-two" />
            <div className="illustration-screen"><span className="screen-line long" /><span className="screen-line" /><span className="screen-cards"><i /><i /><i /></span><span className="screen-line short" /></div>
            <div className="illustration-chip">LT<span>LAB</span></div>
            <div className="illustration-dot dot-one" /><div className="illustration-dot dot-two" />
          </div>
          <p className="intro-footer">Tecnología al servicio de cada práctica.</p>
        </section>
        <section className="login-card" aria-labelledby="login-title">
          <div className="login-form-wrap">
            <span className="login-welcome">Bienvenido de nuevo</span>
            <h2 id="login-title">Iniciar sesión</h2>
            <p className="form-description">Ingresa con tu código y contraseña institucional para continuar.</p>
            <form onSubmit={onSubmit}>
              <label htmlFor="codigo">Código universitario</label>
              <input id="codigo" name="codigo" autoComplete="username" placeholder="Tu código universitario" value={codigo}
                onChange={(event) => setCodigo(event.target.value)} required />
              <label htmlFor="password">Contraseña</label>
              <div className="password-field">
                <input id="password" name="password" type={showPassword ? 'text' : 'password'} autoComplete="current-password" placeholder="Ingresa tu contraseña"
                  value={password} onChange={(event) => setPassword(event.target.value)} required />
                <button type="button" className="password-toggle" aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'} aria-pressed={showPassword}
                  onClick={() => setShowPassword((value) => !value)}>{showPassword ? 'Ocultar' : 'Mostrar'}</button>
              </div>
              {error && <p className="form-error" role="alert">{error}</p>}
              {alerta && <p className="form-error" role="alert">{alerta}</p>}
              <button className="primary-button login-submit" type="submit" disabled={enviando}>
                {enviando && <span className="loading-spinner" aria-hidden="true" />}{enviando ? 'Verificando…' : 'Iniciar sesión'}
              </button>
            </form>
            <p className="form-footnote">Tras tres intentos fallidos, la cuenta se bloquea durante cinco minutos.</p>
          </div>
          <span className="login-card-footer">LabTrack · Gestión de equipos de laboratorio</span>
        </section>
      </main>
    </div>
  )
}
