import { Injectable, Logger } from '@nestjs/common';
import { Rest } from 'ably';
import { createHash, timingSafeEqual } from 'crypto';
import {
  NOTICE_LEVELS,
  NoticeDoc,
  NoticeLevel,
  NoticeRepository,
} from 'src/dao/notice.repository';
import { NHISCHANNEL_EVENTS } from 'src/events';

const MIN_MESSAGE = 3;
const MAX_MESSAGE = 500;

// After this many wrong admin passwords, sign-in pauses for everyone for a
// while (even the right password is refused) — same protection as the
// Feedback admin panel, kept as its own independent counter.
const ADMIN_MAX_FAILURES = 10;
const ADMIN_FAILURE_WINDOW_MS = 10 * 60 * 1000;

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

// Accepts an ISO string or a millisecond timestamp; anything else (including
// missing/empty, meaning "no limit") becomes null.
function parseDateInput(value: unknown): Date | null | 'invalid' {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' && typeof value !== 'number') return 'invalid';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'invalid' : date;
}

type CreateInput = {
  message: unknown;
  level: unknown;
  startAt: unknown;
  endAt: unknown;
};

type UpdateInput = {
  message?: unknown;
  level?: unknown;
  startAt?: unknown;
  endAt?: unknown;
  enabled?: unknown;
};

// Whether a notice should currently be shown: manually enabled AND (if a
// schedule was set) inside its start/end window.
export function isLive(notice: NoticeDoc, now: Date = new Date()): boolean {
  if (!notice.enabled) return false;
  if (notice.startAt && now < notice.startAt) return false;
  if (notice.endAt && now >= notice.endAt) return false;
  return true;
}

@Injectable()
export class NoticeService {
  private readonly logger = new Logger(NoticeService.name);
  private readonly adminFailures = new Map<string, number[]>();

  constructor(private readonly repository: NoticeRepository) {}

  // ---- public: what banner (if any) should show right now --------------
  async current(): Promise<{ ok: true; notice: NoticeDoc | null }> {
    const enabled = await this.repository.findEnabled();
    if (!enabled) return { ok: true, notice: null };

    const now = new Date();
    if (isLive(enabled, now)) {
      return { ok: true, notice: enabled };
    }
    if (enabled.endAt && now >= enabled.endAt) {
      // Past its own end time — self-expire so the admin list doesn't keep
      // showing it as live, with no cron job needed.
      await this.repository.update(enabled.id, { enabled: false });
      return { ok: true, notice: null };
    }
    // Only remaining case: scheduled for later (startAt is in the future).
    // Still returned as `notice` (enabled:true) so the banner can read its
    // own startAt and set a client-side timer to pick it up once it's live.
    return { ok: true, notice: enabled };
  }

  // ---- admin: create / list / update -------------------------------------
  async create(
    key: string | undefined,
    input: CreateInput,
  ): Promise<{ ok: true; notice: NoticeDoc } | { ok: false; error: string }> {
    const denied = this.checkAdmin(key);
    if (denied) return { ok: false, error: denied };

    const message = clean(input.message, MAX_MESSAGE);
    if (message.length < MIN_MESSAGE) {
      return {
        ok: false,
        error: `Message needs to be at least ${MIN_MESSAGE} characters.`,
      };
    }
    const level = input.level;
    if (
      typeof level !== 'string' ||
      !(NOTICE_LEVELS as readonly string[]).includes(level)
    ) {
      return { ok: false, error: 'Choose a level for the notice.' };
    }
    const startAt = parseDateInput(input.startAt);
    if (startAt === 'invalid') {
      return { ok: false, error: 'Start time is not a valid date.' };
    }
    const endAt = parseDateInput(input.endAt);
    if (endAt === 'invalid') {
      return { ok: false, error: 'End time is not a valid date.' };
    }
    if (startAt && endAt && endAt <= startAt) {
      return { ok: false, error: 'End time must be after the start time.' };
    }

    try {
      const now = new Date();
      const id = await this.repository.nextId();
      const notice: NoticeDoc = {
        id,
        message,
        level: level as NoticeLevel,
        startAt,
        endAt,
        enabled: true,
        createdAt: now,
        updatedAt: now,
      };
      // exactly one enabled notice at a time
      await this.repository.disableAllEnabled();
      await this.repository.insert(notice);
      await this.notifyClients();
      return { ok: true, notice };
    } catch (error) {
      this.logger.error(`Failed to create notice: ${error}`);
      return { ok: false, error: 'Could not save the notice right now.' };
    }
  }

