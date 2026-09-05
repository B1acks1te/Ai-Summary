import { useEffect, useRef } from 'react';
import type { GanttChart, GanttBar } from '@/types/gantt';

// ─────────────────────────────────────────────────────────────
// COLOUR DEFINITIONS — verbatim from the uploaded reference
// ─────────────────────────────────────────────────────────────
// Colour follows MetService's own convention: yellow = watch, orange =
// warning, red = red warning — applied consistently by SEVERITY, not
// invented per hazard type. "warning" (no colour stated in source, e.g. a
// Road Snowfall Warning) renders identically to "orange_warning" — see the
// severity normalisation in drawGantt below. Hazard type is instead signalled
// by border style: rain/wind keep a solid border; snow and road_snow use a
// dashed border. road_snow's dash is always blue regardless of severity, so
// it carries a fixed "this is route-specific" signature independent of colour.
const STYLES = {
  rain: {
    red_warning: { fill: '#b91c1c', border: '#7f1d1d', textColor: '#ffffff' },
    orange_warning: {
      fill: '#d97706',
      border: '#92400e',
      textColor: '#ffffff',
    },
    watch: { fill: '#facc15', border: '#ca8a04', textColor: '#000000' },
  },
  wind: {
    red_warning: { fill: '#808080', border: '#FF0000', textColor: '#ffffff' },
    orange_warning: {
      fill: '#9ca3af',
      border: '#FF6600',
      textColor: '#000000',
    },
    watch: { fill: '#d1d5db', border: '#d1d5db', textColor: '#000000' },
  },
  snow: {
    // Mimics rain's colours exactly; dashed border is the only differentiator
    // from a rain bar of the same severity.
    red_warning: {
      fill: '#b91c1c',
      border: '#7f1d1d',
      textColor: '#ffffff',
      dashed: true,
    },
    orange_warning: {
      fill: '#d97706',
      border: '#92400e',
      textColor: '#ffffff',
      dashed: true,
    },
    watch: {
      fill: '#facc15',
      border: '#ca8a04',
      textColor: '#000000',
      dashed: true,
    },
  },
  road_snow: {
    // Same fill colours as rain (severity-accurate), but the border is
    // ALWAYS blue and dashed regardless of severity.
    red_warning: {
      fill: '#b91c1c',
      border: '#2563eb',
      textColor: '#ffffff',
      dashed: true,
    },
    orange_warning: {
      fill: '#d97706',
      border: '#2563eb',
      textColor: '#ffffff',
      dashed: true,
    },
    watch: {
      fill: '#facc15',
      border: '#2563eb',
      textColor: '#000000',
      dashed: true,
    },
  },
  peak: { fill: '#3b82f6' },
} as const;

// ─────────────────────────────────────────────────────────────
// GEOGRAPHIC SORT (north → south) — verbatim from reference
// ─────────────────────────────────────────────────────────────
const REGION_ORDER = [
  'northland',
  'great barrier island',
  'auckland',
  'coromandel peninsula',
  'waikato',
  'bay of plenty',
  'taupo',
  'taumarunui',
  'gisborne',
  "hawke's bay",
  'hawkes bay',
  'taranaki',
  'taranaki maunga',
  'taihape',
  'whanganui',
  'manawatu',
  'horowhenua',
  'kapiti coast',
  'kapiti',
  'porirua',
  'wellington',
  'hutt valley',
  'wairarapa',
  'kaweka ranges',
  'ruahine ranges',
  'tararua range',
  'tararua district',
  'buller',
  'grey',
  'nelson',
  'tasman',
  'motueka',
  'richmond ranges',
  'marlborough',
  'marlborough sounds',
  'kaikoura',
  'westland',
  'canterbury',
  'timaru',
  'otago',
  'southland',
  'fiordland',
  'stewart island',
];

function getRegionIndex(regionName: string) {
  const lower = regionName.toLowerCase();
  for (let i = 0; i < REGION_ORDER.length; i++) {
    if (lower === REGION_ORDER[i]) return i;
  }
  for (let i = 0; i < REGION_ORDER.length; i++) {
    if (lower.includes(REGION_ORDER[i]) || REGION_ORDER[i].includes(lower))
      return i;
  }
  return REGION_ORDER.length;
}

// Severity/hazard tie-break within the same region — guarantees warnings
// always sort before watches, regardless of what order the model returned
// them in. Lower number = higher priority = appears first.
const SEVERITY_ORDER: Record<string, number> = {
  red_warning: 0,
  orange_warning: 1,
  warning: 1, // visually identical to orange_warning — same sort tier
  watch: 3,
};

const HAZARD_ORDER: Record<string, number> = {
  rain: 0,
  wind: 1,
  snow: 2,
  road_snow: 3,
};

