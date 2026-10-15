import { getAuth } from "firebase-admin/auth";

import { getGanoFirebaseAdminApp } from "../apps/functions/dist/integrations/firebaseAdmin.js";

const SANDBOX_PROJECT = "floes-commercial-sandbox-2026";
const CHOPIFY_PREVIEW_HOST = /\.vercel\.app$/i;

function onlyFloes(value) {
  const tenants = (value ?? "")
    .split(",")
    .map((tenant) => tenant.trim())
    .filter(Boolean);
  return tenants.length === 1 && tenants[0] === "tenant-floes";
}

function previewHost(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && CHOPIFY_PREVIEW_HOST.test(url.hostname);
  } catch {
    return false;
  }
}

function noLiveChannels(environment) {
  return ![
    "WHATSAPP_ACCESS_TOKEN",
    "META_WHATSAPP_ACCESS_TOKEN",
    "META_WHATSAPP_APP_SECRET",
    "FLOES_WHATSAPP_NUMBER",
    "STRIPE_SECRET_KEY",
    "MERCADOPAGO_ACCESS_TOKEN",
    "PAYPAL_CLIENT_SECRET",
  ].some((name) => environment[name]?.trim());
}

export function describePreviewSafety(environment = process.env) {
  const email = environment.FIREBASE_ADMIN_CLIENT_EMAIL?.trim() ?? "";
  const checks = Object.freeze({
    preview: environment.VERCEL_ENV === "preview",
    firebaseClientProject: environment.VITE_FIREBASE_PROJECT_ID === SANDBOX_PROJECT,
    firebaseAdminProject: environment.FIREBASE_ADMIN_PROJECT_ID === SANDBOX_PROJECT,
    firebaseAdminIdentity: email.endsWith(`@${SANDBOX_PROJECT}.iam.gserviceaccount.com`)
      && Boolean(environment.FIREBASE_ADMIN_PRIVATE_KEY?.trim()),
    chopifyPreview: previewHost(environment.CHOPIFY_COMMERCE_BASE_URL),
    tenant: environment.GANO_COMMERCE_TENANT_ID === "tenant-floes",
    tenantAllowlist: onlyFloes(environment.GANOBOT_COMMERCE_ALLOWED_TENANTS),
    chopifyTokenConfigured: Boolean(environment.CHOPIFY_COMMERCE_API_TOKEN?.trim()),
    liveChannelsDisabled: noLiveChannels(environment),
  });
  return Object.freeze({
    ready: Object.values(checks).every(Boolean),
    firebaseProjectId: SANDBOX_PROJECT,
    tenantId: "tenant-floes",
    checks,
    ...(checks.preview ? {} : { error: "preview-environment-required" }),
  });
}

export default async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("X-Content-Type-Options", "nosniff");
  if (request.method !== "GET") {
    response.status(405).json({ error: { code: "METHOD_NOT_ALLOWED" } });
    return;
  }

  const result = describePreviewSafety();
  if (!result.checks.preview) {
    response.status(404).json({ error: { code: "NOT_FOUND" } });
    return;
  }

  let firebaseAdminConnected = false;
  try {
    await getAuth(getGanoFirebaseAdminApp()).listUsers(1);
    firebaseAdminConnected = true;
  } catch {
    // Deliberately return only a boolean; provider errors may contain project details.
  }

  const ready = result.ready && firebaseAdminConnected;
  response.status(ready ? 200 : 503).json({
    ...result,
    ready,
    checks: { ...result.checks, firebaseAdminConnected },
    externalChannels: "disabled",
    paymentProcessor: "disabled",
  });
}
