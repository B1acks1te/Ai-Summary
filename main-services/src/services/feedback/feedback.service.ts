import { Injectable, Logger } from '@nestjs/common';
import { createHash, timingSafeEqual } from 'crypto';
import {
  FEEDBACK_STATUSES,
  FEEDBACK_TYPES,
  FeedbackContextValue,
  FeedbackDoc,
  FeedbackRepository,
  FeedbackStatus,
  FeedbackType,
} from 'src/dao/feedback.repository';

const MIN_DESCRIPTION = 5;
const MAX_DESCRIPTION = 2000;
const MAX_CONTEXT_ENTRIES = 25;

// After this many wrong passwords in the window, sign-in is paused for
// everyone until the window passes (even the right password is refused).
const ADMIN_MAX_FAILURES = 10;
const ADMIN_FAILURE_WINDOW_MS = 10 * 60 * 1000;

const TYPE_LABEL: Record<FeedbackType, string> = {
  bug: 'Bug',
  data: 'Wrong or missing data',
  change: 'Change request',
  feature: 'New feature idea',
  question: 'Question',
};

const TYPE_COLOUR: Record<FeedbackType, number> = {
  bug: 0xdc2626,
  data: 0xd97706,
  change: 0x2563eb,
  feature: 0x16a34a,
  question: 0x6b7280,
};

export type Submission = {
  type: FeedbackType;
  description: string;
  contact: string;
  page: string;
  context: Record<string, FeedbackContextValue>;
  userAgent: string;
  clientId: string;
  isBot: boolean;
};

// Trim, cap the length, and drop control characters (keeps normal new lines).
function clean(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  return (
    value
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
      .trim()
      .slice(0, max)
  );
}

function sanitizeContext(value: unknown): Record<string, FeedbackContextValue> {
  const out: Record<string, FeedbackContextValue> = {};
  if (typeof value !== 'object' || value === null) return out;
  for (const [rawKey, rawValue] of Object.entries(value)) {
    if (Object.keys(out).length >= MAX_CONTEXT_ENTRIES) break;
    const key = clean(rawKey, 40);
    if (!key) continue;
    if (typeof rawValue === 'string') {
      const v = clean(rawValue, 200);
      if (v) out[key] = v;
    } else if (typeof rawValue === 'number' && Number.isFinite(rawValue)) {
      out[key] = rawValue;
    } else if (typeof rawValue === 'boolean') {
      out[key] = rawValue;
    }
  }
  return out;
}

export function parseSubmission(
  body: unknown,
): { ok: true; value: Submission } | { ok: false; error: string } {
  if (typeof body !== 'object' || body === null) {
    return { ok: false, error: 'Invalid request.' };
  }
  const b = body as Record<string, unknown>;

  const type = b.type;
  if (
    typeof type !== 'string' ||
    !(FEEDBACK_TYPES as readonly string[]).includes(type)
  ) {
    return {
      ok: false,
      error: 'Please choose what kind of feedback this is.',
    };
  }

  const description = clean(b.description, MAX_DESCRIPTION);
  if (description.length < MIN_DESCRIPTION) {
    return {
      ok: false,
      error: `Please add a little more detail (at least ${MIN_DESCRIPTION} characters).`,
    };
  }

  return {
    ok: true,
    value: {
      type: type as FeedbackType,
      description,
      contact: clean(b.contact, 200),
      page: clean(b.page, 200),
      context: sanitizeContext(b.context),
      userAgent: clean(b.userAgent, 300),
      clientId: clean(b.clientId, 64) || 'unknown',
      // hidden form field that real people never fill in
      isBot: typeof b.website === 'string' && b.website.trim() !== '',
    },
  };
}

// Simple in-memory sliding-window limiter. Light protection only (this is an
// internal tool) — it keeps a runaway script from flooding the channel.
export class RateLimiter {
  private readonly hits = new Map<string, number[]>();

  allow(key: string, max: number, windowMs: number, now = Date.now()): boolean {
    const recent = (this.hits.get(key) ?? []).filter((t) => now - t < windowMs);
    if (recent.length >= max) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(now);
    this.hits.set(key, recent);

    if (this.hits.size > 5000) {
      for (const [k, times] of this.hits) {
        if (times.every((t) => now - t >= windowMs)) this.hits.delete(k);
      }
    }
    return true;
  }

