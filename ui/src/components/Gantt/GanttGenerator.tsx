import {
  Fragment,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
} from 'react';
import { Filter } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  generateGanttFromInput,
  generateGanttFromLatest,
  getGanttSnapshots,
} from '@/serverFuncs/Gantt';
import type { GanttChart, GanttSnapshot } from '@/types/gantt';
import type { GanttHazardType, GanttSeverity } from '@/types/gantt';
import {
  GanttCanvas,
  downloadGanttPng,
  sortBarsGeographically,
} from './GanttCanvas';
import { GanttBarEditor } from './GanttBarEditor';

type Status = 'idle' | 'loading' | 'success' | 'error';

// The three "regional" hazard types share the same watch/orange/red severity
// scale, so they get one filter row each. Road snowfall is filtered as a
// single on/off toggle instead — it only ever appears with severity
// "warning" (no colour) in practice.
type RegionalHazard = 'rain' | 'wind' | 'snow';
type SeverityFilterKey = 'watch' | 'orange_warning' | 'red_warning';

const REGIONAL_HAZARDS: RegionalHazard[] = ['rain', 'wind', 'snow'];
const SEVERITY_FILTER_KEYS: SeverityFilterKey[] = [
  'watch',
  'orange_warning',
  'red_warning',
];

const HAZARD_FILTER_LABEL: Record<RegionalHazard, string> = {
  rain: 'Rain',
  wind: 'Wind',
  snow: 'Snow',
};

const SEVERITY_FILTER_LABEL: Record<SeverityFilterKey, string> = {
  watch: 'Watch',
  orange_warning: 'Orange Warning',
  red_warning: 'Red Warning',
};

// localStorage key for whether the "How to use this page" panel is open, so a
// choice to minimise it is remembered across refreshes (per browser).
const HOW_TO_STORAGE_KEY = 'gantt-how-to-open';

// A bar's severity is "warning" (uncoloured) when the source didn't state a
// colour — visually and for filtering purposes this is grouped with orange,
// same as the render logic in GanttCanvas already treats it.
function severityFilterKey(severity: GanttSeverity): SeverityFilterKey {
  if (severity === 'watch') return 'watch';
  if (severity === 'red_warning') return 'red_warning';
  return 'orange_warning';
}

function defaultVisibleSeverities(): Record<RegionalHazard, Set<SeverityFilterKey>> {
  return {
    rain: new Set(SEVERITY_FILTER_KEYS),
    wind: new Set(SEVERITY_FILTER_KEYS),
    snow: new Set(SEVERITY_FILTER_KEYS),
  };
}

function formatSnapshotTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    weekday: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function GanttGenerator() {
  const [input, setInput] = useState('');
  const [chart, setChart] = useState<GanttChart | null>(null);
  const [jsonText, setJsonText] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [statusMsg, setStatusMsg] = useState('');
  const [visibleSeverities, setVisibleSeverities] = useState<
    Record<RegionalHazard, Set<SeverityFilterKey>>
  >(defaultVisibleSeverities());
  const [showRoadSnowfall, setShowRoadSnowfall] = useState(true);

  const toggleSeverity = (hazard: RegionalHazard, key: SeverityFilterKey) => {
    setVisibleSeverities((prev) => {
      const next = new Set(prev[hazard]);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return { ...prev, [hazard]: next };
    });
  };

  // Filter popover — closes on outside click, same interaction pattern as
  // any standard dropdown/menu. Badge count = how many hazard/severity
  // combinations are currently hidden (0 when everything's visible, so the
  // badge only appears once a filter is actually active).
  const [filterOpen, setFilterOpen] = useState(false);
  const filterRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!filterOpen) return;
    const onClickOutside = (e: MouseEvent) => {
      if (filterRef.current && !filterRef.current.contains(e.target as Node)) {
        setFilterOpen(false);
      }
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [filterOpen]);

  const hiddenFilterCount = useMemo(() => {
    const totalPossible = REGIONAL_HAZARDS.length * SEVERITY_FILTER_KEYS.length + 1;
    const totalVisible =
      REGIONAL_HAZARDS.reduce((sum, h) => sum + visibleSeverities[h].size, 0) +
      (showRoadSnowfall ? 1 : 0);
    return totalPossible - totalVisible;
  }, [visibleSeverities, showRoadSnowfall]);

  // Auto-captured snapshots (last 5, newest first) — see captureGanttSnapshot
  // on the backend. Viewing/editing one here is local-only: nothing written
  // back is ever persisted to the snapshot itself.
  const [snapshots, setSnapshots] = useState<GanttSnapshot[] | null>(null);
  const [selectedSnapshotId, setSelectedSnapshotId] = useState<string | null>(
    null,
  );
  // True when MetService has no watches or warnings in force right now. The
  // newest snapshot is then stale (snapshots are only captured while alerts
  // exist), so the chart area shows a holding message instead of it.
  const [noActiveAlerts, setNoActiveAlerts] = useState(false);

  // "How to use this page": open by default (including on the server render),
  // but once someone minimises it that choice is remembered and applied on the
  // next visit. Read after mount because localStorage doesn't exist during SSR.
  const [howToOpen, setHowToOpen] = useState(true);
  useEffect(() => {
    try {
      if (window.localStorage.getItem(HOW_TO_STORAGE_KEY) === 'false') {
        setHowToOpen(false);
      }
    } catch {
      // storage blocked (e.g. private mode) — just stay open
    }
  }, []);
  const toggleHowTo = () => {
    const next = !howToOpen;
    setHowToOpen(next);
    try {
      window.localStorage.setItem(HOW_TO_STORAGE_KEY, String(next));
    } catch {
      // storage blocked — the toggle still works, it just isn't remembered
    }
  };

  // Filtering is applied here — to both the on-screen chart and any PNG
  // export — rather than at generation time, so toggling filters never
  // requires a re-generation. Everything is visible by default.
  const displayChart = useMemo(() => {
    if (!chart) return chart;
    const bars = chart.bars.filter((bar) => {
      if (bar.hazard_type === 'road_snow') return showRoadSnowfall;
      const key = severityFilterKey(bar.severity);
      return visibleSeverities[bar.hazard_type as RegionalHazard].has(key);
    });
    return { ...chart, bars };
  }, [chart, visibleSeverities, showRoadSnowfall]);

  const handleResult = (
    data: GanttChart,
    sourceText?: string,
    fromSnapshotId?: string,
  ) => {
    const sorted: GanttChart = {
      ...data,
      bars: sortBarsGeographically(data.bars),
    };
    setSelectedSnapshotId(fromSnapshotId ?? null);
    setChart(sorted);
    setJsonText(JSON.stringify(sorted, null, 2));
    setStatus('success');

    const warnings: string[] = [];
    sorted.bars.forEach((b) => {
      const startMs = new Date(b.start).getTime();
      const endMs = new Date(b.end).getTime();
      const hrs = (endMs - startMs) / 3600000;
      if (hrs <= 0) warnings.push(`${b.label}: end ≤ start`);
      if (hrs > 72) warnings.push(`${b.label}: span ${hrs}h`);
    });
    setStatusMsg(
      `Rendered ${sorted.bars.length} bars` +
        (warnings.length ? ` — checks: ${warnings.join('; ')}` : ''),
    );
    if (sourceText) setInput(sourceText);
  };

  const onGenerateFromInput = async () => {
    if (!input.trim()) {
      setStatus('error');
      setStatusMsg('Paste MetService warning data first.');
      return;
    }
    setStatus('loading');
    setStatusMsg('Parsing warnings via Claude...');
    const resp = await generateGanttFromInput({ data: { input: input.trim() } });
    if (resp.ok && resp.chart) {
      handleResult(resp.chart);
    } else {
      setStatus('error');
      setStatusMsg(resp.error || 'Unknown error');
      toast.error(resp.error || 'Generation failed');
    }
  };

  const onGenerateFromLatest = async () => {
    setStatus('loading');
    setStatusMsg('Loading latest issued alerts and parsing via Claude...');
    const resp = await generateGanttFromLatest();
    if (resp.ok && resp.noActiveAlerts) {
      setChart(null);
      setJsonText('');
      setSelectedSnapshotId(null);
      setNoActiveAlerts(true);
      setStatus('idle');
      setStatusMsg('No watches or warnings are currently in force.');
      toast.info('No watches or warnings in force');
    } else if (resp.ok && resp.chart) {
      setNoActiveAlerts(false);
      handleResult(resp.chart, resp.sourceText);
      toast.success('Gantt generated from latest scraped alerts');
    } else {
      setStatus('error');
      setStatusMsg(resp.error || 'Unknown error');
      toast.error(resp.error || 'Generation failed');
    }
  };

  const onRerenderFromEdit = () => {
    try {
      const parsed = JSON.parse(jsonText) as GanttChart;
      handleResult(parsed);
      toast.success('Re-rendered from edited JSON');
    } catch (e) {
      setStatus('error');
      setStatusMsg(`JSON parse error: ${(e as Error).message}`);
    }
  };

  // Applies a reorder or a hazard_type/severity edit from GanttBarEditor.
  // This updates the actual chart data (source of truth for both the on-screen
  // canvas and PNG export), not just a preview — keeps jsonText in sync too.
  const onBarsChange = (newBars: GanttChart['bars']) => {
    if (!chart) return;
    const updated: GanttChart = { ...chart, bars: newBars };
    setChart(updated);
    setJsonText(JSON.stringify(updated, null, 2));
  };

  const onDownload = (dpi: number) => {
    if (!displayChart) return;
    downloadGanttPng(displayChart, dpi);
  };

  const selectSnapshot = (snap: GanttSnapshot) => {
    handleResult(
      { chart_title: snap.chart_title, bars: snap.bars, notes: snap.notes },
      undefined,
      snap.id,
    );
    setStatusMsg(
      `Viewing auto-captured snapshot from ${formatSnapshotTime(snap.insertedAt)}.` +
        (noActiveAlerts
          ? ' Nothing is in force right now, so this shows how things looked at that time.'
          : '') +
        " Edits here are temporary and won't be saved back to this snapshot.",
    );
  };

  // Load the last 5 auto-captured snapshots on mount, and show the latest
  // one immediately if nothing has been generated yet — so the page always
  // has something useful on it rather than an empty "Awaiting data" state.
  useEffect(() => {
    (async () => {
      const resp = await getGanttSnapshots();
      if (resp.ok && resp.snapshots) {
        setSnapshots(resp.snapshots);
        setNoActiveAlerts(!!resp.noActiveAlerts);
        // With nothing in force the newest snapshot is out of date, so don't
        // show it by default — the holding message is shown instead.
        if (resp.snapshots.length > 0 && !chart && !resp.noActiveAlerts) {
          selectSnapshot(resp.snapshots[0]);
        }
      }
    })();
    // Only ever run once on mount — this is a one-time initial load, not a
    // live subscription (the manual generate/edit flows manage state after).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex flex-col gap-4 p-6">
      <details
        open={howToOpen}
        className="border rounded-lg bg-blue-50/50 border-blue-100 text-sm"
      >
        <summary
          onClick={(e) => {
            // controlled: we own the open state so it can be remembered
            e.preventDefault();
            toggleHowTo();
          }}
          className="cursor-pointer select-none font-medium px-4 py-2.5 text-blue-900"
        >
          How to use this page
        </summary>
        <div className="px-4 pb-4 pt-1 text-gray-700">
          <ol className="list-decimal pl-5 space-y-1.5">
            <li>
              Paste MetService warning/watch text into the box on the left, or
              click <span className="font-medium">Use latest scraped alerts</span>{' '}
              to pull today's data automatically.
            </li>
            <li>
              Click <span className="font-medium">Generate from pasted text</span>{' '}
              — Claude extracts structured bars (region, hazard type,
              severity, timing) from the text.
            </li>
            <li>
              Check the chart on the right. If a bar's order, hazard type, or
              severity looks wrong, use the{' '}
              <span className="font-medium">Bars — order, type &amp; severity</span>{' '}
              list below to drag rows into the right order or fix a dropdown —
              changes apply immediately to the chart and export.
            </li>
            <li>
              Click <span className="font-medium">Filters</span> next to the
              download buttons to show or hide specific hazard/severity
              combinations (e.g. only red warnings, or hide road-specific
              alerts like Milford Road — shown in purple, separate from
              regional snow shown in blue).
            </li>
            <li>
              Download the chart as a PNG at{' '}
              <span className="font-medium">150 DPI</span> (screen/quick share)
              or <span className="font-medium">300 DPI</span> (print quality).
            </li>
          </ol>
          <p className="mt-2 text-xs text-gray-500">
            Advanced: expand{' '}
            <span className="font-medium">Edit parsed JSON</span> in the left
            panel to edit the raw data directly (e.g. region names, exact
            times), then click{' '}
            <span className="font-medium">Re-render from edit</span>.
          </p>
        </div>
      </details>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle>MetService warning data</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={`Paste MetService warning / watch text here...

Example:
Heavy Rain Warning (Orange) for Northland from 3pm Thursday to 6am Friday.
Expect 80-120mm. Peak intensity overnight Thursday.

Strong Wind Watch for Waikato from 6pm Thursday to 3am Friday.
Northwest winds may approach warning criteria.`}
              className="min-h-[360px] w-full border rounded p-3 text-sm font-mono leading-relaxed focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
            <div className="flex flex-wrap gap-2">
              <Button
                onClick={onGenerateFromInput}
                disabled={status === 'loading'}
              >
                Generate from pasted text
              </Button>
              <Button
                variant="secondary"
                onClick={onGenerateFromLatest}
                disabled={status === 'loading'}
              >
                Use latest scraped alerts
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  setInput('');
                  setStatus('idle');
                  setStatusMsg('');
                }}
              >
                Clear
              </Button>
            </div>
            <div
              className={`text-xs min-h-[18px] ${
                status === 'error'
                  ? 'text-red-600'
                  : status === 'success'
                  ? 'text-green-700'
                  : 'text-gray-500'
              }`}
            >
              {statusMsg}
            </div>

            {chart && (
              <details className="mt-2 text-xs">
                <summary className="cursor-pointer text-gray-500 select-none">
                  Edit parsed JSON
                </summary>
                <textarea
                  value={jsonText}
                  onChange={(e) => setJsonText(e.target.value)}
                  className="mt-2 w-full min-h-[200px] border rounded p-2 font-mono text-xs"
                />
                <div className="mt-2">
                  <Button variant="secondary" onClick={onRerenderFromEdit}>
                    Re-render from edit
                  </Button>
                </div>
              </details>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>
              {chart?.chart_title || 'Gantt output'}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {status === 'loading' ? (
              <Skeleton className="h-[360px] w-full" />
            ) : chart ? (
              <>
                <div className="overflow-x-auto">
                  <GanttCanvas data={displayChart ?? chart} />
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button onClick={() => onDownload(300)}>
                    Download 300 DPI
                  </Button>
                  <Button variant="secondary" onClick={() => onDownload(150)}>
                    Download 150 DPI
                  </Button>

                  <div className="relative" ref={filterRef}>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setFilterOpen((v) => !v)}
                      className="flex items-center gap-1.5"
                    >
                      <Filter size={14} />
                      Filters
                      {hiddenFilterCount > 0 && (
                        <span className="bg-blue-100 text-blue-700 text-xs font-medium px-1.5 py-0.5 rounded-full">
                          {hiddenFilterCount}
                        </span>
                      )}
                    </Button>

                    {filterOpen && (
                      <div className="absolute bottom-full left-0 z-20 mb-1 w-[22rem] max-w-[90vw] border rounded-lg bg-white shadow-lg p-3 text-xs">
                        <p className="font-medium mb-2">
                          Filter by hazard and severity
                        </p>
                        <div className="grid grid-cols-[auto_1fr_1fr_1fr] gap-x-2.5 gap-y-1.5 items-center">
                          <span />
                          {SEVERITY_FILTER_KEYS.map((key) => (
                            <span key={key} className="text-gray-400">
                              {SEVERITY_FILTER_LABEL[key]}
                            </span>
                          ))}

                          {REGIONAL_HAZARDS.map((hazard) => (
                            <Fragment key={hazard}>
                              <span>{HAZARD_FILTER_LABEL[hazard]}</span>
                              {SEVERITY_FILTER_KEYS.map((key) => (
                                <input
                                  key={`${hazard}-${key}`}
                                  type="checkbox"
                                  checked={visibleSeverities[hazard].has(key)}
                                  onChange={() => toggleSeverity(hazard, key)}
                                  className="h-3.5 w-3.5"
                                />
                              ))}
                            </Fragment>
                          ))}

                          <span>Road snowfall</span>
                          <input
                            type="checkbox"
                            checked={showRoadSnowfall}
                            onChange={() => setShowRoadSnowfall((v) => !v)}
                            className="h-3.5 w-3.5"
                          />
                          <span />
                          <span />
                        </div>
                      </div>
                    )}
                  </div>
                </div>
                {chart.notes?.length > 0 && (
                  <div className="text-xs text-gray-500">
                    <div className="font-semibold mb-1">Notes from extractor:</div>
                    <ul className="list-disc pl-5 space-y-0.5">
                      {chart.notes.map((n, i) => (
                        <li key={i}>{n}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </>
            ) : noActiveAlerts ? (
              <div className="flex flex-col items-center justify-center gap-1 min-h-[360px] border border-dashed rounded text-center px-4">
                <span className="text-lg font-medium text-gray-600">
                  No watches or warnings in force
                </span>
                {snapshots && snapshots.length > 0 && (
                  <span className="text-xs text-gray-400">
                    Earlier charts are available under Auto-captured snapshots
                    below.
                  </span>
                )}
              </div>
            ) : (
              <div className="flex items-center justify-center min-h-[360px] text-gray-400 text-sm border border-dashed rounded">
                Awaiting data
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {snapshots && snapshots.length > 0 && (
        <details className="border rounded-lg bg-white text-sm">
          <summary className="cursor-pointer select-none px-4 py-2.5 font-medium">
            Auto-captured snapshots{' '}
            <span className="text-xs font-normal text-gray-500">
              ({snapshots.length} saved — automatically captured whenever
              issued alerts change)
            </span>
          </summary>
          <div className="px-4 pb-4 pt-1 border-t flex flex-col gap-2">
            <p className="text-xs text-gray-500 py-2">
              {noActiveAlerts
                ? "Nothing is in force right now, so no chart is shown by default — pick a snapshot to see how things looked earlier (edits in the bars editor below are temporary and won't be saved back to the snapshot)."
                : "The latest is shown by default — pick an older one to view it (and try edits in the bars editor below, though those edits are temporary and won't be saved back to the snapshot)."}
            </p>
            <div className="flex flex-wrap gap-2">
              {snapshots.map((snap, i) => (
                <Button
                  key={snap.id}
                  size="sm"
                  variant={
                    selectedSnapshotId === snap.id ? 'default' : 'secondary'
                  }
                  onClick={() => selectSnapshot(snap)}
                >
                  {i === 0 && !noActiveAlerts
                    ? 'Latest'
                    : formatSnapshotTime(snap.insertedAt)}
                </Button>
              ))}
            </div>
          </div>
        </details>
      )}

      {chart && (
        <GanttBarEditor bars={chart.bars} onChange={onBarsChange} />
      )}

      <p className="text-xs text-gray-500">
        AI-generated content. Always verify times, regions, and severity levels
        against the original MetService source before operational use.
      </p>
    </div>
  );
}