  async list(
    key: string | undefined,
  ): Promise<{ ok: true; items: NoticeDoc[] } | { ok: false; error: string }> {
    const denied = this.checkAdmin(key);
    if (denied) return { ok: false, error: denied };
    try {
      const items = await this.repository.list(50);
      return { ok: true, items };
    } catch (error) {
      this.logger.error(`Failed to list notices: ${error}`);
      return { ok: false, error: 'Could not load notices.' };
    }
  }

  async update(
    key: string | undefined,
    id: string,
    input: UpdateInput,
  ): Promise<{ ok: true; notice: NoticeDoc } | { ok: false; error: string }> {
    const denied = this.checkAdmin(key);
    if (denied) return { ok: false, error: denied };
    if (!/^NTC-\d{4,}$/.test(id)) {
      return { ok: false, error: 'Invalid notice id.' };
    }

    const patch: Partial<
      Pick<NoticeDoc, 'message' | 'level' | 'startAt' | 'endAt' | 'enabled'>
    > = {};

    if (input.message !== undefined) {
      const message = clean(input.message, MAX_MESSAGE);
      if (message.length < MIN_MESSAGE) {
        return {
          ok: false,
          error: `Message needs to be at least ${MIN_MESSAGE} characters.`,
        };
      }
      patch.message = message;
    }
    if (input.level !== undefined) {
      if (
        typeof input.level !== 'string' ||
        !(NOTICE_LEVELS as readonly string[]).includes(input.level)
      ) {
        return { ok: false, error: 'Invalid level.' };
      }
      patch.level = input.level as NoticeLevel;
    }
    if (input.startAt !== undefined) {
      const startAt = parseDateInput(input.startAt);
      if (startAt === 'invalid') {
        return { ok: false, error: 'Start time is not a valid date.' };
      }
      patch.startAt = startAt;
    }
    if (input.endAt !== undefined) {
      const endAt = parseDateInput(input.endAt);
      if (endAt === 'invalid') {
        return { ok: false, error: 'End time is not a valid date.' };
      }
      patch.endAt = endAt;
    }
    if (patch.startAt && patch.endAt && patch.endAt <= patch.startAt) {
      return { ok: false, error: 'End time must be after the start time.' };
    }
    if (input.enabled !== undefined) {
      if (typeof input.enabled !== 'boolean') {
        return { ok: false, error: 'Invalid enabled value.' };
      }
      patch.enabled = input.enabled;
    }
    if (Object.keys(patch).length === 0) {
      return { ok: false, error: 'Nothing to update.' };
    }

    try {
      if (patch.enabled === true) {
        await this.repository.disableAllEnabled(id);
      }
      const notice = await this.repository.update(id, patch);
      if (!notice) return { ok: false, error: 'Notice not found.' };
      await this.notifyClients();
      return { ok: true, notice };
    } catch (error) {
      this.logger.error(`Failed to update notice: ${error}`);
      return { ok: false, error: 'Could not save the notice right now.' };
    }
  }

  // ---- admin auth (own lockout, independent of the Feedback one) --------
  private checkAdmin(key: string | undefined): string | null {
    const expected = process.env.FEEDBACK_ADMIN_KEY;
    if (!expected) return 'Admin access is not configured.';

    const now = Date.now();
    const recent = (this.adminFailures.get('admin') ?? []).filter(
      (t) => now - t < ADMIN_FAILURE_WINDOW_MS,
    );
    if (recent.length >= ADMIN_MAX_FAILURES) {
      this.adminFailures.set('admin', recent);
      return 'Too many wrong passwords - please wait a few minutes and try again.';
    }
    if (!key) return 'Unauthorized';

    const a = createHash('sha256').update(key).digest();
    const b = createHash('sha256').update(expected).digest();
    if (timingSafeEqual(a, b)) return null;

    recent.push(now);
    this.adminFailures.set('admin', recent);
    return 'Unauthorized';
  }

  // ---- realtime push (reuses the existing Ably channel/event system) ----
  private async notifyClients(): Promise<void> {
    try {
      const ablyClient = new Rest({
        key: process.env.ABLY_API_KEY,
        clientId: 'nhis-update-notice',
      });
      const channel = ablyClient.channels.get(process.env.ABLY_CHANNEL_NAME!);
      await channel.publish(NHISCHANNEL_EVENTS.NOTICE_UPDATED, {
        message: 'Site notice updated',
        failed: false,
        stale: true,
      });
    } catch (error) {
      // A failed push just means open tabs won't update instantly — the
      // notice itself is already saved, and a page reload still picks it
      // up, so this is a soft failure.
      this.logger.warn(`Failed to publish notice update: ${error}`);
    }
  }
}
