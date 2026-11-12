param(
    [ValidatePattern('^[A-Za-z0-9_-]{1,40}$')]
    [string]$Nombre = 'carga',

    [ValidateRange(0, 3600)]
    [int]$Muestras = 0
)

$script = Join-Path $PSScriptRoot 'monitor.js'
& node $script --name $Nombre --samples $Muestras
if ($LASTEXITCODE -ne 0) {
    throw "El monitor terminó con código $LASTEXITCODE."
}
