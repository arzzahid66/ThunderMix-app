/**
 * Best-effort, in-memory sliding-window limiter keyed by client IP.
 *
 * This is a coarse first layer only: on serverless platforms (Vercel) each
 * instance has its own memory, so limits are per instance, not global. The
 * authoritative per-user limits are enforced inside PostgreSQL
 * (see visitor_send_message / private.create_session).
 */
interface Bucket {
  hits: number[];
}

const buckets = new Map<string, Bucket>();
const MAX_KEYS = 10_000;

export interface LimitResult {
  ok: boolean;
  retryAfter: number;
}

export function checkRateLimit(key: string, limit: number, windowMs: number, now = Date.now()): LimitResult {
  const bucket = buckets.get(key) ?? { hits: [] };
  bucket.hits = bucket.hits.filter((t) => now - t < windowMs);

  if (bucket.hits.length >= limit) {
    buckets.set(key, bucket);
    const retryAfter = Math.max(1, Math.ceil((bucket.hits[0] + windowMs - now) / 1000));
    return { ok: false, retryAfter };
  }

  bucket.hits.push(now);
  buckets.delete(key); // re-insert to keep Map order ≈ LRU
  buckets.set(key, bucket);
  if (buckets.size > MAX_KEYS) {
    const oldest = buckets.keys().next().value;
    if (oldest !== undefined) buckets.delete(oldest);
  }
  return { ok: true, retryAfter: 0 };
}

export function resetRateLimits() {
  buckets.clear();
}
