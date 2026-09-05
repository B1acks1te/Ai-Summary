export type GanttHazardType = 'rain' | 'wind' | 'snow' | 'road_snow';
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
};

export type GanttChart = {
  chart_title: string;
  bars: GanttBar[];
  notes: string[];
};
