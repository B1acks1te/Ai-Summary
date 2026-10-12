import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  NOTICE_LEVELS,
  createNotice,
  listNotices,
  updateNotice,
  type NoticeItem,
  type NoticeLevel,
} from '@/serverFuncs/Notice';
import { useEffect, useState } from 'react';

// Same sessionStorage key the Feedback admin panel uses (both share the one
// FEEDBACK_ADMIN_KEY password on the backend), so signing in once on this
// page unlocks both panels.
const KEY_STORAGE = 'feedback-admin-key';

const LEVEL_LABEL: Record<NoticeLevel, string> = {
  info: 'Info',
  warning: 'Warning',
  critical: 'Critical',
};

const LEVEL_BADGE: Record<NoticeLevel, string> = {
  info: 'bg-blue-100 text-blue-800',
  warning: 'bg-amber-100 text-amber-800',
  critical: 'bg-red-100 text-red-800',
};

function formatWhen(iso: string | null): string {
  if (!iso) return '-';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-NZ', {
    timeZone: 'Pacific/Auckland',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function formatSchedule(item: NoticeItem): string {
  if (!item.startAt && !item.endAt) return 'No schedule (manual on/off)';
  if (item.startAt && item.endAt) {
    return `${formatWhen(item.startAt)} \u2192 ${formatWhen(item.endAt)}`;
  }
  if (item.startAt) return `From ${formatWhen(item.startAt)}`;
  return `Until ${formatWhen(item.endAt)}`;
}

function isLiveNow(item: NoticeItem): boolean {
  if (!item.enabled) return false;
  const now = Date.now();
  if (item.startAt && now < new Date(item.startAt).getTime()) return false;
  if (item.endAt && now >= new Date(item.endAt).getTime()) return false;
  return true;
}

// <input type="datetime-local"> gives/takes "YYYY-MM-DDTHH:mm" in the
// browser's local time zone - Date parses/serialises that correctly on its
// own, so this is just a thin, clearly-named wrapper.
function localInputToIso(value: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function NoticeHistoryItem({
  item,
  onToggle,
}: {
  item: NoticeItem;
  onToggle: (item: NoticeItem) => void;
}) {
  const live = isLiveNow(item);
  return (
    <div className="flex flex-col gap-1 rounded-md border bg-white p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={`rounded px-1.5 py-0.5 text-xs font-medium ${LEVEL_BADGE[item.level]}`}
        >
          {LEVEL_LABEL[item.level]}
        </span>
        {live && (
          <span className="rounded bg-green-100 px-1.5 py-0.5 text-xs font-medium text-green-800">
            Live now
          </span>
        )}
        {item.enabled && !live && item.startAt && (
          <span className="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-600">
            Scheduled
          </span>
        )}
        <span className="ml-auto text-xs text-gray-400">{item.id}</span>
      </div>
      <p>{item.message}</p>
      <p className="text-xs text-gray-500">{formatSchedule(item)}</p>
      <div>
        <Button size="sm" variant="secondary" onClick={() => onToggle(item)}>
          {item.enabled ? 'Take down' : 'Post again'}
        </Button>
      </div>
    </div>
  );
}

export function NoticeAdmin() {
  const [adminKey, setAdminKey] = useState('');
  const [items, setItems] = useState<NoticeItem[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [message, setMessage] = useState('');
  const [level, setLevel] = useState<NoticeLevel>('info');
  const [startAt, setStartAt] = useState('');
  const [endAt, setEndAt] = useState('');
  const [posting, setPosting] = useState(false);
  const [formError, setFormError] = useState('');

  const load = async (key: string) => {
    if (!key) return;
    setLoading(true);
    setError('');
    const resp = await listNotices({ data: { adminKey: key } });
    setLoading(false);
    if (resp.ok && resp.items) {
      setItems(resp.items);
      try {
        window.sessionStorage.setItem(KEY_STORAGE, key);
      } catch {
        // ignore - you'll just be asked again next time
      }
    } else {
      setItems(null);
      if (resp.error === 'Unauthorized') {
        setError("That password isn't right.");
        try {
          window.sessionStorage.removeItem(KEY_STORAGE);
        } catch {
          // ignore
        }
      } else {
        setError(resp.error || 'Could not load notices.');
      }
    }
  };

  const signOut = () => {
    setItems(null);
    setAdminKey('');
    setError('');
    try {
      window.sessionStorage.removeItem(KEY_STORAGE);
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    try {
      const saved = window.sessionStorage.getItem(KEY_STORAGE);
      if (saved) {
        setAdminKey(saved);
        void load(saved);
      }
    } catch {
      // ignore
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submit = async () => {
    setFormError('');
    if (message.trim().length < 3) {
      setFormError('Message needs to be at least 3 characters.');
      return;
    }
    const startIso = localInputToIso(startAt);
    const endIso = localInputToIso(endAt);
    if (startAt && !startIso) {
      setFormError('Start time is not valid.');
      return;
    }
    if (endAt && !endIso) {
      setFormError('End time is not valid.');
      return;
    }
    if (startIso && endIso && endIso <= startIso) {
      setFormError('End time must be after the start time.');
      return;
    }
    setPosting(true);
    const resp = await createNotice({
      data: {
        adminKey,
        message: message.trim(),
        level,
        startAt: startIso,
        endAt: endIso,
      },
    });
    setPosting(false);
    if (resp.ok && resp.notice) {
      setMessage('');
      setStartAt('');
      setEndAt('');
      setLevel('info');
      await load(adminKey);
    } else {
      setFormError(resp.error || 'Could not post the notice.');
    }
  };

  const toggle = async (item: NoticeItem) => {
    const resp = await updateNotice({
      data: { adminKey, id: item.id, enabled: !item.enabled },
    });
    if (resp.ok) {
      await load(adminKey);
    } else {
      setError(resp.error || 'Could not update the notice.');
    }
  };

  return (
    <div className="flex flex-col gap-3 rounded-lg border bg-gray-50 p-4">
      <div>
        <h2 className="text-lg font-semibold">Site notice</h2>
        <p className="text-xs text-gray-500">
          A banner shown across the top of both pages - for scheduled downtime
          or other announcements. Sign in with the same password as Feedback.
        </p>
      </div>

      {items === null ? (
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void load(adminKey);
          }}
        >
          <input
            type="text"
            name="username"
            value="notices"
            autoComplete="username"
            readOnly
            tabIndex={-1}
            className="sr-only"
          />
          <Input
            type="password"
            name="password"
            autoComplete="current-password"
            value={adminKey}
            onChange={(e) => setAdminKey(e.target.value)}
            placeholder="Password"
            className="max-w-xs"
          />
          <Button type="submit" disabled={!adminKey || loading}>
            {loading ? 'Signing in...' : 'Sign in'}
          </Button>
          {error && <span className="text-sm text-red-600">{error}</span>}
        </form>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-gray-500">Signed in</span>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => load(adminKey)}
              disabled={loading}
            >
              {loading ? 'Loading...' : 'Refresh'}
            </Button>
            <Button size="sm" variant="ghost" onClick={signOut}>
              Sign out
            </Button>
            {error && <span className="text-sm text-red-600">{error}</span>}
          </div>

          <div className="flex flex-col gap-2 rounded-md border bg-white p-3">
            <p className="text-sm font-medium">Post a new notice</p>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={2}
              maxLength={500}
              placeholder="e.g. Tool will be offline for an update tonight, 9:00-9:15pm."
              className="w-full rounded border p-2 text-sm"
            />
            <div className="flex flex-wrap items-end gap-3">
              <label className="flex flex-col gap-1 text-xs text-gray-600">
                Level
                <select
                  value={level}
                  onChange={(e) => setLevel(e.target.value as NoticeLevel)}
                  className="h-8 rounded border bg-white px-2 text-sm"
                >
                  {NOTICE_LEVELS.map((l) => (
                    <option key={l} value={l}>
                      {LEVEL_LABEL[l]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-xs text-gray-600">
                Starts (optional - blank = now)
                <input
                  type="datetime-local"
                  value={startAt}
                  onChange={(e) => setStartAt(e.target.value)}
                  className="h-8 rounded border px-2 text-sm"
                />
              </label>
              <label className="flex flex-col gap-1 text-xs text-gray-600">
                Ends (optional - blank = stays up until taken down)
                <input
                  type="datetime-local"
                  value={endAt}
                  onChange={(e) => setEndAt(e.target.value)}
                  className="h-8 rounded border px-2 text-sm"
                />
              </label>
              <Button onClick={submit} disabled={posting}>
                {posting ? 'Posting...' : 'Post notice'}
              </Button>
            </div>
            <p className="text-xs text-gray-500">
              Posting this takes down whichever notice is currently live - only
              one shows at a time.
            </p>
            {formError && <p className="text-sm text-red-600">{formError}</p>}
          </div>

          {items.length === 0 ? (
            <p className="text-sm text-gray-500">No notices yet.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {items.map((item) => (
                <NoticeHistoryItem
                  key={item.id}
                  item={item}
                  onToggle={toggle}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
