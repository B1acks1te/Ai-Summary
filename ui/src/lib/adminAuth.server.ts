// Server-only admin-key check for the UI's own server functions — the raw
// debug lookups and the admin stats overview on the /search Admin UI.
//
// These run inside the UI container, which talks to MongoDB directly (see
// lib/mongodb.ts), so they can't rely on main-services' existing
// FEEDBACK_ADMIN_KEY check (that only guards main-services' own HTTP
// endpoints). This mirrors that same check — sha256 + timingSafeEqual
// comparison, same 10-attempts/10-minutes lockout shape — using the same
// FEEDBACK_ADMIN_KEY secret, now also passed to the UI container.
//
// This file must never be imported from a client component; it reads an
// env var that doesn't exist in the browser and should never be bundled
// there. Only import it from a createServerFn handler.
import { createHash, timingSafeEqual } from 'crypto';

const ADMIN_MAX_FAILURES = 10;
const ADMIN_FAILURE_WINDOW_MS = 10 * 60 * 1000;

class RateLimiter {
  private hits = new Map<string, number[]>();

  count(key: string, windowMs: number, now = Date.now()): number {
    return (this.hits.get(key) ?? []).filter((t) => now - t < windowMs).length;
  }

  record(key: string, now = Date.now()): void {
    const recent = this.hits.get(key) ?? [];
    recent.push(now);
    this.hits.set(key, recent);
  }
}

// Module-level singleton: persists for the life of the Node process, same
// as main-services' own instance-per-service RateLimiter.
const adminFailures = new RateLimiter();

// Returns null when the key is valid, or an error message (safe to show to
// the person signing in) when it isn't.
export function checkAdminKey(key: string | undefined): string | null {
  const expected = process.env.FEEDBACK_ADMIN_KEY;
  if (!expected) return 'Admin access is not configured.';
  if (
    adminFailures.count('admin', ADMIN_FAILURE_WINDOW_MS) >= ADMIN_MAX_FAILURES
  ) {
    return 'Too many wrong passwords - please wait a few minutes and try again.';
  }
  if (!key) return 'Unauthorized';
  const a = createHash('sha256').update(key).digest();
  const b = createHash('sha256').update(expected).digest();
  if (a.length === b.length && timingSafeEqual(a, b)) return null;
  adminFailures.record('admin');
  return 'Unauthorized';
}