export function sortBarsGeographically(bars: GanttBar[]): GanttBar[] {
  const tagged = bars.map((b, i) => ({
    bar: b,
    geoIndex: getRegionIndex(b.region),
    severityIndex: SEVERITY_ORDER[b.severity] ?? 99,
    hazardIndex: HAZARD_ORDER[b.hazard_type] ?? 99,
    originalIndex: i,
  }));
  tagged.sort((a, b) => {
    if (a.geoIndex !== b.geoIndex) return a.geoIndex - b.geoIndex;
    if (a.severityIndex !== b.severityIndex)
      return a.severityIndex - b.severityIndex;
    if (a.hazardIndex !== b.hazardIndex) return a.hazardIndex - b.hazardIndex;
    return a.originalIndex - b.originalIndex;
  });
  return tagged.map((t) => t.bar);
}

// ─────────────────────────────────────────────────────────────
// LAYOUT + DRAWING — ported verbatim from index.html
// ─────────────────────────────────────────────────────────────
function snapToLocal3H(ts: number, direction: 'floor' | 'ceil'): number {
  const d = new Date(ts);
  const h = d.getHours();
  const m = d.getMinutes();
  const s = d.getSeconds();
  if (direction === 'floor') {
    const snappedH = Math.floor(h / 3) * 3;
    return new Date(
      d.getFullYear(),
      d.getMonth(),
      d.getDate(),
      snappedH,
      0,
      0,
      0,
    ).getTime();
  } else {
    if (h % 3 === 0 && m === 0 && s === 0) {
      return new Date(
        d.getFullYear(),
        d.getMonth(),
        d.getDate(),
        h,
        0,
        0,
        0,
      ).getTime();
    }
    const snappedH = (Math.floor(h / 3) + 1) * 3;
    return new Date(
      d.getFullYear(),
      d.getMonth(),
      d.getDate(),
      snappedH,
      0,
      0,
      0,
    ).getTime();
  }
}

function generate3HTicks(minTime: number, maxTime: number): number[] {
  const ticks: number[] = [];
  const start = new Date(minTime);
  let y = start.getFullYear();
  let mo = start.getMonth();
  let day = start.getDate();
  let h = start.getHours();
  for (let i = 0; i < 200; i++) {
    const t = new Date(y, mo, day, h, 0, 0, 0);
    const ts = t.getTime();
    if (ts > maxTime) break;
    ticks.push(ts);
    h += 3;
    if (h >= 24) {
      h -= 24;
      const nextDay = new Date(y, mo, day + 1);
      y = nextDay.getFullYear();
      mo = nextDay.getMonth();
      day = nextDay.getDate();
    }
  }
  return ticks;
}

function findMidnights(minTime: number, maxTime: number): number[] {
  const midnights: number[] = [];
  const start = new Date(minTime);
  let d = new Date(
    start.getFullYear(),
    start.getMonth(),
    start.getDate() + 1,
    0,
    0,
    0,
    0,
  );
  for (let i = 0; i < 30; i++) {
    if (d.getTime() > maxTime) break;
    if (d.getTime() > minTime) midnights.push(d.getTime());
    d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, 0, 0, 0, 0);
  }
  return midnights;
}

type Layout = ReturnType<typeof computeLayout>;

function computeLayout(data: GanttChart, chartWidth: number) {
  const barsParsed = data.bars.map((b) => ({
    ...b,
    startDate: new Date(b.start),
    endDate: new Date(b.end),
    peakStartDate: b.peak_start ? new Date(b.peak_start) : null,
    peakEndDate: b.peak_end ? new Date(b.peak_end) : null,
  }));

  let minTime = Math.min(...barsParsed.map((b) => b.startDate.getTime()));
  let maxTime = Math.max(...barsParsed.map((b) => b.endDate.getTime()));
  minTime = snapToLocal3H(minTime, 'floor');
  maxTime = snapToLocal3H(maxTime, 'ceil');
  const timeSpan = maxTime - minTime;

  const tickTimes = generate3HTicks(minTime, maxTime);
  const midnights = findMidnights(minTime, maxTime);

  const marginLeft = 28;
  const marginRight = 28;
  const marginTop = 8;
  const marginBottom = 32;
  const barHeight = 22;
  const barGap = 3;
  const peakBarHeight = 10;

  const plotLeft = marginLeft;
  const plotRight = chartWidth - marginRight;
  const plotWidth = plotRight - plotLeft;
  const plotTop = marginTop;
  const chartAreaHeight = barsParsed.length * (barHeight + barGap);
  const axisY = plotTop + chartAreaHeight + 6;
  const totalHeight = axisY + marginBottom;

  return {
    plotLeft,
    plotRight,
    plotTop,
    plotWidth,
    barHeight,
    barGap,
    peakBarHeight,
    axisY,
    minTime,
    maxTime,
    timeSpan,
    tickTimes,
    midnights,
    barsParsed,
    totalHeight,
    chartAreaHeight,
  };
}