  // How many hits are inside the window (without adding one).
  count(key: string, windowMs: number, now = Date.now()): number {
    return (this.hits.get(key) ?? []).filter((t) => now - t < windowMs).length;
  }

  // Add a hit without checking any limit.
  record(key: string, now = Date.now()): void {
    const recent = this.hits.get(key) ?? [];
    recent.push(now);
    this.hits.set(key, recent);
  }
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

// Very small user-agent summary for the Discord message ("Chrome on Windows").
export function describeBrowser(userAgent: string): string {
  if (!userAgent) return '-';
  const browser = /Edg\//.test(userAgent)
    ? 'Edge'
    : /Firefox\//.test(userAgent)
      ? 'Firefox'
      : /Chrome\//.test(userAgent)
        ? 'Chrome'
        : /Safari\//.test(userAgent)
          ? 'Safari'
          : 'Unknown browser';
  const os = /Windows/.test(userAgent)
    ? 'Windows'
    : /Android/.test(userAgent)
      ? 'Android'
      : /iPhone|iPad/.test(userAgent)
        ? 'iOS'
        : /Mac OS X/.test(userAgent)
          ? 'macOS'
          : /Linux/.test(userAgent)
            ? 'Linux'
            : 'unknown OS';
  return `${browser} on ${os}`;
}

export function buildDiscordPayload(doc: FeedbackDoc) {
  const env = doc.env || 'app';
  const contextLines = Object.entries(doc.context)
    .map(([key, value]) => `${key}: ${String(value)}`)
    .join('\n');

  const fields: { name: string; value: string; inline?: boolean }[] = [
    { name: 'Page', value: doc.page || '-', inline: true },
    { name: 'From', value: doc.contact || 'Anonymous', inline: true },
    { name: 'Browser', value: describeBrowser(doc.userAgent), inline: true },
  ];
  if (contextLines) fields.push({ name: 'Context', value: contextLines });

  return {
    username: 'Feedback',
    // never let text typed by a user ping @everyone / @here / roles
    allowed_mentions: { parse: [] as string[] },
    embeds: [
      {
        title: truncate(`[${env}] ${doc.ref} - ${TYPE_LABEL[doc.type]}`, 250),
        description: truncate(doc.description, 3000),
        color: TYPE_COLOUR[doc.type],
        // Discord rejects empty field values
        fields: fields.map((f) => ({
          ...f,
          value: truncate(f.value || '-', 1000),
        })),
        footer: { text: env },
        timestamp: doc.createdAt.toISOString(),
      },
    ],
  };
}

@Injectable()
export class FeedbackService {
  private readonly logger = new Logger(FeedbackService.name);
  private readonly limiter = new RateLimiter();
  private readonly adminFailures = new RateLimiter();

  constructor(private readonly repository: FeedbackRepository) {}

  async submit(
    body: unknown,
  ): Promise<{ ok: true; ref: string } | { ok: false; error: string }> {
    const parsed = parseSubmission(body);
    if (!parsed.ok) return parsed;
    const submission = parsed.value;

    // Bots fill the hidden field: pretend it worked, store and notify nothing.
    if (submission.isBot) return { ok: true, ref: 'FB-0000' };

    const tenMinutes = 10 * 60 * 1000;
    const oneHour = 60 * 60 * 1000;
    if (
      !this.limiter.allow('global', 60, oneHour) ||
      !this.limiter.allow(`client:${submission.clientId}`, 5, tenMinutes)
    ) {
      return {
        ok: false,
        error: 'Too many submissions - please try again in a few minutes.',
      };
    }

    try {
      const now = new Date();
      const ref = await this.repository.nextRef();
      const doc: FeedbackDoc = {
        ref,
        type: submission.type,
        description: submission.description,
        contact: submission.contact,
        page: submission.page,
        context: submission.context,
        userAgent: submission.userAgent,
        env: process.env.APP_ENV || process.env.STACK_NAME || 'app',
        status: 'new',
        notes: '',
        notified: false,
        createdAt: now,
        updatedAt: now,
      };
      await this.repository.insert(doc);

      // The report is already safely stored; a failed notification must not
      // make the person think their feedback was lost.
      const notified = await this.notifyDiscord(doc);
      if (notified) await this.repository.setNotified(ref, true);

      return { ok: true, ref };
    } catch (error) {
      this.logger.error(`Failed to save feedback: ${error}`);
      return {
        ok: false,
        error:
          'Could not save your feedback right now. Please try again shortly.',
      };
    }
  }

