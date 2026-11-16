# One-command Sepolia demo: (first run only) deploy + seed -> relayer -> frontend.
# Usage (from this folder):  powershell -ExecutionPolicy Bypass -File .\start-sepolia.ps1
# Before the first run: paste your testnet private key into contracts\.env and get free Sepolia ETH.
$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
$envFile = "$root\contracts\.env"

function Fail($msg) { Write-Host "`n$msg`n" -ForegroundColor Red; exit 1 }

# 1. Check the key is filled in.
if (-not (Test-Path $envFile)) { Fail "contracts\.env is missing. Copy contracts\.env.example to contracts\.env and add your key." }
$keyLine = Select-String -Path $envFile -Pattern '^\s*DEPLOYER_PRIVATE_KEY\s*=\s*(\S+)' | Select-Object -First 1
if (-not $keyLine) { Fail "Open contracts\.env in Notepad and paste your private key after DEPLOYER_PRIVATE_KEY=  then save and run this again." }
$key = $keyLine.Matches[0].Groups[1].Value -replace '^0x', ''
if ($key -notmatch '^[0-9a-fA-F]{64}$') { Fail "The key in contracts\.env doesn't look right. It should be 64 hex characters (0-9, a-f), optionally starting with 0x." }

# 2. Install dependencies if needed.
foreach ($dir in "contracts", "relayer", "frontend") {
  if (-not (Test-Path "$root\$dir\node_modules")) {
    Write-Host "Installing $dir dependencies..." -ForegroundColor Cyan
    Push-Location "$root\$dir"; npm install; Pop-Location
  }
}

# 3. Deploy + seed, only if this project isn't on Sepolia yet.
$depFile = "$root\deployments\deployments.json"
$deployed = (Test-Path $depFile) -and ((Get-Content $depFile -Raw | ConvertFrom-Json).PSObject.Properties.Name -contains "11155111")
if (-not $deployed) {
  Write-Host "Deploying contracts to Sepolia (takes 1-3 minutes)..." -ForegroundColor Cyan
  Push-Location "$root\contracts"
  npx hardhat run scripts/deploy.js --network sepolia
  if ($LASTEXITCODE -ne 0) { Pop-Location; Fail "Deploy failed (see the message above). Most common cause: the wallet has no Sepolia ETH yet." }
  Write-Host "Creating the demo organisation (Acme Pharma Ltd.) with 8 identities..." -ForegroundColor Cyan
  npx hardhat run scripts/seed-demo.js --network sepolia
  if ($LASTEXITCODE -ne 0) { Pop-Location; Fail "Seeding failed (see the message above)." }
  Pop-Location
} else {
  Write-Host "Already deployed on Sepolia, skipping deploy. (Addresses are in deployments\deployments.json)" -ForegroundColor Green
}

# 4. Start relayer + frontend in their own windows.
Write-Host "Starting relayer and frontend (Sepolia mode)..." -ForegroundColor Cyan
Start-Process powershell -ArgumentList "-NoExit", "-Command", "`$host.UI.RawUI.WindowTitle='Relayer (Sepolia)'; cd '$root\relayer'; npm run start:sepolia"
Start-Process powershell -ArgumentList "-NoExit", "-Command", "`$host.UI.RawUI.WindowTitle='Frontend (Sepolia)'; cd '$root\frontend'; npm run dev:sepolia"

Start-Sleep -Seconds 6
Start-Process "http://localhost:5173"
Write-Host "`nReady: http://localhost:5173  (relayer status: http://localhost:8787/health)" -ForegroundColor Green
Write-Host "Keep the two new windows open during the demo. Close them to stop." -ForegroundColor Green
