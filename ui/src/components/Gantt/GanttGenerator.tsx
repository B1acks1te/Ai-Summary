import { useState } from 'react';
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

type Status = 'idle' | 'loading' | 'success' | 'error';

export function GanttGenerator() {
  const [input, setInput] = useState('');
  const [chart, setChart] = useState<GanttChart | null>(null);
  const [jsonText, setJsonText] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [statusMsg, setStatusMsg] = useState('');

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

  const onDownload = (dpi: number) => {
    if (!chart) return;
    downloadGanttPng(chart, dpi);
  };

  return (
    <div className="flex flex-col gap-4 p-6">
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
                  <GanttCanvas data={chart} />
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button onClick={() => onDownload(300)}>
                    Download 300 DPI
                  </Button>
                  <Button variant="secondary" onClick={() => onDownload(150)}>
                    Download 150 DPI
                  </Button>
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

      <p className="text-xs text-gray-500">
        AI-generated content. Always verify times, regions, and severity levels
        against the original MetService source before operational use.
      </p>
    </div>
  );
}
