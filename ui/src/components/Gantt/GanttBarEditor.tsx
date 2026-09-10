import { Button } from '@/components/ui/button';
import type { GanttBar, GanttHazardType, GanttSeverity } from '@/types/gantt';
import { sortBarsGeographically } from './GanttCanvas';

const HAZARD_OPTIONS: { value: GanttHazardType; label: string }[] = [
  { value: 'rain', label: 'Rain' },
  { value: 'wind', label: 'Wind' },
  { value: 'snow', label: 'Snow (regional)' },
  { value: 'road_snow', label: 'Road snowfall' },
];

const SEVERITY_OPTIONS: { value: GanttSeverity; label: string }[] = [
  { value: 'red_warning', label: 'Red warning' },
  { value: 'orange_warning', label: 'Orange warning' },
  { value: 'warning', label: 'Warning' },
  { value: 'watch', label: 'Watch' },
];

// Column widths shared between the header row and every data row, so
// everything lines up. Grid, not flex-wrap — flex-wrap has no concept of
// "column" and rows drift out of alignment with each other. This layout is
// only used at sm+ — below that, BarCard renders instead (see below).
const ROW_GRID =
  'grid grid-cols-[2.25rem_10rem_13rem_8.5rem_9rem_1fr_5.5rem] gap-3 items-center';

// Mirrors the LABEL FORMAT rule in ganttPrompt.ts, so a manual hazard/severity
// edit keeps the label text consistent without needing another AI call.
function computeLabel(
  region: string,
  hazard_type: GanttHazardType,
  severity: GanttSeverity,
): string {
  const hazardNoun: Record<GanttHazardType, string> = {
    rain: 'rain',
    wind: 'wind',
    snow: 'snow',
    road_snow: 'road snowfall',
  };
  const colourWord =
    severity === 'red_warning'
      ? 'red '
      : severity === 'orange_warning'
        ? 'orange '
        : '';
  const suffix = severity === 'watch' ? 'watch' : 'warning';
  return `${region} (${colourWord}${hazardNoun[hazard_type]} ${suffix})`;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const day = d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' });
  return `${day} ${hh}:${mm}`;
}

function rowStatus(bar: GanttBar): { label: string; className: string } {
  const startMs = new Date(bar.start).getTime();
  const endMs = new Date(bar.end).getTime();
  const hrs = (endMs - startMs) / 3600000;
  if (hrs <= 0) {
    return { label: 'Invalid', className: 'bg-red-100 text-red-700' };
  }
  if (hrs > 72) {
    return { label: 'Long span', className: 'bg-amber-100 text-amber-700' };
  }
  return { label: 'OK', className: 'bg-green-100 text-green-700' };
}

type Props = {
  bars: GanttBar[];
  onChange: (bars: GanttBar[]) => void;
};

// Move-up/move-down buttons, used for reordering everywhere (desktop and
// mobile alike). Native HTML5 drag-and-drop (the previous approach) doesn't
// work reliably on touch devices at all — buttons are a single mechanism
// that's predictable and accessible on every input type, rather than
// maintaining a separate touch-specific fallback alongside drag.
function MoveButtons({
  index,
  total,
  onMove,
  size = 'text-xs',
}: {
  index: number;
  total: number;
  onMove: (index: number, direction: -1 | 1) => void;
  size?: string;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <button
        type="button"
        aria-label="Move up"
        disabled={index === 0}
        onClick={() => onMove(index, -1)}
        className={`${size} leading-none text-gray-400 hover:text-gray-700 disabled:opacity-30 disabled:hover:text-gray-400`}
      >
        ▲
      </button>
      <button
        type="button"
        aria-label="Move down"
        disabled={index === total - 1}
        onClick={() => onMove(index, 1)}
        className={`${size} leading-none text-gray-400 hover:text-gray-700 disabled:opacity-30 disabled:hover:text-gray-400`}
      >
        ▼
      </button>
    </div>
  );
}

