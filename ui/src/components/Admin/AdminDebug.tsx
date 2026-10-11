import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  adminGetIssuedWarningsAndWatchesById,
  adminGetSevereWeatherOutlookAISummaryById,
  adminGetSevereWeatherOutlookById,
  adminGetThunderstormOutlookAISummaryById,
  adminGetThunderstormOutlookById,
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

// These are raw database lookups by document ID - useful for diagnosing a
// specific report, but not something to leave sitting in the open. They
// only run once AdminShell has verified the shared admin password, and the
// server functions themselves re-check it independently of that (see
// serverFuncs/Admin/index.ts) since a server function is its own real HTTP
// endpoint regardless of what the page around it shows.

function RawIdLookup<T>({
  id,
  label,
  description,
  search,
  renderResult,
}: {
  id: string;
  label: string;
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
    <Field className="w-full max-w-xl">
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
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

export function AdminDebug({ adminKey }: { adminKey: string }) {
  return (
    <div className="flex flex-col gap-6">
      <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
        Raw database lookups by document ID. For diagnosing a specific report
        when someone asks "what did this come in as" - not for general browsing.
      </div>

      <RawIdLookup<{
        outlooks?: (SevereWeatherOutlook & { insertedAt: Date })[];
      }>
        id="severe-weather-outlook"
        label="Severe Weather Outlook"
        search={async (id) => {
          const resp = await adminGetSevereWeatherOutlookById({
            data: { adminKey, id },
          });
          return resp.ok
            ? { ok: true, outlooks: resp.outlooks }
            : { ok: false, error: resp.error };
        }}
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

      <RawIdLookup<{
        outlooks?: (ThunderstormOutlook & { insertedAt: Date })[];
      }>
        id="thunderstorm-outlook"
        label="Thunderstorm Outlook"
        search={async (id) => {
          const resp = await adminGetThunderstormOutlookById({
            data: { adminKey, id },
          });
          return resp.ok
            ? { ok: true, outlooks: resp.outlooks }
            : { ok: false, error: resp.error };
        }}
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

      <RawIdLookup<{ entries?: IssuedAlertEntries[] }>
        id="issued-warnings-and-watches"
        label="Issued Warnings And Watches"
        search={async (id) => {
          const resp = await adminGetIssuedWarningsAndWatchesById({
            data: { adminKey, id },
          });
          return resp.ok
            ? { ok: true, entries: resp.entries }
            : { ok: false, error: resp.error };
        }}
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

      <RawIdLookup<{ summary?: AISevereWeatherOutlookSummaryResp | null }>
        id="severe-weather-outlook-ai-summary"
        label="Severe Weather Outlook AI Summary"
        description="Enter the Severe Weather Outlook ID (not the summary's own ID)."
        search={async (id) => {
          const resp = await adminGetSevereWeatherOutlookAISummaryById({
            data: { adminKey, outlookRefId: id },
          });
          return resp.ok
            ? { ok: true, summary: resp.summary }
            : { ok: false, error: resp.error };
        }}
        renderResult={(r) =>
          r.summary && (
            <ReactJson src={r.summary} collapsed={2} enableClipboard={false} />
          )
        }
      />

      <RawIdLookup<{ summary?: AIThunderstormOutlookSummaryResp | null }>
        id="thunderstorm-outlook-ai-summary"
        label="Thunderstorm Outlook AI Summary"
        description="Enter the Thunderstorm Outlook ID (not the summary's own ID)."
        search={async (id) => {
          const resp = await adminGetThunderstormOutlookAISummaryById({
            data: { adminKey, outlookRefId: id },
          });
          return resp.ok
            ? { ok: true, summary: resp.summary }
            : { ok: false, error: resp.error };
        }}
        renderResult={(r) =>
          r.summary && (
            <ReactJson src={r.summary} collapsed={2} enableClipboard={false} />
          )
        }
      />
    </div>
  );
}
