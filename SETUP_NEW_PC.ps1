$ErrorActionPreference = "Stop"

Write-Host "=== GANO_BOT: verificación de entorno ===" -ForegroundColor Cyan

function Require-Command {
  param([string]$Name)
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "No se encontró '$Name'. Instálelo antes de continuar."
  }
}

Require-Command node
Require-Command npm
Require-Command git

Write-Host "Node: $(node -v)"
Write-Host "npm:  $(npm -v)"
Write-Host "Git:  $(git --version)"

Write-Host "`n=== Instalando dependencias del monorepo ===" -ForegroundColor Cyan
npm install --no-audit --no-fund

Write-Host "`n=== Reconstruyendo esbuild ===" -ForegroundColor Cyan
npm rebuild esbuild

Write-Host "`n=== Compilando TypeScript y monorepo ===" -ForegroundColor Cyan
npx tsc -b --clean
npx tsc -b --force --pretty false
npm run build

Write-Host "`nConfiguración finalizada correctamente." -ForegroundColor Green
Write-Host "Para iniciar: npm run dev"
Write-Host "Firebase CLI opcional: npm install -g firebase-tools"
Write-Host "Playwright opcional: npx playwright install"
