import assert from "node:assert/strict";
import { RedactingLogger, redactLogMetadata } from "../services.js";

const safe = redactLogMetadata({
  requestId: "request-1",
  correlationId: "correlation-1",
  authorization: "Bearer signed-token",
  apiKey: "server-secret",
  ordinaryValue: "Bearer must-not-leak",
  paymentProofBinary: "base64-data",
});
assert.equal(safe.requestId, "request-1");
assert.equal(safe.correlationId, "correlation-1");
assert.equal(safe.authorization, undefined);
assert.equal(safe.apiKey, undefined);
assert.equal(safe.ordinaryValue, "[REDACTED]");
assert.equal(safe.paymentProofBinary, undefined);

const logger = new RedactingLogger();
logger.log("info", "commerce.request", safe);
assert.equal(logger.entries[0]?.metadata.authorization, undefined);
assert.equal(JSON.stringify(logger.entries).includes("signed-token"), false);
assert.equal(JSON.stringify(logger.entries).includes("server-secret"), false);

console.log("Observability: correlation metadata y redacción de secretos/pago OK");
