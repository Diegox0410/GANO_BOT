import assert from "node:assert/strict";
import test from "node:test";

import { describePreviewSafety, safeFirebaseErrorCode } from "../api/preview-safety.mjs";

const SAFE_ENVIRONMENT = Object.freeze({
  VERCEL_ENV: "preview",
  VITE_FIREBASE_PROJECT_ID: "floes-commercial-sandbox-2026",
  FIREBASE_ADMIN_PROJECT_ID: "floes-commercial-sandbox-2026",
  FIREBASE_ADMIN_CLIENT_EMAIL: "firebase-adminsdk-test@floes-commercial-sandbox-2026.iam.gserviceaccount.com",
  FIREBASE_ADMIN_PRIVATE_KEY: "synthetic-test-key",
  CHOPIFY_COMMERCE_BASE_URL: "https://chopify-preview.vercel.app",
  GANO_COMMERCE_TENANT_ID: "tenant-floes",
  GANOBOT_COMMERCE_ALLOWED_TENANTS: "tenant-floes",
  CHOPIFY_COMMERCE_API_TOKEN: "synthetic-test-token",
});

test("safe preview preflight exposes only sandbox and tenant checks", () => {
  const result = describePreviewSafety(SAFE_ENVIRONMENT);

  assert.equal(result.ready, true);
  assert.equal(result.firebaseProjectId, "floes-commercial-sandbox-2026");
  assert.equal(result.tenantId, "tenant-floes");
  assert.equal(Object.hasOwn(result, "secrets"), false);
});

test("preflight fails closed for production, another tenant, or a live channel", () => {
  assert.equal(describePreviewSafety({ ...SAFE_ENVIRONMENT, VERCEL_ENV: "production" }).ready, false);
  assert.equal(describePreviewSafety({ ...SAFE_ENVIRONMENT, GANOBOT_COMMERCE_ALLOWED_TENANTS: "tenant-floes,tenant-dgng" }).ready, false);
  assert.equal(describePreviewSafety({ ...SAFE_ENVIRONMENT, META_WHATSAPP_ACCESS_TOKEN: "live" }).ready, false);
  assert.equal(describePreviewSafety({ ...SAFE_ENVIRONMENT, CHOPIFY_COMMERCE_BASE_URL: "https://shop.example.com" }).ready, false);
});

test("Firebase diagnostics expose only allowlisted provider error codes", () => {
  assert.equal(safeFirebaseErrorCode({ code: "auth/insufficient-permission", message: "private detail" }), "auth/insufficient-permission");
  assert.equal(safeFirebaseErrorCode({ code: "unknown/private-secret" }), "unknown");
});
