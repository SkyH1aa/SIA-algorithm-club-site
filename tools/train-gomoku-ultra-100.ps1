# 100 NEW local self-play games, then head training, then two color-swapped
# games against the ORIGINAL shipped weights. Never changes the website.
$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
$taskPython = Join-Path $taskRoot 'training/gomoku-nnue/.venv/Scripts/python.exe'
if (-not (Test-Path -LiteralPath $taskPython)) {
    throw 'Run python tools/setup-gomoku-nnue.py first.'
}
& $taskPython (Join-Path $PSScriptRoot 'train-gomoku-ultra-selfplay.py') `
    --games 100 --cycles 1 --steps 2000 --batch 32 `
    --selfplay-ms 2000 --selfplay-depth 24 `
    --teacher-ms 10000 --teacher-depth 32 `
    --compare-initial --comparison-pairs 1 `
    --arena-ms 75000 --arena-depth 12 --skip-arena
if ($LASTEXITCODE -ne 0) { throw "Local training failed: $LASTEXITCODE" }
Write-Host 'Complete. See training/gomoku-nnue/runs/<timestamp>/initial-comparison.json and manifest.json.'
