# One-command local demo: chain -> deploy -> seed -> relayer -> frontend.
# Usage (from this folder):  powershell -ExecutionPolicy Bypass -File .\start-local.ps1
# Each service opens in its own window. Close those windows to stop everything.
$ErrorActionPreference = "Stop"
$root = $PSScriptRoot

foreach ($dir in "contracts", "relayer", "frontend") {
  if (-not (Test-Path "$root\$dir\node_modules")) {
    Write-Host "Installing $dir dependencies..." -ForegroundColor Cyan
    Push-Location "$root\$dir"; npm install; Pop-Location
  }
}

Write-Host "Starting local Hardhat chain..." -ForegroundColor Cyan
Start-Process powershell -ArgumentList "-NoExit", "-Command", "`$host.UI.RawUI.WindowTitle='Hardhat chain'; cd '$root\contracts'; npx hardhat node"

# Wait until the RPC answers.
$body = '{"jsonrpc":"2.0","method":"eth_chainId","params":[],"id":1}'
for ($i = 0; $i -lt 60; $i++) {
  try { Invoke-RestMethod -Uri http://127.0.0.1:8545 -Method Post -Body $body -ContentType "application/json" | Out-Null; break } catch { Start-Sleep -Seconds 1 }
}

Write-Host "Deploying contracts and seeding the demo organisation..." -ForegroundColor Cyan
Push-Location "$root\contracts"
npx hardhat run scripts/deploy.js --network localhost
npx hardhat run scripts/seed-demo.js --network localhost
Pop-Location

Write-Host "Starting relayer and frontend..." -ForegroundColor Cyan
Start-Process powershell -ArgumentList "-NoExit", "-Command", "`$host.UI.RawUI.WindowTitle='Relayer'; cd '$root\relayer'; npm start"
Start-Process powershell -ArgumentList "-NoExit", "-Command", "`$host.UI.RawUI.WindowTitle='Frontend'; cd '$root\frontend'; npm run dev"

Start-Sleep -Seconds 4
Start-Process "http://localhost:5173"
Write-Host "`nReady: http://localhost:5173" -ForegroundColor Green
