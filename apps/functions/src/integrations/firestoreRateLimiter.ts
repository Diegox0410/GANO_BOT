import { createHash } from "node:crypto";
import type { Firestore } from "firebase-admin/firestore";
import type {
  RateLimiter,
  RateLimitPolicy,
  RateLimitResult,
} from "../contracts.js";

interface RateLimitDocument {
  readonly count: number;
  readonly reset: number;
}

export class FirestoreRateLimiter implements RateLimiter {
  public constructor(
    private readonly firestore: Firestore,
    private readonly collectionName = "ganobot_rate_limits",
  ) {}

  public async consume(
    key: string,
    policy: RateLimitPolicy,
    now: number,
  ): Promise<RateLimitResult> {
    if (policy.limit < 1 || policy.windowMilliseconds < 1) {
      throw new Error("Rate limit policy inválida.");
    }
    const id = createHash("sha256").update(key).digest("hex");
    const reference = this.firestore.collection(this.collectionName).doc(id);
    const bucket = await this.firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(reference);
      const stored = snapshot.exists
        ? snapshot.data() as RateLimitDocument
        : undefined;
      const current =
        stored === undefined || stored.reset <= now
          ? { count: 1, reset: now + policy.windowMilliseconds }
          : { count: stored.count + 1, reset: stored.reset };
      transaction.set(reference, current, { merge: false });
      return current;
    });
    const allowed = bucket.count <= policy.limit;
    return Object.freeze({
      allowed,
      limit: policy.limit,
      remaining: Math.max(0, policy.limit - bucket.count),
      resetAt: new Date(bucket.reset).toISOString(),
      ...(!allowed
        ? { retryAfterSeconds: Math.max(1, Math.ceil((bucket.reset - now) / 1000)) }
        : {}),
    });
  }
}
