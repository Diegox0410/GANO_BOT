# Instalación de GANO_BOT en un equipo Windows nuevo

## Requisitos del sistema

1. Windows 11 actualizado.
2. Git para Windows.
3. Visual Studio Code.
4. Node.js 24 LTS, que incluye npm 11.
5. Firebase CLI, cuando se vaya a usar Firebase.
6. Navegadores de Playwright, únicamente para pruebas E2E.

## 1. Verificar herramientas

Abra PowerShell y ejecute:

```powershell
node -v
npm -v
git --version
code --version
```

El proyecto exige como mínimo Node.js 22 y npm 11. Se recomienda Node.js 24 LTS.

## 2. Abrir el proyecto

Extraiga el ZIP y abra la carpeta `GANO_BOT` en Visual Studio Code:

```powershell
cd C:\ruta\a\GANO_BOT
code .
```

## 3. Instalar dependencias del monorepo

Desde la raíz, donde está el `package.json` principal:

```powershell
npm install --no-audit --no-fund
```

Si npm muestra scripts pendientes de `esbuild`:

```powershell
npm approve-scripts --allow-scripts-pending
npm approve-scripts esbuild
npm rebuild esbuild
```

No ejecute `npm init`, ni instale manualmente React, Vite, TypeScript o Zustand. Ya están declarados en los `package.json` y en `package-lock.json`.

## 4. Instalar Firebase CLI

```powershell
npm install -g firebase-tools
firebase --version
firebase login
firebase projects:list
```

## 5. Instalar navegadores de Playwright

Solo es necesario antes de ejecutar pruebas E2E:

```powershell
npx playwright install
```

## 6. Configurar variables de entorno

Copie el ejemplo:

```powershell
Copy-Item .env.example .env.local
```

Complete únicamente las claves reales necesarias. No comparta ni comprima `.env.local`.

## 7. Validar el proyecto

```powershell
npx tsc -b --clean
npx tsc -b --force --pretty false
npm run build
```

## 8. Ejecutar en desarrollo

```powershell
npm run dev
```

La aplicación web se iniciará mediante Vite. La terminal mostrará la URL local.

## 9. Comandos principales

```powershell
npm run build
npm run typecheck
npm run lint
npm run test
npm run test:e2e
npm run format:check
```

## Extensiones recomendadas para VS Code

- ESLint
- Prettier - Code formatter
- Firebase Explorer, opcional
- Playwright Test for VS Code, opcional
- GitLens, opcional
- Codex, Claude Code o Blackbox AI, según disponibilidad

## No instalar globalmente

No es necesario instalar globalmente TypeScript, Vite, React, Vitest, Playwright, Zustand ni ESLint. El proyecto usa las versiones locales declaradas en el lockfile.
