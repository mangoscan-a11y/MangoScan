# One-command control for the MangoScan machine software. Run from WebApp/:
#   npm run up        real ESP32 boards, real Model 0 detector, Models 1-4 simulated
#   npm run up:mock   no hardware: fake boards that serve the test photos
#   npm run down      stop everything
param([Parameter(Mandatory)][ValidateSet('start', 'mock', 'stop')][string]$Action)

$webapp = Split-Path $PSScriptRoot -Parent

function Fail($message) { Write-Host $message -ForegroundColor Red; exit 1 }

# Every MangoScan process that is running: the launcher first, then the models service and the server.
# Matching on the command line (not on ports) means a different app on port 4000 is never touched.
function Get-Machine {
    Get-CimInstance Win32_Process |
        Where-Object { $_.CommandLine -match 'start-all\.mjs|fusion\.service|MangoScan.*server[\\/]index\.ts' } |
        Sort-Object { $_.CommandLine -notmatch 'start-all' }
}

if ($Action -eq 'stop') {
    $running = @(Get-Machine)
    if (-not $running) { 'MangoScan is not running.'; exit 0 }
    $running | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
    Start-Sleep -Milliseconds 800
    if (@(Get-Machine)) { Fail 'Some MangoScan processes are still running.' }
    "MangoScan stopped ($($running.Count) processes)."
    exit 0
}

if (@(Get-Machine)) { Fail 'MangoScan is already running. Run "npm run down" first.' }

# Defaults for this laptop. Set the variable first to override.
if (-not $env:MODELS_PYTHON) { $env:MODELS_PYTHON = 'C:\MangoScan\venv\Scripts\python.exe' }
if (-not (Test-Path $env:MODELS_PYTHON)) { Fail "Models Python not found: $env:MODELS_PYTHON" }

Set-Location $webapp
if ($Action -eq 'mock') {
    if (-not $env:MOCK_IMAGE_DIR) { $env:MOCK_IMAGE_DIR = 'C:\MangoScan\testphotos\vga' }
    if (-not (Test-Path $env:MOCK_IMAGE_DIR)) { Fail "Test photos not found: $env:MOCK_IMAGE_DIR" }
    npm run machine:mock -- --models=my_models
} else {
    # The controller's CP2102 USB link is only reliable at 115200 baud (esptool fails above that), while the
    # camera board's CH343 runs the default 921600. Boards are matched by USB vendor id (10c4 = CP2102).
    if (-not $env:SERIAL_ADAPTER_BAUDS) { $env:SERIAL_ADAPTER_BAUDS = '10c4:115200' }
    npm run machine -- --models=my_models
}
exit $LASTEXITCODE
