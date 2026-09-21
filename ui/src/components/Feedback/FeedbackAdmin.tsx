import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  FEEDBACK_STATUSES,
  FEEDBACK_TYPES,
  listFeedback,
  updateFeedback,
  type FeedbackItem,
  type FeedbackStatus,
  type FeedbackType,
} from '@/serverFuncs/Feedback';
import { useEffect, useState } from 'react';

const KEY_STORAGE = 'feedback-admin-key';

const TYPE_LABEL: Record<FeedbackType, string> = {
  bug: 'Bug',
  data: 'Wrong or missing data',
  change: 'Change request',
  feature: 'New feature idea',
  question: 'Question',
};

const STATUS_LABEL: Record<FeedbackStatus, string> = {
  new: 'New',
  triaged: 'Triaged',
  done: 'Done',
  wont_do: "Won't do",
};

function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-NZ', {
    timeZone: 'Pacific/Auckland',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

// Quote CSV cells, and defuse anything Excel might treat as a formula.
function csvCell(value: unknown): string {
  let text = String(value ?? '');
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function downloadCsv(items: FeedbackItem[]) {
  const header = [
    'ref',
    'created',
    'type',
    'status',
    'page',
    'contact',
    'description',
    'notes',
    'browser',
    'context',
  ];
  const rows = items.map((i) => [
    i.ref,
    i.createdAt,
    TYPE_LABEL[i.type],
    STATUS_LABEL[i.status],
    i.page,
    i.contact,
    i.description,
    i.notes,
    i.userAgent,
    JSON.stringify(i.context),
  ]);
  const csv = [header, ...rows]
    .map((row) => row.map(csvCell).join(','))
    .join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `feedback-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

type SaveFn = (
  ref: string,
  patch: { status?: FeedbackStatus; notes?: string },
) => Promise<string | null>;

function FeedbackCard({
  item,
  onSave,
}: {
  item: FeedbackItem;
  onSave: SaveFn;
}) {
  const [notes, setNotes] = useState(item.notes);
  const [message, setMessage] = useState('');

  const save = async (patch: { status?: FeedbackStatus; notes?: string }) => {
    setMessage('Saving...');
    const err = await onSave(item.ref, patch);
    setMessage(err ?? 'Saved');
  };

  return (
    <div className="border rounded-md p-3 flex flex-col gap-2 bg-white text-sm">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-semibold">{item.ref}</span>
        <span className="rounded bg-gray-100 px-1.5 py-0.5 text-xs">
          {TYPE_LABEL[item.type]}
        </span>
        <span className="text-xs text-gray-500">
          {formatWhen(item.createdAt)}
        </span>
        <span className="text-xs text-gray-500">{item.env}</span>
        {!item.notified && (
          <span
            className="text-xs text-amber-700"
            title="The Discord notification wasn't delivered for this one"
          >
            not notified
          </span>
        )}
        <select
          value={item.status}
          onChange={(e) => save({ status: e.target.value as FeedbackStatus })}
          className="ml-auto h-7 rounded border bg-white px-2 text-xs"
        >
          {FEEDBACK_STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABEL[s]}
            </option>
          ))}
        </select>
      </div>

      <p className="whitespace-pre-wrap">{item.description}</p>

      <div className="text-xs text-gray-500 flex flex-wrap gap-x-4">
        <span>Page: {item.page || '-'}</span>
        <span>From: {item.contact || 'Anonymous'}</span>
      </div>

      <details className="text-xs text-gray-500">
        <summary className="cursor-pointer select-none">Context</summary>
        <pre className="mt-1 whitespace-pre-wrap break-words">
          {Object.entries(item.context)
            .map(([k, v]) => `${k}: ${String(v)}`)
            .concat([`browser: ${item.userAgent || '-'}`])
            .join('\n')}
        </pre>
      </details>

      <div className="flex flex-col gap-1">
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          maxLength={2000}
          placeholder="Triage notes (only visible here)"
          className="w-full rounded border p-2 text-xs"
        />
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="secondary"
            disabled={notes === item.notes}
            onClick={() => save({ notes })}
          >
            Save notes
          </Button>
          <span className="text-xs text-gray-500">{message}</span>
        </div>
      </div>
    </div>
  );
}

export function FeedbackAdmin() {
  const [adminKey, setAdminKey] = useState('');
  const [items, setItems] = useState<FeedbackItem[] | null>(null);
  const [statusFilter, setStatusFilter] = useState<FeedbackStatus | ''>('');
  const [typeFilter, setTypeFilter] = useState<FeedbackType | ''>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = async (
    key: string,
    status: FeedbackStatus | '',
    type: FeedbackType | '',
  ) => {
    if (!key) return;
    setLoading(true);
    setError('');
    const resp = await listFeedback({
      data: {
        adminKey: key,
        status: status || undefined,
        type: type || undefined,
      },
    });
    setLoading(false);
    if (resp.ok && resp.items) {
      setItems(resp.items);
      try {
        window.sessionStorage.setItem(KEY_STORAGE, key);
      } catch {
        // storage blocked - you'll just be asked for the key again next time
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
        setError(resp.error || 'Could not load feedback.');
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
        void load(saved, '', '');
      }
    } catch {
      // ignore
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save: SaveFn = async (ref, patch) => {
    const resp = await updateFeedback({ data: { adminKey, ref, ...patch } });
    const updated = resp.item;
    if (resp.ok && updated) {
      setItems((prev) =>
        prev ? prev.map((i) => (i.ref === ref ? updated : i)) : prev,
      );
      return null;
    }
    return resp.error || 'Could not save.';
  };

  const counts = (items ?? []).reduce<Record<string, number>>((acc, i) => {
    acc[i.status] = (acc[i.status] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div className="flex flex-col gap-3 border rounded-lg p-4 bg-gray-50">
      <div>
        <h2 className="text-lg font-semibold">Feedback</h2>
        <p className="text-xs text-gray-500">
          Reports sent from the Feedback button in this environment. Sign in
          with the feedback password to view them.
        </p>
      </div>

      {items === null ? (
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void load(adminKey, statusFilter, typeFilter);
          }}
        >
          {/* Visually hidden username so browsers can offer to remember the
              password for you. */}
          <input
            type="text"
            name="username"
            value="feedback"
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
        </form>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-gray-500">Signed in</span>
          <Button
            onClick={() => load(adminKey, statusFilter, typeFilter)}
            disabled={loading}
          >
            {loading ? 'Loading...' : 'Refresh'}
          </Button>
          {items.length > 0 && (
            <Button variant="secondary" onClick={() => downloadCsv(items)}>
              Export CSV
            </Button>
          )}
          <Button variant="ghost" onClick={signOut}>
            Sign out
          </Button>
        </div>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}

      {items && (
        <>
          <div className="flex flex-wrap items-center gap-3 text-xs">
            <select
              value={statusFilter}
              onChange={(e) => {
                const v = e.target.value as FeedbackStatus | '';
                setStatusFilter(v);
                void load(adminKey, v, typeFilter);
              }}
              className="h-8 rounded border bg-white px-2"
            >
              <option value="">All statuses</option>
              {FEEDBACK_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABEL[s]}
                </option>
              ))}
            </select>
            <select
              value={typeFilter}
              onChange={(e) => {
                const v = e.target.value as FeedbackType | '';
                setTypeFilter(v);
                void load(adminKey, statusFilter, v);
              }}
              className="h-8 rounded border bg-white px-2"
            >
              <option value="">All types</option>
              {FEEDBACK_TYPES.map((t) => (
                <option key={t} value={t}>
                  {TYPE_LABEL[t]}
                </option>
              ))}
            </select>
            <span className="text-gray-500">
              {items.length} shown
              {FEEDBACK_STATUSES.filter((s) => counts[s]).map(
                (s) => ` · ${STATUS_LABEL[s]}: ${counts[s]}`,
              )}
            </span>
          </div>

          {items.length === 0 ? (
            <p className="text-sm text-gray-500">No feedback yet.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {items.map((item) => (
                <FeedbackCard key={item.ref} item={item} onSave={save} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}