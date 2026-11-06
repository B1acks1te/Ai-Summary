import { useEffect, useState } from 'react';
import { CheckCircle2, RefreshCw, UploadCloud } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { adminRegenerateGanttAt, adminUpdateGanttSnapshot } from '@/serverFuncs/Admin';
import { getGanttSnapshots } from '@/serverFuncs/Gantt';
import type { GanttChart, GanttSnapshot } from '@/types/gantt';
import { DEFAULT_GANTT_RENDER_OPTIONS } from '@/types/gantt';
import { GanttCanvas } from '@/components/Gantt/GanttCanvas';

// ADMIN ONLY — see serverFuncs/Admin/index.ts's adminRegenerateGanttAt and
// main-services' POST /regenerate-gantt-at. Re-runs whatever issued alerts
// were "latest" as of a chosen moment through the CURRENT extraction code,
// without touching the rolling auto-captured snapshot list — purely for
// verifying a fix against a real past case (e.g. a snapshot that showed a
// bug) without waiting for "latest" to naturally cycle back to it.
//
// Deliberately kept off the public Gantt page: this triggers an on-demand
// AI call against arbitrary historical data, which isn't something to leave
// open to anyone who finds the page.

function formatSnapshotTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-NZ', {
    timeZone: 'Pacific/Auckland',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// "2026-10-26T08:30" in NZ local time, the shape <input type="datetime-local">
