import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  generateGanttFromInput,
  generateGanttFromLatest,
} from '@/serverFuncs/Gantt';
import type { GanttChart } from '@/types/gantt';
import {
  GanttCanvas,
  downloadGanttPng,
  sortBarsGeographically,
} from './GanttCanvas';
import { GanttBarEditor } from './GanttBarEditor';

type Status = 'idle' | 'loading' | 'success' | 'error';

export function GanttGenerator() {
  const [input, setInput] = useState('');
  const [chart, setChart] = useState<GanttChart | null>(null);
  const [jsonText, setJsonText] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [statusMsg, setStatusMsg] = useState('');
  const [excludeRoadSnow, setExcludeRoadSnow] = useState(false);

  // Road-specific snow alerts (road_snow) are included by default. Filtering
  // is applied here — to both the on-screen chart and any PNG export — rather
  // than at generation time, so toggling it doesn't require a re-generation.
  const displayChart = useMemo(() => {
    if (!chart) return chart;
    if (!excludeRoadSnow) return chart;
    return {
      ...chart,
      bars: chart.bars.filter((b) => b.hazard_type !== 'road_snow'),
    };
  }, [chart, excludeRoadSnow]);

  const handleResult = (data: GanttChart, sourceText?: string) => {
    const sorted: GanttChart = {
      ...data,
      bars: sortBarsGeographically(data.bars),
    };
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
    if (resp.ok && resp.chart) {
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

  return (
    <div className="flex flex-col gap-4 p-6">
      <details
        open
        className="border rounded-lg bg-blue-50/50 border-blue-100 text-sm"
      >
        <summary className="cursor-pointer select-none font-medium px-4 py-2.5 text-blue-900">
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
              Tick <span className="font-medium">Exclude road snowfall</span>{' '}
              if you only want regional watches/warnings on the chart (route-specific
              alerts like Milford Road are shown in purple; regional snow alerts
              are shown in blue).
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
                  <label className="flex items-center gap-1.5 text-sm text-gray-600 ml-1 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={excludeRoadSnow}
                      onChange={(e) => setExcludeRoadSnow(e.target.checked)}
                      className="h-4 w-4 rounded border-gray-300"
                    />
                    Exclude road snowfall
                  </label>
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
            ) : (
              <div className="flex items-center justify-center min-h-[360px] text-gray-400 text-sm border border-dashed rounded">
                Awaiting data
              </div>
            )}
          </CardContent>
        </Card>
      </div>

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