function drawGantt(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  layout: Layout,
) {
  const {
    plotLeft,
    plotRight,
    plotTop,
    plotWidth,
    barHeight,
    barGap,
    peakBarHeight,
    axisY,
    minTime,
    timeSpan,
    tickTimes,
    barsParsed,
  } = layout;

  const FONT =
    '-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif';

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);

  const timeToX = (t: number | Date) => {
    const ts = typeof t === 'number' ? t : t.getTime();
    return plotLeft + ((ts - minTime) / timeSpan) * plotWidth;
  };

  // 3-hour gridlines
  tickTimes.forEach((t) => {
    const x = timeToX(t);
    ctx.strokeStyle = '#e0e0e0';
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(x, plotTop);
    ctx.lineTo(x, plotTop + layout.chartAreaHeight);
    ctx.stroke();
  });

  // axis
  ctx.strokeStyle = '#000000';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(plotLeft, axisY);
  ctx.lineTo(plotRight, axisY);
  ctx.stroke();

  ctx.font = `11px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  tickTimes.forEach((t) => {
    const x = timeToX(t);
    const d = new Date(t);
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, axisY);
    ctx.lineTo(x, axisY + 5);
    ctx.stroke();
    ctx.fillStyle = '#000000';
    ctx.fillText(hh + ':' + mm, x, axisY + 8);
  });

  // bars
  barsParsed.forEach((bar, i) => {
    const y = plotTop + i * (barHeight + barGap);
    const x1 = timeToX(bar.startDate);
    const x2 = timeToX(bar.endDate);
    const w = Math.max(x2 - x1, 2);

    // "warning" (no colour stated in source) renders the same as
    // "orange_warning" — see note above STYLES.
    const styleSeverity =
      bar.severity === 'warning' ? 'orange_warning' : bar.severity;
    const style =
      STYLES[bar.hazard_type]?.[styleSeverity as keyof (typeof STYLES)['rain']] ||
      STYLES.rain.watch;

    ctx.fillStyle = style.fill;
    ctx.fillRect(x1, y, w, barHeight);

    const bw = 2.5;
    ctx.strokeStyle = style.border;
    ctx.lineWidth = bw;
    ctx.setLineDash('dashed' in style && style.dashed ? [6, 4] : []);
    ctx.strokeRect(x1 + bw / 2, y + bw / 2, w - bw, barHeight - bw);
    ctx.setLineDash([]);

    if (bar.hazard_type === 'rain' && bar.peakStartDate && bar.peakEndDate) {
      const px1 = Math.max(timeToX(bar.peakStartDate), x1);
      const px2 = Math.min(timeToX(bar.peakEndDate), x1 + w);
      const pw = Math.max(px2 - px1, 2);
      const peakY = y + (barHeight - peakBarHeight) / 2;
      ctx.fillStyle = STYLES.peak.fill;
      ctx.fillRect(px1, peakY, pw, peakBarHeight);
    }

    ctx.fillStyle = style.textColor;
    ctx.font = `12px ${FONT}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';

    const pad = 7;
    const maxLabelW = w - pad * 2;
    let label = bar.label;
    if (maxLabelW > 25) {
      if (ctx.measureText(label).width > maxLabelW) {
        while (
          ctx.measureText(label + '…').width > maxLabelW &&
          label.length > 3
        ) {
          label = label.slice(0, -1);
        }
        label += '…';
      }
      ctx.fillText(label, x1 + pad, y + barHeight / 2);
    }
  });
}

// ─────────────────────────────────────────────────────────────
// EXPORT — render at arbitrary DPI
// ─────────────────────────────────────────────────────────────
export function downloadGanttPng(data: GanttChart, targetDPI: number) {
  const scale = targetDPI / 96;
  const chartWidth = 1400;
  const layout = computeLayout(data, chartWidth);
  const chartHeight = layout.totalHeight;

  const offscreen = document.createElement('canvas');
  offscreen.width = Math.round(chartWidth * scale);
  offscreen.height = Math.round(chartHeight * scale);
  const ctx = offscreen.getContext('2d');
  if (!ctx) return;
  ctx.scale(scale, scale);
  drawGantt(ctx, chartWidth, chartHeight, layout);

  const link = document.createElement('a');
  const title = data.chart_title || 'Hazard_Gantt';
  const safeName = title.replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 60);
  link.download = `${safeName}_${targetDPI}dpi.png`;
  link.href = offscreen.toDataURL('image/png');
  link.click();
}

// ─────────────────────────────────────────────────────────────
// REACT COMPONENT
// ─────────────────────────────────────────────────────────────
type Props = {
  data: GanttChart;
  width?: number;
};

export function GanttCanvas({ data, width = 1400 }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !data || data.bars.length === 0) return;

    const DPR = 2;
    const layout = computeLayout(data, width);
    const chartHeight = layout.totalHeight;

    canvas.width = width * DPR;
    canvas.height = chartHeight * DPR;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${chartHeight}px`;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(DPR, DPR);
    drawGantt(ctx, width, chartHeight, layout);
  }, [data, width]);

  if (!data || data.bars.length === 0) {
    return (
      <div className="flex items-center justify-center min-h-[200px] text-gray-400 text-sm border border-dashed border-gray-300 rounded">
        No bars to render
      </div>
    );
  }

  return <canvas ref={canvasRef} className="rounded border border-gray-200" />;
}