// needs — used only as a sensible default for the manual picker below.
function nowAsLocalInputValue(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`;
}

export function GanttRegenAdmin({ adminKey }: { adminKey: string }) {
  const [snapshots, setSnapshots] = useState<GanttSnapshot[] | null>(null);
  const [loadingSnapshots, setLoadingSnapshots] = useState(true);

  const [regeneratingKey, setRegeneratingKey] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [result, setResult] = useState<{
    chart: GanttChart;
    matchedAt: string | null;
    sourceText?: string;
    requestedLabel: string;
    // Set ONLY when this regeneration came from clicking an existing
    // snapshot button below (not the manual time picker) — that's the
    // document id "Replace public snapshot" writes back to. A manual time
    // might not land on an existing snapshot, so there's nothing to
    // replace for it; regenerating from one, below, is the only path that
    // can publish.
    sourceSnapshotId?: string;
  } | null>(null);

  // Publishing (replacing the public snapshot) is a separate, explicit
  // step after reviewing the regenerated chart above — never automatic.
  const [publishConfirming, setPublishConfirming] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [publishedMsg, setPublishedMsg] = useState('');

  const [manualAt, setManualAt] = useState(nowAsLocalInputValue());

  const loadSnapshots = async () => {
    const resp = await getGanttSnapshots();
    setLoadingSnapshots(false);
    if (resp.ok && resp.snapshots) setSnapshots(resp.snapshots);
  };

  useEffect(() => {
    void loadSnapshots();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const regenerateAt = async (
    atIso: string,
    label: string,
    key: string,
    sourceSnapshotId?: string,
  ) => {
    setRegeneratingKey(key);
    setError('');
    setPublishedMsg('');
    setPublishConfirming(false);
    const resp = await adminRegenerateGanttAt({
      data: { adminKey, at: atIso },
    });
    setRegeneratingKey(null);
    if (resp.ok) {
      setResult({
        chart: resp.chart,
        matchedAt: resp.matchedAt,
        sourceText: resp.sourceText,
        requestedLabel: label,
        sourceSnapshotId,
      });
    } else {
      setResult(null);
      setError(resp.error || 'Regeneration failed.');
    }
  };

  const onPublish = async () => {
    if (!result?.sourceSnapshotId) return;
    setPublishing(true);
    setError('');
    const resp = await adminUpdateGanttSnapshot({
      data: {
        adminKey,
        id: result.sourceSnapshotId,
        chart: result.chart,
      },
    });
    setPublishing(false);
    setPublishConfirming(false);
    if (resp.ok) {
      setPublishedMsg(
        `Public snapshot "${result.requestedLabel}" updated — users visiting the Gantt page now see this corrected chart.`,
      );
      void loadSnapshots();
    } else {
      setError(resp.error || 'Could not update the public snapshot.');
    }
  };

  return (
    <div className="flex flex-col gap-6 max-w-5xl">
      <p className="text-xs text-gray-500">
        Re-runs a past moment's issued-alerts data through the current Gantt
        extraction code. Regenerating alone saves nothing — the stored
        auto-captured snapshot is untouched, so you can compare the result
        against it first. If it looks right, "Replace public snapshot"
        writes it back in place, which is what the public Gantt page
        actually shows.
      </p>

      <Field>
        <FieldLabel>Auto-captured snapshots</FieldLabel>
        <FieldDescription>
          {loadingSnapshots
            ? 'Loading...'
            : !snapshots || snapshots.length === 0
              ? 'No snapshots captured yet.'
              : 'Pick one to regenerate its original alert data with the current code.'}
        </FieldDescription>
        <div className="flex flex-wrap gap-2">
          {snapshots?.map((snap, i) => (
            <Button
              key={snap.id}
              size="sm"
              variant="outline"
              disabled={regeneratingKey === snap.id}
              onClick={() =>
                regenerateAt(
                  snap.insertedAt,
                  i === 0 ? 'Latest snapshot' : formatSnapshotTime(snap.insertedAt),
                  snap.id,
                  snap.id,
                )
              }
              className="flex items-center gap-1.5"
            >
              <RefreshCw
                size={12}
                className={regeneratingKey === snap.id ? 'animate-spin' : ''}
              />
              {i === 0 ? 'Latest' : formatSnapshotTime(snap.insertedAt)}
            </Button>
          ))}
        </div>
      </Field>

      <Field>
        <FieldLabel htmlFor="gantt-regen-at">
          Regenerate at a specific time
        </FieldLabel>
        <FieldDescription>
          For a moment further back than the last 5 snapshots. Finds
          whatever issued-alerts record was "latest" at or before this time
          (NZ local).
        </FieldDescription>
        <Field orientation="horizontal">
          <Input
            id="gantt-regen-at"
            type="datetime-local"
            value={manualAt}
            onChange={(e) => setManualAt(e.target.value)}
            className="max-w-xs"
          />
          <Button
            size="sm"
            disabled={!manualAt || regeneratingKey === 'manual'}
            onClick={() =>
              regenerateAt(
                new Date(manualAt).toISOString(),
                formatSnapshotTime(new Date(manualAt).toISOString()),
                'manual',
              )
            }
            className="flex items-center gap-1.5"
          >
            <RefreshCw
              size={12}
              className={regeneratingKey === 'manual' ? 'animate-spin' : ''}
            />
            Regenerate
          </Button>
        </Field>
      </Field>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {publishedMsg && (
        <p className="text-sm text-green-700 flex items-center gap-1.5">
          <CheckCircle2 size={14} />
          {publishedMsg}
        </p>
      )}

      {result && (
        <div className="flex flex-col gap-2 border rounded-lg p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-gray-500">
              Regenerated for <span className="font-medium">{result.requestedLabel}</span>
              {result.matchedAt && (
                <>
                  {' '}
                  — matched issued-alerts record from{' '}
                  <span className="font-medium">
                    {formatSnapshotTime(result.matchedAt)}
                  </span>
                </>
              )}
              . Not saved{result.sourceSnapshotId ? ' yet' : ''}.
            </p>

            {result.sourceSnapshotId && !publishConfirming && (
              <Button
                size="sm"
                variant="default"
                onClick={() => setPublishConfirming(true)}
                className="flex items-center gap-1.5"
              >
                <UploadCloud size={14} />
                Replace public snapshot
              </Button>
            )}
            {result.sourceSnapshotId && publishConfirming && (
              <div className="flex items-center gap-2 text-xs">
                <span className="text-amber-700 font-medium">
                  Replace the public &quot;{result.requestedLabel}&quot; snapshot
                  with this chart?
                </span>
                <Button
                  size="sm"
                  disabled={publishing}
                  onClick={onPublish}
                >
                  {publishing ? 'Publishing...' : 'Yes, replace it'}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={publishing}
                  onClick={() => setPublishConfirming(false)}
                >
                  Cancel
                </Button>
              </div>
            )}
          </div>
          <div className="overflow-x-auto">
            <GanttCanvas
              data={result.chart}
              options={DEFAULT_GANTT_RENDER_OPTIONS}
            />
          </div>
          {result.chart.notes?.length > 0 && (
            <div className="text-xs text-gray-500">
              <div className="font-semibold mb-1">Notes from extractor:</div>
              <ul className="list-disc pl-5 space-y-0.5">
                {result.chart.notes.map((n, i) => (
                  <li key={i}>{n}</li>
                ))}
              </ul>
            </div>
          )}
          {result.sourceText && (
            <details className="text-xs">
              <summary className="cursor-pointer text-gray-500 select-none">
                Source text sent to the extractor
              </summary>
              <pre className="mt-2 whitespace-pre-wrap border rounded p-2 bg-gray-50 text-[11px]">
                {result.sourceText}
              </pre>
            </details>
          )}
        </div>
      )}
    </div>
  );
}