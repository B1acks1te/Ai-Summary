// ------------------------------------------------------------------
// Deterministic heading classification for Gantt chart extraction.
//
// Every bug this file exists to eliminate had the same shape: the AI was
// composing the "(severity hazardtype)" portion of a bar's label itself —
// deciding whether to include a colour word, whether "Heavy"/"Strong"
// belongs, how thunderstorm's no-colour exception works, how "road
// snowfall" differs from "snow" — and that composition drifted between
// runs on the exact same input. None of that is actually a judgement call:
// a MetService heading line like "Heavy Rain Warning - Orange" maps to
// hazard_type "rain" / severity "orange_warning" by a FIXED set of rules,
// every time, for every document. So, same pattern as dateAnchor.ts: the
// AI's only job is to COPY the heading line verbatim (heading_text on
// GanttBarExtractionSchema) — a low-error copy task, not a classification
// task — and this module does the classification deterministically from
// that copy. The AI's own hazard_type/severity fields are kept only as a
// fallback for the rare heading this parser doesn't recognise.
// ------------------------------------------------------------------

export const HAZARD_TYPES = [
  'rain',
  'wind',
  'snow',
  'road_snow',
  'thunderstorm',
] as const;
export type HazardType = (typeof HAZARD_TYPES)[number];

export const SEVERITIES = [
  'red_warning',
  'orange_warning',
  'warning',
  'watch',
] as const;
export type Severity = (typeof SEVERITIES)[number];

export interface ParsedHeading {
  hazardType: HazardType;
  severity: Severity;
}

/**
 * The plain hazard noun as it belongs in a label — never the heading's own
 * intensity adjective ("Heavy"/"Strong"), never abbreviated.
 */
export function hazardWordFor(hazardType: HazardType): string {
  switch (hazardType) {
    case 'rain':
      return 'rain';
    case 'wind':
      return 'wind';
    case 'snow':
      return 'snow';
    case 'road_snow':
      return 'road snowfall';
    case 'thunderstorm':
      return 'severe thunderstorm';
  }
}

/**
 * Parses a MetService alert heading line (e.g. "Heavy Rain Warning -
 * Orange", "Heavy Rain Watch", "Road Snowfall Warning", "Severe
 * Thunderstorm Watch") into hazard_type + severity. Returns null for a
 * heading this parser doesn't recognise — callers should fall back to the
 * AI's own hazard_type/severity fields in that case, and log it, since it
 * means a new heading shape has shown up that this function needs
 * extending for.
 */
export function parseHeading(headingText: string): ParsedHeading | null {
  const text = headingText.trim();
  const lower = text.toLowerCase();

  const isWatch = /\bwatch\b/i.test(text);
  const isWarning = /\bwarning\b/i.test(text);
  if (!isWatch && !isWarning) return null;

  let hazardType: HazardType;
  let colourLocked: Severity | null = null;

  if (/severe\s+thunderstorm/i.test(lower)) {
    hazardType = 'thunderstorm';
  } else if (/road\s+snowfall/i.test(lower)) {
    hazardType = 'road_snow';
    // Never observed with an explicit colour in MetService's own output —
    // always plain "warning" severity, same rule as ganttPrompt.ts states.
    colourLocked = 'warning';
  } else if (/heavy\s+snow/i.test(lower)) {
    hazardType = 'snow';
  } else if (/heavy\s+rain/i.test(lower)) {
    hazardType = 'rain';
  } else if (/strong\s+wind/i.test(lower)) {
    hazardType = 'wind';
  } else {
    return null;
  }

  let severity: Severity;
  if (colourLocked) {
    severity = colourLocked;
  } else if (isWatch) {
    // A watch heading can carry a trailing colour word in MetService's own
    // text (e.g. "Heavy Rain Watch - Yellow"), but "watch" is the only
    // severity value watches ever take — the colour word is never surfaced
    // as red_warning/orange_warning, those only apply to warnings.
    severity = 'watch';
  } else if (/-\s*red\b/i.test(text)) {
    severity = 'red_warning';
  } else if (/-\s*orange\b/i.test(text)) {
    severity = 'orange_warning';
  } else {
    severity = 'warning';
  }

  return { hazardType, severity };
}

/**
 * Builds the lowercase "(severity hazardtype)" label suffix — WITHOUT the
 * enclosing parentheses, e.g. "orange rain warning", "rain watch", "road
 * snowfall warning", "severe thunderstorm warning" (thunderstorm NEVER
 * carries a colour word, even when severity is red_warning/orange_warning —
 * that's MetService's own naming convention, not a bug).
 */
export function buildSeverityHazardLabel(
  hazardType: HazardType,
  severity: Severity,
): string {
  const hazardWord = hazardWordFor(hazardType);
  const kind = severity === 'watch' ? 'watch' : 'warning';

  if (hazardType === 'thunderstorm') {
    return `${hazardWord} ${kind}`;
  }

  const colourWord =
    severity === 'red_warning'
      ? 'red '
      : severity === 'orange_warning'
        ? 'orange '
        : '';
  return `${colourWord}${hazardWord} ${kind}`;
}