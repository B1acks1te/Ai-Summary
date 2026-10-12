import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  adminGetIssuedWarningsAndWatchesById,
  adminGetSevereWeatherOutlookAISummaryById,
  adminGetSevereWeatherOutlookById,
  adminGetThunderstormOutlookAISummaryById,
  adminGetThunderstormOutlookById,
  adminListIssuedWarningsAndWatchesByDate,
  adminListSevereWeatherOutlookAISummaryByDate,
  adminListSevereWeatherOutlookByDate,
  adminListThunderstormOutlookAISummaryByDate,
  adminListThunderstormOutlookByDate,
  type DateListItem,
} from '@/serverFuncs/Admin';
import type {
  AISevereWeatherOutlookSummaryResp,
  AIThunderstormOutlookSummaryResp,
  IssuedAlertEntries,
  SevereWeatherOutlook,
  ThunderstormOutlook,
} from '@/types';
import type { ReactNode } from 'react';
import { useState } from 'react';
import ReactJson from 'react-json-view';

// These are raw database lookups - useful for diagnosing a specific report,
// but not something to leave sitting in the open. They only run once
// AdminShell has verified the shared admin password, and the server
// functions themselves re-check it independently of that (see
// serverFuncs/Admin/index.ts) since a server function is its own real HTTP
// endpoint regardless of what the page around it shows.

function formatNZTime(iso: string): string {
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

// "2026-10-11" in NZ local time, as a sensible default for the date picker.
function todayNZDate(): string {
  return new Date().toLocaleDateString('en-CA', {
    timeZone: 'Pacific/Auckland',
  });
}

// Type found by its raw ID (unchanged behaviour, just factored out of the
// combined section below).
function RawIdLookup<T>({
  id,
  description,
  search,
  renderResult,
}: {
  id: string;
  description?: string;
  search: (id: string) => Promise<{ ok: boolean; error?: string } & T>;
  renderResult: (result: T) => ReactNode;
}) {
  const [value, setValue] = useState('');
  const [result, setResult] = useState<T | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const onSearch = async () => {
    if (!value.trim()) return;
    setLoading(true);
    setError('');
    const resp = await search(value.trim());
    setLoading(false);
    if (resp.ok) {
      setResult(resp);
    } else {
      setResult(null);
      setError(resp.error || 'Lookup failed.');
    }
  };

  return (
    <Field>
      <Field orientation="horizontal">
        <Input
          id={id}
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onSearch();
          }}
        />
        <Button onClick={onSearch} disabled={loading}>
          {loading ? 'Searching...' : 'Search'}
        </Button>
      </Field>
      {description && <FieldDescription>{description}</FieldDescription>}
      {error && <p className="text-sm text-red-600">{error}</p>}
      {result && renderResult(result)}
    </Field>
  );
}

