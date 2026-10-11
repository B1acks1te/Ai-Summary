import { useEffect, useRef } from 'react';
import type { GanttChart, GanttBar, GanttRenderOptions } from '@/types/gantt';
import { DEFAULT_GANTT_RENDER_OPTIONS } from '@/types/gantt';

// ─────────────────────────────────────────────────────────────
// COLOUR DEFINITIONS — verbatim from the uploaded reference
// ─────────────────────────────────────────────────────────────
// Colour follows MetService's own convention: yellow = watch, orange =
// warning, red = red warning — applied consistently by SEVERITY, not
// invented per hazard type. "warning" (no colour stated in source, e.g. a
// Road Snowfall Warning) renders identically to "orange_warning" — see the
// severity normalisation in drawGantt below. Hazard type is instead signalled
// by border style: rain/wind/thunderstorm keep a solid border; snow and
// road_snow use a dashed border. road_snow's dash is always blue regardless
// of severity, so
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
  // Severe thunderstorm alerts are a standard regional alert, styled
  // identically to rain (same fill/border by severity) with a solid border —
  // it is not route-specific (road_snow) or a snow type, so it gets no
  // dashed-border treatment. "Be red like the red rain warnings" just means
  // it uses rain's exact colour-by-severity convention.
  thunderstorm: {
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
// How a bar is placed, in order:
//   1. Its region name matches an entry in the known lists below → that
//      entry's position. Names are compared after normalising (see
//      normaliseName), so apostrophe style, hyphens, brackets, macrons and
//      spacing don't matter. Matching is exact first, then substring, so
//      "Crown Range Road (SH8)" matches 'crown range'.
//   2. Not in the lists, but the AI supplied a latitude for the bar → it is
//      slotted in north → south by latitude among the known places (see
//      positionFromLatitude).
//   3. Neither → bottom of the chart (then by severity, then source order).
//
// The lists are kept separate so they're easy to maintain, but they are merged
// into ONE north → south order below — the chart still interleaves roads with
// the regions they run through, exactly as if it were a single list.

// Regions and places, north → south.
const REGIONS_NORTH_TO_SOUTH = [
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
  'dunedin',
  'clutha',
  'southland',
  'fiordland',
  'stewart island',
];

// Roads / passes, north → south. `after` is the entry each one sits directly
// after in the merged order (a region above, or an earlier road in this list).
// To add a road: add a line here anchored to the right neighbour.
const ROADS_NORTH_TO_SOUTH: { name: string; after: string }[] = [
  { name: 'napier-taupo road', after: 'gisborne' },
  { name: 'desert road', after: 'napier-taupo road' },
  { name: 'rimutaka hill road', after: 'hutt valley' },
  { name: 'lewis pass', after: 'kaikoura' },
  { name: "arthur's pass", after: 'westland' },
  { name: 'porters pass', after: 'canterbury' },
  { name: 'haast pass', after: 'porters pass' },
  { name: 'lindis pass', after: 'timaru' },
  { name: 'crown range', after: 'lindis pass' },
  { name: 'milford road', after: 'otago' },
];

// Approximate latitude (degrees, negative = south) of each known entry above.
// Only used as reference points when slotting in a place that ISN'T in the
// lists (see positionFromLatitude), so rough is fine. An entry missing from
// here still sorts correctly, it just isn't used as a reference point.
const KNOWN_LATITUDES: Record<string, number> = {
  northland: -35.5,
  'great barrier island': -36.2,
  auckland: -36.85,
  'coromandel peninsula': -36.9,
  waikato: -37.8,
  'bay of plenty': -37.9,
  taupo: -38.7,
  taumarunui: -38.9,
  gisborne: -38.66,
  "hawke's bay": -39.6,
  taranaki: -39.3,
  'taranaki maunga': -39.3,
  taihape: -39.68,
  whanganui: -39.93,
  manawatu: -40.3,
  horowhenua: -40.6,
  'kapiti coast': -40.9,
  kapiti: -40.9,
  porirua: -41.14,
  wellington: -41.29,
  'hutt valley': -41.2,
  wairarapa: -41.0,
  'kaweka ranges': -39.3,
  'ruahine ranges': -39.9,
  'tararua range': -40.8,
  'tararua district': -40.4,
  buller: -41.75,
  grey: -42.45,
  nelson: -41.27,
  tasman: -41.3,
  motueka: -41.11,
  'richmond ranges': -41.6,
  marlborough: -41.5,
  'marlborough sounds': -41.2,
  kaikoura: -42.4,
  westland: -43.3,
  canterbury: -43.7,
  timaru: -44.4,
  otago: -45.3,
  dunedin: -45.87,
  clutha: -46.2,
  southland: -46.0,
  fiordland: -45.4,
  'stewart island': -47.0,
  // roads / passes
  'napier-taupo road': -39.1,
  'desert road': -39.2,
  'rimutaka hill road': -41.2,
  'lewis pass': -42.38,
  "arthur's pass": -42.94,
  'porters pass': -43.3,
  'haast pass': -44.1,
  'lindis pass': -44.6,
  'crown range': -44.9,
  'milford road': -45.0,
};

function mergeRegionAndRoadOrder(
  regions: string[],
  roads: { name: string; after: string }[],
): string[] {
  const merged = [...regions];
  for (const road of roads) {
    const at = merged.indexOf(road.after);
    // unknown anchor: put it at the end rather than crash
    merged.splice(at === -1 ? merged.length : at + 1, 0, road.name);
  }
  return merged;
}

const REGION_ORDER = mergeRegionAndRoadOrder(
  REGIONS_NORTH_TO_SOUTH,
  ROADS_NORTH_TO_SOUTH,
);

// Make names comparable regardless of how they were typed, so
// "Arthur's Pass", "Arthur’s Pass" (curly), "Arthur`s Pass", "ARTHURS PASS" and
// "Arthur's Pass (SH73)" all reduce to a matching form:
//   - accents / macrons removed (Taupō → taupo)
//   - every apostrophe style dropped entirely (hawke's = hawkes)
//   - hyphens, dashes, brackets, commas etc. become spaces, runs collapsed
// The apostrophe characters are written as \u escapes on purpose so this
// still works if the file's encoding ever gets mangled.
function normaliseName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[\u0027\u2018\u2019\u201B\u02BC\u0060\u00B4\u2032]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const NORMALISED_ORDER = REGION_ORDER.map(normaliseName);

// Reference points for latitude placement: known entries that have a latitude.
const LATITUDE_ANCHORS: { index: number; lat: number }[] = (() => {
  const latByName = new Map(
    Object.entries(KNOWN_LATITUDES).map(([name, lat]) => [
      normaliseName(name),
      lat,
    ]),
  );
  const anchors: { index: number; lat: number }[] = [];
  NORMALISED_ORDER.forEach((name, index) => {
    const lat = latByName.get(name);
    if (typeof lat === 'number') anchors.push({ index, lat });
  });
  return anchors;
})();

// Index of the matching known entry, or null if the name isn't in the lists.
// Exact match wins. Otherwise the MOST SPECIFIC (longest) entry contained in
// the name, so "Napier-Taupo Road (SH5)" matches 'napier-taupo road' rather
// than the shorter 'taupo'. Last resort: the name is a shortened form of an
// entry (e.g. 'kapiti' inside 'kapiti coast').
function getKnownRegionIndex(regionName: string): number | null {
  const name = normaliseName(regionName);
  if (!name) return null;

  const exact = NORMALISED_ORDER.indexOf(name);
  if (exact !== -1) return exact;

  let best: number | null = null;
  for (let i = 0; i < NORMALISED_ORDER.length; i++) {
    if (
      name.includes(NORMALISED_ORDER[i]) &&
      (best === null ||
        NORMALISED_ORDER[i].length > NORMALISED_ORDER[best].length)
    ) {
      best = i;
    }
  }
  if (best !== null) return best;

  for (let i = 0; i < NORMALISED_ORDER.length; i++) {
    if (NORMALISED_ORDER[i].includes(name)) return i;
  }
  return null;
}

// Slot an unlisted place in by latitude. Tries every gap in the known list and
// picks the one where the fewest known places would be out of north → south
// order relative to the new place (places before the gap should be further
// north, places after it further south). Counting "misfits" rather than just
// taking the nearest latitude keeps this right even where the list isn't
// strictly latitude-ordered. Ties go to the gap nearest in latitude. The tiny
// latitude term keeps several unlisted places in the same gap in proper
// north → south order; it is far too small to jump past a known entry.
function positionFromLatitude(lat: number | undefined): number {
  if (
    typeof lat !== 'number' ||
    !Number.isFinite(lat) ||
    LATITUDE_ANCHORS.length === 0
  ) {
    return REGION_ORDER.length; // no usable latitude → bottom, as before
  }

  let bestGap = 0;
  let bestCost = Infinity;
  let bestDistance = Infinity;
  for (let gap = 0; gap <= LATITUDE_ANCHORS.length; gap++) {
    let cost = 0;
    for (let i = 0; i < LATITUDE_ANCHORS.length; i++) {
      const anchorLat = LATITUDE_ANCHORS[i].lat;
      if (i < gap ? anchorLat < lat : anchorLat > lat) cost++;
    }
    // tie-break: prefer the gap whose entry directly above is closest in
    // latitude to the new place
    const distance =
      gap > 0 ? Math.abs(LATITUDE_ANCHORS[gap - 1].lat - lat) : Infinity;
    if (cost < bestCost || (cost === bestCost && distance < bestDistance)) {
      bestCost = cost;
      bestDistance = distance;
      bestGap = gap;
    }
  }

  // sit just after the known entry above the gap (or before everything)
  const above = bestGap > 0 ? LATITUDE_ANCHORS[bestGap - 1].index : -1;
  return above + 0.5 - lat * 0.0001;
}

function getBarPosition(bar: GanttBar): number {
  const known = getKnownRegionIndex(bar.region);
  if (known !== null) return known;
  return positionFromLatitude(bar.latitude);
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
  thunderstorm: 1,
  wind: 2,
  snow: 3,
  road_snow: 4,
};

// ─────────────────────────────────────────────────────────────
// LEGEND — built dynamically from whatever hazard/severity combinations
// are actually present on the chart (plus a "Peak Rain Intensity Period"
// row when any rain bar has a peak window and the option is on), so it
// never shows swatches for things that aren't on screen.
// ─────────────────────────────────────────────────────────────
type LegendEntry = {
  label: string;
  fill: string;
  border: string;
  dashed?: boolean;
};

const LEGEND_HAZARD_BASE: Record<string, string> = {
  rain: 'Heavy Rain',
  thunderstorm: 'Severe Thunderstorm',
  wind: 'Strong Wind',
  snow: 'Heavy Snow',
};

function normalizeSeverityKey(
  severity: GanttBar['severity'],
): 'red_warning' | 'orange_warning' | 'watch' {
  if (severity === 'red_warning') return 'red_warning';
  if (severity === 'watch') return 'watch';
  return 'orange_warning'; // 'warning' (uncoloured) renders/groups as orange
}

function legendLabelFor(
  hazard: string,
  severity: 'red_warning' | 'orange_warning' | 'watch',
): string {
  if (hazard === 'road_snow') return 'Road Snowfall Warning';
  const base = LEGEND_HAZARD_BASE[hazard] ?? hazard;
  if (severity === 'watch') return `${base} Watch`;
  if (severity === 'red_warning') return `${base} Warning - RED`;
  return `${base} Warning - ORANGE`;
}

function buildLegendEntries(
  bars: GanttBar[],
  hasPeakBand: boolean,
): LegendEntry[] {
  const entries: LegendEntry[] = [];
  const seen = new Set<string>();
  const hazardOrder = ['rain', 'thunderstorm', 'wind', 'snow', 'road_snow'];
  const severityOrder: Array<'red_warning' | 'orange_warning' | 'watch'> = [
    'red_warning',
    'orange_warning',
    'watch',
  ];

  hazardOrder.forEach((hazard) => {
    const barsOfHazard = bars.filter((b) => b.hazard_type === hazard);
    if (barsOfHazard.length === 0) return;

    if (hazard === 'road_snow') {
      // Fill colour follows severity (reuses rain's convention), border is
      // always fixed blue — one representative swatch is enough, so use
      // whichever severity is most severe among the road_snow bars present.
      const present = severityOrder.find((sev) =>
        barsOfHazard.some((b) => normalizeSeverityKey(b.severity) === sev),
      );
      const style =
        STYLES.road_snow[present ?? 'orange_warning'] ??
        STYLES.road_snow.orange_warning;
      entries.push({
        label: legendLabelFor('road_snow', present ?? 'orange_warning'),
        fill: style.fill,
        border: style.border,
        dashed: true,
      });
      return;
    }

    severityOrder.forEach((sev) => {
      const present = barsOfHazard.some(
        (b) => normalizeSeverityKey(b.severity) === sev,
      );
      if (!present) return;
      const key = `${hazard}-${sev}`;
      if (seen.has(key)) return;
      seen.add(key);
      const style =
        STYLES[hazard as Exclude<keyof typeof STYLES, 'peak'>]?.[sev];
      if (!style) return;
      entries.push({
        label: legendLabelFor(hazard, sev),
        fill: style.fill,
        border: style.border,
        dashed: 'dashed' in style ? style.dashed : false,
      });
    });
  });

  if (hasPeakBand) {
    entries.push({
      label: 'Peak Rain Intensity Period',
      fill: STYLES.peak.fill,
      border: STYLES.peak.fill,
    });
  }

  return entries;
}

function drawLegend(
  ctx: CanvasRenderingContext2D,
  plotRight: number,
  plotTop: number,
  entries: LegendEntry[],
) {
  if (entries.length === 0) return;
  const FONT =
    '-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif';
  const swatchSize = 14;
  const rowHeight = 20;
  const paddingX = 10;
  const paddingY = 8;

  ctx.font = `12px ${FONT}`;
  const maxTextWidth = Math.max(
    ...entries.map((e) => ctx.measureText(e.label).width),
  );
  const boxWidth = paddingX * 2 + swatchSize + 8 + maxTextWidth;
  const boxHeight = paddingY * 2 + entries.length * rowHeight;
  const boxX = plotRight - boxWidth - 4;
  const boxY = plotTop + 4;

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(boxX, boxY, boxWidth, boxHeight);
  ctx.strokeStyle = '#000000';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([]);
  ctx.strokeRect(boxX, boxY, boxWidth, boxHeight);

  entries.forEach((entry, i) => {
    const rowY = boxY + paddingY + i * rowHeight;
    const swatchX = boxX + paddingX;
    const swatchY = rowY + (rowHeight - swatchSize) / 2;

    ctx.fillStyle = entry.fill;
    ctx.fillRect(swatchX, swatchY, swatchSize, swatchSize);
    ctx.strokeStyle = entry.border;
    ctx.lineWidth = 1.5;
    ctx.setLineDash(entry.dashed ? [3, 2] : []);
    ctx.strokeRect(swatchX, swatchY, swatchSize, swatchSize);
    ctx.setLineDash([]);

    ctx.fillStyle = '#000000';
    ctx.font = `12px ${FONT}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(entry.label, swatchX + swatchSize + 8, rowY + rowHeight / 2);
  });
}

// ─────────────────────────────────────────────────────────────
// PEAK RAINFALL BAND — a full-height highlight spanning the earliest peak
// start to the latest peak end across all rain bars with a peak window,
// labelled across the top of the chart. Only drawn when applicable (i.e.
// at least one rain bar actually has a peak window).
// ─────────────────────────────────────────────────────────────
type PeakBand = { start: number; end: number; regions: string[] } | null;

function computePeakBand(
  barsParsed: {
    hazard_type: GanttBar['hazard_type'];
    region: string;
    peakStartDate: Date | null;
    peakEndDate: Date | null;
  }[],
): PeakBand {
  const withPeak = barsParsed.filter(
    (b) => b.hazard_type === 'rain' && b.peakStartDate && b.peakEndDate,
  );
  if (withPeak.length === 0) return null;
  const start = Math.min(...withPeak.map((b) => b.peakStartDate!.getTime()));
  const end = Math.max(...withPeak.map((b) => b.peakEndDate!.getTime()));
  const regions = Array.from(new Set(withPeak.map((b) => b.region)));
  return { start, end, regions };
}

// ─────────────────────────────────────────────────────────────
// DAY LABELS — one label per local calendar day covered by the chart,
// centred under that day's span on the axis (clipped to the chart's edges
// for a partial first/last day).
// ─────────────────────────────────────────────────────────────
type DaySegment = { start: number; end: number };

function computeDaySegments(minTime: number, maxTime: number): DaySegment[] {
  const segments: DaySegment[] = [];
  const first = new Date(minTime);
  let dayStart = new Date(
    first.getFullYear(),
    first.getMonth(),
    first.getDate(),
    0,
    0,
    0,
    0,
  ).getTime();
  for (let i = 0; i < 31; i++) {
    const d = new Date(dayStart);
    const dayEnd = new Date(
      d.getFullYear(),
      d.getMonth(),
      d.getDate() + 1,
      0,
      0,
      0,
      0,
    ).getTime();
    const segStart = Math.max(dayStart, minTime);
    const segEnd = Math.min(dayEnd, maxTime);
    if (segEnd > segStart) segments.push({ start: segStart, end: segEnd });
    if (dayEnd >= maxTime) break;
    dayStart = dayEnd;
  }
  return segments;
}

export function sortBarsGeographically(bars: GanttBar[]): GanttBar[] {
  const tagged = bars.map((b, i) => ({
    bar: b,
    geoIndex: getBarPosition(b),
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

function computeLayout(
  data: GanttChart,
  chartWidth: number,
  options: GanttRenderOptions,
) {
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
  const daySegments = options.showDayLabels
    ? computeDaySegments(minTime, maxTime)
    : [];
  const peakBand = options.showPeakRainfall
    ? computePeakBand(barsParsed)
    : null;
  // Reserve a row above the chart for the peak-rainfall band's label, only
  // when there's actually a band to label.
  const peakLabelReserve = peakBand ? 34 : 0;

  const marginLeft = 28;
  const marginRight = 28;
  const marginTop = 8 + peakLabelReserve;
  const marginBottom = 32 + (options.showDayLabels ? 18 : 0);
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
    daySegments,
    peakBand,
    peakLabelReserve,
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
  options: GanttRenderOptions,
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
    midnights,
    daySegments,
    peakBand,
    peakLabelReserve,
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

  // Peak rainfall band — drawn first (behind the gridlines/bars) so bars
  // stay fully opaque and legible; the band only shows through in the
  // whitespace around them, plus the reserved label strip above the chart.
  if (options.showPeakRainfall && peakBand) {
    const bx1 = timeToX(peakBand.start);
    const bx2 = timeToX(peakBand.end);
    const bandTop = plotTop - peakLabelReserve + 4;
    const bandBottom = plotTop + layout.chartAreaHeight;
    ctx.fillStyle = 'rgba(192, 132, 252, 0.22)';
    ctx.fillRect(bx1, bandTop, Math.max(bx2 - bx1, 2), bandBottom - bandTop);

    ctx.fillStyle = '#581c87';
    ctx.font = `bold 11px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const cx = (bx1 + bx2) / 2;
    const regionsLabel =
      peakBand.regions.length > 1 ? 'Multiple Regions' : peakBand.regions[0];
    ctx.fillText('Peak Rainfall Intensity Period -', cx, bandTop + 3);
    ctx.fillText(regionsLabel, cx, bandTop + 16);
  }

  // 3-hour gridlines
  tickTimes.forEach((t) => {
    const x = timeToX(t);
    ctx.strokeStyle = '#e0e0e0';
    ctx.lineWidth = 0.5;
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(x, plotTop);
    ctx.lineTo(x, plotTop + layout.chartAreaHeight);
    ctx.stroke();
  });

  // 00:00 markers — a distinct dashed black line at each local midnight,
  // layered on top of the regular 3-hour gridlines so the day boundary
  // reads clearly even when it falls on a tick that would otherwise just
  // look like any other 3-hour gridline.
  if (options.showMidnightMarkers) {
    midnights.forEach((t) => {
      const x = timeToX(t);
      ctx.strokeStyle = '#000000';
      ctx.lineWidth = 1.25;
      ctx.setLineDash([5, 3]);
      ctx.beginPath();
      ctx.moveTo(x, plotTop);
      ctx.lineTo(x, axisY);
      ctx.stroke();
      ctx.setLineDash([]);
    });
  }

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

  // day labels — one per local calendar day covered, centred under that
  // day's span (clipped at the chart edges for a partial first/last day)
  if (options.showDayLabels) {
    ctx.font = `bold 11px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillStyle = '#000000';
    daySegments.forEach((seg) => {
      const cx = timeToX((seg.start + seg.end) / 2);
      const label = new Date((seg.start + seg.end) / 2).toLocaleDateString(
        'en-NZ',
        { weekday: 'short', day: 'numeric', month: 'short' },
      );
      ctx.fillText(label, cx, axisY + 22);
    });
  }

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
      STYLES[bar.hazard_type]?.[
        styleSeverity as keyof (typeof STYLES)['rain']
      ] || STYLES.rain.watch;

    ctx.fillStyle = style.fill;
    ctx.fillRect(x1, y, w, barHeight);

    const bw = 2.5;
    ctx.strokeStyle = style.border;
    ctx.lineWidth = bw;
    ctx.setLineDash('dashed' in style && style.dashed ? [6, 4] : []);
    ctx.strokeRect(x1 + bw / 2, y + bw / 2, w - bw, barHeight - bw);
    ctx.setLineDash([]);

    if (
      options.showPeakRainfall &&
      bar.hazard_type === 'rain' &&
      bar.peakStartDate &&
      bar.peakEndDate
    ) {
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

  // legend — drawn last so it sits on top of everything else, matching the
  // reference chart's overlaid box; entries are dynamic (see buildLegendEntries)
  if (options.showLegend) {
    const entries = buildLegendEntries(
      barsParsed,
      options.showPeakRainfall && !!peakBand,
    );
    drawLegend(ctx, plotRight, plotTop - peakLabelReserve, entries);
  }
}

// ─────────────────────────────────────────────────────────────
// EXPORT — render at arbitrary DPI
// ─────────────────────────────────────────────────────────────
export function downloadGanttPng(
  data: GanttChart,
  targetDPI: number,
  options: GanttRenderOptions = DEFAULT_GANTT_RENDER_OPTIONS,
) {
  const scale = targetDPI / 96;
  const chartWidth = 1400;
  const layout = computeLayout(data, chartWidth, options);
  const chartHeight = layout.totalHeight;

  const offscreen = document.createElement('canvas');
  offscreen.width = Math.round(chartWidth * scale);
  offscreen.height = Math.round(chartHeight * scale);
  const ctx = offscreen.getContext('2d');
  if (!ctx) return;
  ctx.scale(scale, scale);
  drawGantt(ctx, chartWidth, chartHeight, layout, options);

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
  options?: GanttRenderOptions;
};

export function GanttCanvas({
  data,
  width = 1400,
  options = DEFAULT_GANTT_RENDER_OPTIONS,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !data || data.bars.length === 0) return;

    const DPR = 2;
    const layout = computeLayout(data, width, options);
    const chartHeight = layout.totalHeight;

    canvas.width = width * DPR;
    canvas.height = chartHeight * DPR;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${chartHeight}px`;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(DPR, DPR);
    drawGantt(ctx, width, chartHeight, layout, options);
  }, [data, width, options]);

  if (!data || data.bars.length === 0) {
    return (
      <div className="flex items-center justify-center min-h-[200px] text-gray-400 text-sm border border-dashed border-gray-300 rounded">
        No bars to render
      </div>
    );
  }

  return <canvas ref={canvasRef} className="rounded border border-gray-200" />;
}