  private async notifyDiscord(doc: FeedbackDoc): Promise<boolean> {
    const url = process.env.FEEDBACK_DISCORD_WEBHOOK_URL;
    if (!url) return false;
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildDiscordPayload(doc)),
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) {
        // (never log the URL - it is a secret)
        this.logger.warn(`Discord webhook responded with ${response.status}`);
        return false;
      }
      return true;
    } catch (error) {
      this.logger.error(`Discord notification failed: ${error}`);
      return false;
    }
  }

  // ---- admin (list / triage) — protected by FEEDBACK_ADMIN_KEY ----------
  private checkAdmin(key: string | undefined): string | null {
    const expected = process.env.FEEDBACK_ADMIN_KEY;
    if (!expected) return 'Feedback admin access is not configured.';
    // Someone guessing? Pause sign-in for a few minutes (this check comes
    // first so a lucky guess during the pause doesn't get in either).
    if (
      this.adminFailures.count('admin', ADMIN_FAILURE_WINDOW_MS) >=
      ADMIN_MAX_FAILURES
    ) {
      return 'Too many wrong passwords - please wait a few minutes and try again.';
    }
    if (!key) return 'Unauthorized';
    const a = createHash('sha256').update(key).digest();
    const b = createHash('sha256').update(expected).digest();
    if (timingSafeEqual(a, b)) return null;
    this.adminFailures.record('admin');
    return 'Unauthorized';
  }

  async list(
    key: string | undefined,
    query: { status?: string; type?: string; limit?: string },
  ): Promise<
    { ok: true; items: FeedbackDoc[] } | { ok: false; error: string }
  > {
    const denied = this.checkAdmin(key);
    if (denied) return { ok: false, error: denied };
    try {
      const status = (FEEDBACK_STATUSES as readonly string[]).includes(
        query.status ?? '',
      )
        ? (query.status as FeedbackStatus)
        : undefined;
      const type = (FEEDBACK_TYPES as readonly string[]).includes(
        query.type ?? '',
      )
        ? (query.type as FeedbackType)
        : undefined;
      const limit = Math.min(Math.max(Number(query.limit) || 100, 1), 200);
      const items = await this.repository.list({ status, type }, limit);
      return { ok: true, items };
    } catch (error) {
      this.logger.error(`Failed to list feedback: ${error}`);
      return { ok: false, error: 'Could not load feedback.' };
    }
  }

  async update(
    key: string | undefined,
    ref: string,
    body: unknown,
  ): Promise<{ ok: true; item: FeedbackDoc } | { ok: false; error: string }> {
    const denied = this.checkAdmin(key);
    if (denied) return { ok: false, error: denied };
    if (!/^FB-\d{4,}$/.test(ref)) {
      return { ok: false, error: 'Invalid reference.' };
    }
    if (typeof body !== 'object' || body === null) {
      return { ok: false, error: 'Invalid request.' };
    }
    const b = body as Record<string, unknown>;

    const patch: { status?: FeedbackStatus; notes?: string } = {};
    if (b.status !== undefined) {
      if (
        typeof b.status !== 'string' ||
        !(FEEDBACK_STATUSES as readonly string[]).includes(b.status)
      ) {
        return { ok: false, error: 'Invalid status.' };
      }
      patch.status = b.status as FeedbackStatus;
    }
    if (b.notes !== undefined) {
      patch.notes = clean(b.notes, 2000);
    }
    if (patch.status === undefined && patch.notes === undefined) {
      return { ok: false, error: 'Nothing to update.' };
    }

    try {
      const item = await this.repository.update(ref, patch);
      return item ? { ok: true, item } : { ok: false, error: 'Not found.' };
    } catch (error) {
      this.logger.error(`Failed to update feedback: ${error}`);
      return { ok: false, error: 'Could not update feedback.' };
    }
  }
}