// Browse a given NZ calendar day instead of needing a raw ID at all. Lists
// everything from that day with a short preview; clicking one fetches and
// expands its full JSON in place, using the exact same lookup function the
// "By ID" tab uses (date-list items already carry whatever ID that function
// expects, including outlookRefId for the two AI-summary types).
function DateBrowser<T>({
  description,
  listByDate,
  fetchDetail,
  renderResult,
}: {
  description?: string;
  listByDate: (
    date: string,
  ) => Promise<{ ok: boolean; items?: DateListItem[]; error?: string }>;
  fetchDetail: (id: string) => Promise<{ ok: boolean; error?: string } & T>;
  renderResult: (result: T) => ReactNode;
}) {
  const [date, setDate] = useState(todayNZDate);
  const [items, setItems] = useState<DateListItem[] | null>(null);
  const [listError, setListError] = useState('');
  const [listLoading, setListLoading] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<T | null>(null);
  const [detailError, setDetailError] = useState('');
  const [detailLoading, setDetailLoading] = useState(false);

  const onBrowse = async () => {
    setListLoading(true);
    setListError('');
    setItems(null);
    setOpenId(null);
    setDetail(null);
    const resp = await listByDate(date);
    setListLoading(false);
    if (resp.ok) {
      setItems(resp.items ?? []);
    } else {
      setListError(resp.error || 'Could not load that day.');
    }
  };

  const onToggle = async (itemId: string) => {
    if (openId === itemId) {
      setOpenId(null);
      return;
    }
    setOpenId(itemId);
    setDetail(null);
    setDetailError('');
    setDetailLoading(true);
    const resp = await fetchDetail(itemId);
    setDetailLoading(false);
    if (resp.ok) {
      setDetail(resp);
    } else {
      setDetailError(resp.error || 'Could not load that entry.');
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="date"
          value={date}
          max={todayNZDate()}
          onChange={(e) => setDate(e.target.value)}
          className="h-9 rounded border px-2 text-sm"
        />
        <Button onClick={onBrowse} disabled={listLoading || !date}>
          {listLoading ? 'Browsing...' : 'Browse'}
        </Button>
      </div>
      {description && <FieldDescription>{description}</FieldDescription>}
      {listError && <p className="text-sm text-red-600">{listError}</p>}
      {items && items.length === 0 && (
        <p className="text-xs text-gray-500">Nothing found for that day.</p>
      )}
      {items && items.length > 0 && (
        <div className="flex flex-col gap-1.5">
          {items.map((item) => (
            <div
              key={item.id}
              className="rounded-md border bg-gray-50 text-xs overflow-hidden"
            >
              <button
                type="button"
                onClick={() => onToggle(item.id)}
                className="flex w-full items-center justify-between gap-2 px-2.5 py-1.5 text-left hover:bg-gray-100"
              >
                <span>
                  <span className="font-medium">{formatNZTime(item.when)}</span>
                  {' — '}
                  {item.preview}
                </span>
                <span className="shrink-0 text-gray-400">
                  {openId === item.id ? 'Hide' : 'View'}
                </span>
              </button>
              {openId === item.id && (
                <div className="border-t bg-white p-2">
                  {detailLoading ? (
                    <p className="text-gray-500">Loading...</p>
                  ) : detailError ? (
                    <p className="text-red-600">{detailError}</p>
                  ) : (
                    detail && renderResult(detail)
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// One card per data type: a title, a By ID / By date toggle, and whichever
// of the two widgets above is currently selected. `search` is reused as
// both the "By ID" lookup and the detail-fetch for a "By date" result, since
// a date-list item's `id` is already whatever `search` expects.
function LookupSection<T>({
  htmlId,
  title,
  idDescription,
  dateDescription,
  search,
  listByDate,
  renderResult,
}: {
  htmlId: string;
  title: string;
  idDescription?: string;
  dateDescription?: string;
  search: (id: string) => Promise<{ ok: boolean; error?: string } & T>;
  listByDate: (
    date: string,
  ) => Promise<{ ok: boolean; items?: DateListItem[]; error?: string }>;
  renderResult: (result: T) => ReactNode;
}) {
  const [mode, setMode] = useState<'id' | 'date'>('date');

  return (
    <div className="flex flex-col gap-3 rounded-lg border bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <FieldLabel htmlFor={htmlId} className="text-sm font-semibold">
          {title}
        </FieldLabel>
        <div className="flex items-center gap-1 text-xs">
          <button
            type="button"
            onClick={() => setMode('date')}
            className={
              mode === 'date'
                ? 'rounded bg-blue-100 px-2 py-1 font-medium text-blue-800'
                : 'rounded px-2 py-1 text-gray-500 hover:bg-gray-100'
            }
          >
            By date
          </button>
          <button
            type="button"
            onClick={() => setMode('id')}
            className={
              mode === 'id'
                ? 'rounded bg-blue-100 px-2 py-1 font-medium text-blue-800'
                : 'rounded px-2 py-1 text-gray-500 hover:bg-gray-100'
            }
          >
            By ID
          </button>
        </div>
      </div>
      {mode === 'id' ? (
        <RawIdLookup
          id={htmlId}
          description={idDescription}
          search={search}
          renderResult={renderResult}
        />
      ) : (
        <DateBrowser
          description={dateDescription}
          listByDate={listByDate}
          fetchDetail={search}
          renderResult={renderResult}
        />
      )}
    </div>
  );
}

export function AdminDebug({ adminKey }: { adminKey: string }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
        Raw database lookups - for diagnosing a specific report, or looking back
        at what came in on a given day. Not for general browsing.
      </div>

      <LookupSection<{
        outlooks?: (SevereWeatherOutlook & { insertedAt: Date })[];
      }>
        htmlId="severe-weather-outlook"
        title="Severe Weather Outlook"
        search={async (id) => {
          const resp = await adminGetSevereWeatherOutlookById({
            data: { adminKey, id },
          });
          return resp.ok
            ? { ok: true, outlooks: resp.outlooks }
            : { ok: false, error: resp.error };
        }}
        listByDate={(date) =>
          adminListSevereWeatherOutlookByDate({ data: { adminKey, date } })
        }
        renderResult={(r) =>
          r.outlooks?.map((outlook) => (
            <ReactJson
              key={outlook.id}
              src={outlook}
              collapsed={2}
              enableClipboard={false}
            />
          ))
        }
      />

      <LookupSection<{
        outlooks?: (ThunderstormOutlook & { insertedAt: Date })[];
      }>
        htmlId="thunderstorm-outlook"
        title="Thunderstorm Outlook"
        search={async (id) => {
          const resp = await adminGetThunderstormOutlookById({
            data: { adminKey, id },
          });
          return resp.ok
            ? { ok: true, outlooks: resp.outlooks }
            : { ok: false, error: resp.error };
        }}
        listByDate={(date) =>
          adminListThunderstormOutlookByDate({ data: { adminKey, date } })
        }
        renderResult={(r) =>
          r.outlooks?.map((outlook) => (
            <ReactJson
              key={outlook.id}
              src={outlook}
              collapsed={2}
              enableClipboard={false}
            />
          ))
        }
      />

      <LookupSection<{ entries?: IssuedAlertEntries[] }>
        htmlId="issued-warnings-and-watches"
        title="Issued Warnings And Watches"
        search={async (id) => {
          const resp = await adminGetIssuedWarningsAndWatchesById({
            data: { adminKey, id },
          });
          return resp.ok
            ? { ok: true, entries: resp.entries }
            : { ok: false, error: resp.error };
        }}
        listByDate={(date) =>
          adminListIssuedWarningsAndWatchesByDate({
            data: { adminKey, date },
          })
        }
        renderResult={(r) =>
          r.entries?.map((entry) => (
            <ReactJson
              key={entry.id}
              src={entry}
              collapsed={2}
              enableClipboard={false}
            />
          ))
        }
      />

      <LookupSection<{ summary?: AISevereWeatherOutlookSummaryResp | null }>
        htmlId="severe-weather-outlook-ai-summary"
        title="Severe Weather Outlook AI Summary"
        idDescription="Enter the Severe Weather Outlook ID (not the summary's own ID)."
        dateDescription="Finds summaries generated on this day."
        search={async (id) => {
          const resp = await adminGetSevereWeatherOutlookAISummaryById({
            data: { adminKey, outlookRefId: id },
          });
          return resp.ok
            ? { ok: true, summary: resp.summary }
            : { ok: false, error: resp.error };
        }}
        listByDate={(date) =>
          adminListSevereWeatherOutlookAISummaryByDate({
            data: { adminKey, date },
          })
        }
        renderResult={(r) =>
          r.summary && (
            <ReactJson src={r.summary} collapsed={2} enableClipboard={false} />
          )
        }
      />

      <LookupSection<{ summary?: AIThunderstormOutlookSummaryResp | null }>
        htmlId="thunderstorm-outlook-ai-summary"
        title="Thunderstorm Outlook AI Summary"
        idDescription="Enter the Thunderstorm Outlook ID (not the summary's own ID)."
        dateDescription="Finds summaries generated on this day."
        search={async (id) => {
          const resp = await adminGetThunderstormOutlookAISummaryById({
            data: { adminKey, outlookRefId: id },
          });
          return resp.ok
            ? { ok: true, summary: resp.summary }
            : { ok: false, error: resp.error };
        }}
        listByDate={(date) =>
          adminListThunderstormOutlookAISummaryByDate({
            data: { adminKey, date },
          })
        }
        renderResult={(r) =>
          r.summary && (
            <ReactJson src={r.summary} collapsed={2} enableClipboard={false} />
          )
        }
      />
    </div>
  );
}
