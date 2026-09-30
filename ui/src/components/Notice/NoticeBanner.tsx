import { EVENT } from '@/lib/ably';
import { useNHISChannel } from '@/hooks';
import { useCurrentNotice } from '@/queries';
import type { NoticeItem } from '@/serverFuncs/Notice';
import { useEffect, useState } from 'react';

const DISMISS_KEY_PREFIX = 'notice-dismissed-';

const LEVEL_STYLE: Record<NoticeItem['level'], string> = {
  info: 'bg-blue-50 text-blue-900 border-blue-200',
  warning: 'bg-amber-50 text-amber-900 border-amber-200',
  critical: 'bg-red-50 text-red-900 border-red-300',
};

function isLive(notice: NoticeItem, nowMs: number): boolean {
  if (!notice.enabled) return false;
  if (notice.startAt && nowMs < new Date(notice.startAt).getTime())
    return false;
  if (notice.endAt && nowMs >= new Date(notice.endAt).getTime()) return false;
  return true;
}

// setTimeout overflows past ~24.8 days (32-bit ms). Schedule in <=24h hops so
// a notice with a start/end days or weeks out still fires at the right time.
const MAX_TIMEOUT_MS = 24 * 60 * 60 * 1000;

function scheduleAt(targetMs: number, onDue: () => void): () => void {
  let cancelled = false;
  let handle: ReturnType<typeof setTimeout>;
  const tick = () => {
    const delay = targetMs - Date.now();
    if (delay <= 0) {
      if (!cancelled) onDue();
      return;
    }
    handle = setTimeout(tick, Math.min(delay, MAX_TIMEOUT_MS));
  };
  tick();
  return () => {
    cancelled = true;
    clearTimeout(handle);
  };
}

export function NoticeBanner() {
  const { data, refetch } = useCurrentNotice();
  const notice = data?.notice ?? null;

  // The backend pushes this event whenever a notice is created or changed
  // (same Ably channel/event system the rest of the app already uses).
  useNHISChannel((message) => {
    if (message.name === EVENT.NOTICE_UPDATED) {
      void refetch();
    }
  });

  // A notice can be scheduled to start or stop in the future. Set a timer
  // for the next boundary so a tab that's already open picks up the change
  // right on time, without needing a reload.
  useEffect(() => {
    if (!notice) return;
    const now = Date.now();
    const boundaries = [
      notice.startAt ? new Date(notice.startAt).getTime() : null,
      notice.endAt ? new Date(notice.endAt).getTime() : null,
    ].filter((t): t is number => t !== null && t > now);
    if (boundaries.length === 0) return;
    const next = Math.min(...boundaries);
    return scheduleAt(next, () => void refetch());
  }, [notice?.id, notice?.startAt, notice?.endAt, refetch]);

  // Dismissal is remembered per browser, keyed to this exact version of the
  // notice - editing the message or re-enabling it brings the banner back.
  const dismissKey = notice
    ? `${DISMISS_KEY_PREFIX}${notice.id}-${notice.updatedAt}`
    : null;
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => {
    if (!dismissKey) {
      setDismissed(false);
      return;
    }
    try {
      setDismissed(window.localStorage.getItem(dismissKey) === '1');
    } catch {
      setDismissed(false);
    }
  }, [dismissKey]);

  if (!notice || dismissed || !isLive(notice, Date.now())) return null;

  return (
    <div
      className={`flex items-center gap-3 border-b px-4 py-2 text-sm ${LEVEL_STYLE[notice.level]}`}
    >
      <span className="flex-1">{notice.message}</span>
      <button
        type="button"
        onClick={() => {
          if (dismissKey) {
            try {
              window.localStorage.setItem(dismissKey, '1');
            } catch {
              // storage blocked - the banner will just reappear on reload
            }
          }
          setDismissed(true);
        }}
        aria-label="Dismiss notice"
        className="shrink-0 cursor-pointer opacity-70 hover:opacity-100"
      >
        ✕
      </button>
    </div>
  );
}
