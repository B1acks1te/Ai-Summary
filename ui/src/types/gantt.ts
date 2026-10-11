export type GanttHazardType =
  | 'rain'
  | 'wind'
  | 'snow'
  | 'road_snow'
  | 'thunderstorm';
export type GanttSeverity =
  | 'red_warning'
  | 'orange_warning'
  | 'warning'
  | 'watch';

export type GanttBar = {
  region: string;
  hazard_type: GanttHazardType;
  severity: GanttSeverity;
  label: string;
  start: string; // ISO 8601 without timezone (treated as NZ local)
  end: string;
  peak_start?: string;
  peak_end?: string;
  // Approximate latitude of the location's centre (negative in NZ), supplied
  // by the AI. Only used to place locations that aren't in the known
  // north-to-south list. Optional: older snapshots and hand-added bars won't
  // have it.
  latitude?: number;
};

export type GanttChart = {
  chart_title: string;
  bars: GanttBar[];
  notes: string[];
};

// An auto-captured historical Gantt chart (see the "Auto-captured" section
// on the Gantt page). insertedAt is an ISO string over the wire.
export type GanttSnapshot = GanttChart & {
  id: string;
  insertedAt: string;
};

// Display toggles for GanttCanvas (see the "Display options" control on the
// Gantt page). Each one is independent and purely cosmetic — none of them
// change the underlying chart data, filtering, or PNG export resolution.
export type GanttRenderOptions = {
  showLegend: boolean;
  showPeakRainfall: boolean;
  showDayLabels: boolean;
  showMidnightMarkers: boolean;
};

// Matches the reference chart supplied by MetService/ops: every display
// option on by default.
export const DEFAULT_GANTT_RENDER_OPTIONS: GanttRenderOptions = {
  showLegend: true,
  showPeakRainfall: true,
  showDayLabels: true,
  showMidnightMarkers: true,
};