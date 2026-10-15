# Vercel Preview environment target names

This document records variable names only. Do not store values here or commit a populated `.env` file.

For Preview branch `codex/preview-final-ganobot`, keep these server-only Firebase Admin variables scoped to the Preview branch and point them only at the dedicated Firebase sandbox project:

- `FIREBASE_ADMIN_PROJECT_ID`
- `FIREBASE_ADMIN_CLIENT_EMAIL`
- `FIREBASE_ADMIN_PRIVATE_KEY`

The FLOES-only internal commerce integration uses:

- `GANO_COMMERCE_TENANT_ID=tenant-floes`
- `GANOBOT_COMMERCE_ALLOWED_TENANTS=tenant-floes`
- `CHOPIFY_API_BASE_URL_FLOES`
- `CHOPIFY_GANOBOT_INBOUND_TOKEN_FLOES`
- `CHOPIFY_COMMERCE_TIMEOUT_MS`

Do not enable MG/DGNG credentials or live channel destinations in this Preview run. Verify the Admin project ID against the same approved sandbox project used by FLOES and Chopify. Keep Production values in Production scope only; do not copy them to Preview.
