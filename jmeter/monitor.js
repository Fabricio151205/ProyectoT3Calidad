const { spawn, spawnSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const args = process.argv.slice(2)
const option = (name, fallback) => {
  const index = args.indexOf(name)
  return index < 0 ? fallback : args[index + 1]
}
const name = option('--name', 'carga')
const samples = Number(option('--samples', '0'))
if (!/^[A-Za-z0-9_-]{1,40}$/.test(name) || !Number.isInteger(samples) || samples < 0 || samples > 3600) {
  throw new Error('Nombre o cantidad de muestras inválidos.')
}

const root = path.resolve(__dirname, '..')
const compose = path.join(root, 'compose.jmeter.yaml')
const docker = (...commands) => {
  const result = spawnSync('docker', commands, { encoding: 'utf8', cwd: root })
  if (result.error || result.status !== 0) throw new Error(result.stderr || result.error?.message || 'Docker falló.')
  return result.stdout.trim()
}
const frontend = docker('compose', '-f', compose, 'ps', '-q', 'frontend')
const backend = docker('compose', '-f', compose, 'ps', '-q', 'backend')
if (!frontend || !backend) throw new Error('Inicia primero frontend y backend de compose.jmeter.yaml.')

const directory = path.join(__dirname, 'resultados')
fs.mkdirSync(directory, { recursive: true })
const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-')
const metricsPath = path.join(directory, `${name}-${stamp}-metricas.csv`)
const errorsPath = path.join(directory, `${name}-${stamp}-errores.csv`)
const metrics = fs.createWriteStream(metricsPath, { flags: 'wx' })
const errors = fs.createWriteStream(errorsPath, { flags: 'wx' })
metrics.write('utc,intervalo_segundos,nginx_established,nginx_time_wait,nginx_hacia_backend_established,nginx_hacia_backend_time_wait,express_established,express_time_wait,nginx_cpu_pct,nginx_memoria,nginx_stats_edad_segundos,express_cpu_pct,express_memoria,express_stats_edad_segundos\n')
errors.write('utc,nginx_connect_eaddrnotavail,nginx_connect_total,nginx_http_502\n')

const children = []
let stopping = false
function start(command, commandArgs, onLine) {
  const child = spawn(command, commandArgs, { cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  children.push(child)
  for (const output of [child.stdout, child.stderr]) {
    let buffer = ''
    output.setEncoding('utf8')
    output.on('data', chunk => {
      buffer += chunk
      let end
      while ((end = buffer.indexOf('\n')) !== -1) {
        onLine(buffer.slice(0, end).trim())
        buffer = buffer.slice(end + 1)
      }
    })
  }
  child.on('error', error => { console.error(error.message); stop(1) })
  child.on('exit', code => {
    if (!stopping) { console.error(`Terminó un lector Docker (código ${code}).`); stop(1) }
  })
  return child
}

const tcp = { [frontend]: { established: 0, timeWait: 0, upstreamEstablished: 0, upstreamTimeWait: 0 }, [backend]: { established: 0, timeWait: 0 } }
function watchTcp(id) {
  let current = null
  const loop = 'while :; do printf "__SAMPLE__\\n"; cat /proc/net/tcp /proc/net/tcp6; printf "__END__\\n"; sleep 1; done'
  start('docker', ['exec', id, 'sh', '-c', loop], line => {
    if (line === '__SAMPLE__') { current = { established: 0, timeWait: 0, upstreamEstablished: 0, upstreamTimeWait: 0 }; return }
    if (line === '__END__') { if (current) tcp[id] = current; current = null; return }
    if (!current) return
    const match = line.match(/^\d+:\s+\S+\s+\S+:([0-9a-fA-F]{4})\s+([0-9a-fA-F]{2})\s/)
    if (!match) return
    const upstream = match[1].toUpperCase() === '0BB8'
    if (match[2] === '01') {
      current.established++
      if (upstream) current.upstreamEstablished++
    }
    if (match[2] === '06') {
      current.timeWait++
      if (upstream) current.upstreamTimeWait++
    }
  })
}
watchTcp(frontend)
watchTcp(backend)

const stats = { [frontend.slice(0, 12)]: {}, [backend.slice(0, 12)]: {} }
start('docker', ['stats', '--format', '{{json .}}', frontend, backend], line => {
  try {
    const item = JSON.parse(line.replace(/\x1b\[[0-9;]*[A-Za-z]/g, ''))
    if (stats[item.ID]) stats[item.ID] = { ...item, receivedAt: Date.now() }
  } catch { /* Solo se procesan filas JSON de docker stats. */ }
})

let counters = { address: 0, connects: 0, badGateway: 0 }
const since = new Date().toISOString()
start('docker', ['logs', '--follow', '--since', since, frontend], line => {
  // Los logs se procesan en memoria; nunca se guardan rutas, cookies ni cuerpos.
  if (/connect\(\).*failed/.test(line)) {
    counters.connects++
    if (/\(99: Address not available\)/.test(line)) counters.address++
  }
  if (/"\s+502\s+/.test(line)) counters.badGateway++
})

let count = 0
let previous = Date.now()
let timer
function stop(code = 0) {
  if (stopping) return
  stopping = true
  clearInterval(timer)
  for (const child of children) child.kill()
  metrics.end()
  errors.end()
  process.exitCode = code
}
process.on('SIGINT', () => stop())
process.on('SIGTERM', () => stop())

console.log(`Monitoreando solo ${frontend.slice(0, 12)} y ${backend.slice(0, 12)}. Detener con Ctrl+C.`)
console.log(`Métricas: ${metricsPath}`)
console.log(`Errores:  ${errorsPath}`)
timer = setInterval(() => {
  const now = Date.now()
  const utc = new Date(now).toISOString()
  const frontStats = stats[frontend.slice(0, 12)]
  const backStats = stats[backend.slice(0, 12)]
  const frontTcp = tcp[frontend]
  const backTcp = tcp[backend]
  const csv = values => values.map(value => `"${String(value ?? '').replaceAll('"', '""')}"`).join(',') + '\n'
  metrics.write(csv([utc, ((now - previous) / 1000).toFixed(3), frontTcp.established, frontTcp.timeWait, frontTcp.upstreamEstablished, frontTcp.upstreamTimeWait, backTcp.established, backTcp.timeWait, frontStats.CPUPerc, frontStats.MemUsage, frontStats.receivedAt ? ((now - frontStats.receivedAt) / 1000).toFixed(1) : '', backStats.CPUPerc, backStats.MemUsage, backStats.receivedAt ? ((now - backStats.receivedAt) / 1000).toFixed(1) : '']))
  errors.write(csv([utc, counters.address, counters.connects, counters.badGateway]))
  counters = { address: 0, connects: 0, badGateway: 0 }
  previous = now
  count++
  if (samples > 0 && count >= samples) stop()
}, 1000)