export function GanttBarEditor({ bars, onChange }: Props) {
  if (bars.length === 0) return null;

  const moveBar = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= bars.length) return;
    const next = [...bars];
    const [moved] = next.splice(index, 1);
    next.splice(target, 0, moved);
    onChange(next);
  };

  const updateBar = (index: number, patch: Partial<GanttBar>) => {
    const next = [...bars];
    const updated = { ...next[index], ...patch };
    // Keep the label consistent whenever hazard_type or severity changes.
    if (patch.hazard_type || patch.severity) {
      updated.label = computeLabel(
        updated.region,
        updated.hazard_type,
        updated.severity,
      );
    }
    next[index] = updated;
    onChange(next);
  };

  return (
    <details className="border rounded-lg bg-white text-sm">
      <summary className="cursor-pointer select-none px-4 py-2.5 font-medium">
        Bars — order, type &amp; severity{' '}
        <span className="text-xs font-normal text-gray-500">
          ({bars.length} bar{bars.length === 1 ? '' : 's'} — use ▲▼ to
          reorder, adjust hazard or severity)
        </span>
      </summary>
      <div className="px-4 pb-4 pt-1 border-t">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 py-2">
          <p className="text-xs text-gray-500">
            Region, start, and end are not editable here — use &quot;Edit
            parsed JSON&quot; above for those.
          </p>
          <Button
            variant="ghost"
            size="sm"
            className="self-start sm:self-auto"
            onClick={() => onChange(sortBarsGeographically(bars))}
          >
            Reset to automatic order
          </Button>
        </div>

        {/* Mobile (below sm): stacked cards, one per bar. No horizontal
            scrolling or fixed-width columns — each field gets its own line
            so it's readable and tappable on a phone screen. */}
        <ul className="flex flex-col gap-2 sm:hidden">
          {bars.map((bar, i) => {
            const status = rowStatus(bar);
            return (
              <li
                key={`${bar.region}-${i}`}
                className="rounded border border-gray-200 p-3 flex flex-col gap-2"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-start gap-2 min-w-0">
                    <MoveButtons index={i} total={bars.length} onMove={moveBar} />
                    <div className="min-w-0">
                      <div className="font-medium truncate">{bar.region}</div>
                      <div className="text-xs text-gray-500 whitespace-nowrap">
                        {formatTime(bar.start)} → {formatTime(bar.end)}
                      </div>
                    </div>
                  </div>
                  <span
                    className={`text-xs px-2 py-0.5 rounded-full text-center whitespace-nowrap shrink-0 ${status.className}`}
                  >
                    {status.label}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <select
                    value={bar.hazard_type}
                    onChange={(e) =>
                      updateBar(i, {
                        hazard_type: e.target.value as GanttHazardType,
                      })
                    }
                    className="border rounded px-2 py-1.5 text-sm bg-white w-full"
                  >
                    {HAZARD_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>

                  <select
                    value={bar.severity}
                    onChange={(e) =>
                      updateBar(i, {
                        severity: e.target.value as GanttSeverity,
                      })
                    }
                    className="border rounded px-2 py-1.5 text-sm bg-white w-full"
                  >
                    {SEVERITY_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="text-xs text-gray-500 break-words">
                  {bar.label}
                </div>
              </li>
            );
          })}
        </ul>

        {/* sm and up: the original column-aligned grid layout, unchanged
            other than the move-buttons replacing drag. Still horizontally
            scrollable as a fallback on narrower tablet widths. */}
        <div className="hidden sm:block overflow-x-auto">
          <div className="min-w-[960px]">
            <div
              className={`${ROW_GRID} px-2 pb-2 text-xs font-medium text-gray-400 uppercase tracking-wide`}
            >
              <span />
              <span>Region</span>
              <span>Time</span>
              <span>Hazard</span>
              <span>Severity</span>
              <span>Label</span>
              <span>Status</span>
            </div>

            <ul className="flex flex-col gap-1.5">
              {bars.map((bar, i) => {
                const status = rowStatus(bar);
                return (
                  <li
                    key={`${bar.region}-${i}`}
                    className={`${ROW_GRID} rounded border border-gray-200 p-2 text-sm bg-white`}
                  >
                    <MoveButtons index={i} total={bars.length} onMove={moveBar} />

                    <span className="font-medium truncate" title={bar.region}>
                      {bar.region}
                    </span>

                    <span className="text-xs text-gray-500 whitespace-nowrap">
                      {formatTime(bar.start)} → {formatTime(bar.end)}
                    </span>

                    <select
                      value={bar.hazard_type}
                      onChange={(e) =>
                        updateBar(i, {
                          hazard_type: e.target.value as GanttHazardType,
                        })
                      }
                      className="border rounded px-1.5 py-1 text-xs bg-white w-full"
                    >
                      {HAZARD_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>

                    <select
                      value={bar.severity}
                      onChange={(e) =>
                        updateBar(i, {
                          severity: e.target.value as GanttSeverity,
                        })
                      }
                      className="border rounded px-1.5 py-1 text-xs bg-white w-full"
                    >
                      {SEVERITY_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>

                    <span
                      className="text-xs text-gray-500 truncate"
                      title={bar.label}
                    >
                      {bar.label}
                    </span>

                    <span
                      className={`text-xs px-2 py-0.5 rounded-full text-center whitespace-nowrap ${status.className}`}
                    >
                      {status.label}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      </div>
    </details>
  );
}