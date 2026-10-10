import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import test from "node:test";

const requireFromTest = createRequire(import.meta.url);
const firebaseAuthEntry = requireFromTest.resolve("firebase-admin/auth");
const requireFromFirebaseAdmin = createRequire(firebaseAuthEntry);
const jwksEntry = requireFromFirebaseAdmin.resolve("jwks-rsa");
const requireFromJwks = createRequire(jwksEntry);
const joseEntry = requireFromJwks.resolve("jose");

function findPackageManifest(entry, expectedName) {
  let directory = path.dirname(entry);
  while (path.dirname(directory) !== directory) {
    const manifestPath = path.join(directory, "package.json");
    if (fs.existsSync(manifestPath)) {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
      if (manifest.name === expectedName) return manifest;
    }
    directory = path.dirname(directory);
  }
  throw new Error(`Could not find package manifest for ${expectedName}.`);
}

test("Firebase Admin's JWKS dependency can load jose from CommonJS", () => {
  const josePackage = findPackageManifest(joseEntry, "jose");
  const joseMajor = Number.parseInt(josePackage.version.split(".")[0], 10);

  assert.ok(
    joseMajor === 4 || joseMajor === 5,
    `Expected a CommonJS-compatible jose version, received ${josePackage.version}.`,
  );
  assert.ok(
    josePackage.exports?.["."]?.require,
    "The jose package must expose a CommonJS entry for jwks-rsa.",
  );
  assert.doesNotThrow(() => requireFromFirebaseAdmin("jwks-rsa"));
});
