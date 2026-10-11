// ------------------------------------------------------------------
// Deterministic date-anchoring for Gantt chart extraction.
//
// The AI extraction prompt (ganttPrompt.ts) is reliable at two simple,
// low-risk tasks: copying a day-of-week abbreviation verbatim out of the
// source text, and reading a time of day (e.g. "6:00am"). It is much less
// reliable at a third task — doing the actual calendar arithmetic to turn
// "Thu" into a specific YYYY-MM-DD, especially many paragraphs into a long
// MetService bulletin, where it can drift a day forward from wherever it
// last computed a date instead of re-anchoring to the source's one real
// calendar fact.
//
// So the AI's own date arithmetic is never trusted for the DATE portion of
// a bar's start/end. The AI only needs to supply the day-of-week
// abbreviation it saw in the source (start_day / end_day on GanttBarSchema)
// plus its best-effort ISO start/end (used only for the HH:MM time
// portion). This module resolves the actual calendar dates deterministically
// in code, anchored to the one real calendar date present anywhere in a
// MetService bulletin: the "Issued:" line.
// ------------------------------------------------------------------

export const DAY_ABBREVIATIONS = [
  'Sun',
  'Mon',
  'Tue',
  'Wed',
  'Thu',
  'Fri',
  'Sat',
] as const;

export type DayAbbrev = (typeof DAY_ABBREVIATIONS)[number];

const MONTHS: Record<string, number> = {
  jan: 0,
  january: 0,
  feb: 1,
  february: 1,
  mar: 2,
  march: 2,
  apr: 3,
  april: 3,
  may: 4,
  jun: 5,
  june: 5,
  jul: 6,
  july: 6,
  aug: 7,
  august: 7,
  sep: 8,
  sept: 8,
  september: 8,
  oct: 9,
  october: 9,
  nov: 10,
  november: 10,
  dec: 11,
  december: 11,
};

export function isDayAbbrev(value: string): value is DayAbbrev {
  return (DAY_ABBREVIATIONS as readonly string[]).includes(value);
}

/**
 * Finds the "Issued:" line in a MetService bulletin (e.g.
 * "Issued: 9:41am Tue 24 March") and returns the calendar date it names, at
 * local midnight. This is the single reference date every day-of-week
 * abbreviation in the document ("Thu", "Fri", etc.) is resolved against.
 *
 * Returns null if no "Issued:" line is found — callers should fall back to
 * trusting the AI's own best-effort date in that case rather than failing
 * the whole chart.
 */
export function parseIssuedAnchorDate(
  input: string,
  now: Date = new Date(),
): Date | null {
  const match = input.match(
    /Issued:\s*\d{1,2}:\d{2}\s*[ap]m\s+(Sun|Mon|Tue|Wed|Thu|Fri|Sat)\s+(\d{1,2})\s+([A-Za-z]+)(?:\s+(\d{4}))?/i,
  );
  if (!match) return null;

  const [, , dayOfMonthStr, monthName, yearStr] = match;
  const month = MONTHS[monthName.toLowerCase()];
  if (month === undefined) return null;

  const dayOfMonth = parseInt(dayOfMonthStr, 10);
  // A MetService bulletin never states a year in practice, so default to
  // the current calendar year — matching the prompt's own "current year is
  // 2026 unless stated otherwise" instruction.
  const year = yearStr ? parseInt(yearStr, 10) : now.getFullYear();

  return new Date(year, month, dayOfMonth, 0, 0, 0, 0);
}

/**
 * The next calendar date (at local midnight) on or after `from` whose
 * weekday matches `day`. `from` itself counts as a match if its weekday is
 * already `day` — this is what makes a day name equal to the anchor's own
 * weekday resolve to the anchor date itself rather than jumping a week
 * ahead, and what makes chaining end-off-start (see resolveBarPeriod) work.
 */
export function nextOccurrenceOnOrAfter(day: DayAbbrev, from: Date): Date {
  const targetIndex = DAY_ABBREVIATIONS.indexOf(day);
  const fromMidnight = new Date(
    from.getFullYear(),
    from.getMonth(),
    from.getDate(),
    0,
    0,
    0,
    0,
  );
  const diff = (targetIndex - fromMidnight.getDay() + 7) % 7;
  fromMidnight.setDate(fromMidnight.getDate() + diff);
  return fromMidnight;
}

/** Extracts the "HH:MM" portion of a "YYYY-MM-DDTHH:MM"-shaped string. */
export function extractTimeOfDay(isoLike: string): string {
  const match = isoLike.match(/T(\d{2}:\d{2})/);
  return match ? match[1] : '00:00';
}

/**
 * Formats a date (ignoring any time it carries) plus an "HH:MM" time into
 * the "YYYY-MM-DDTHH:MM" format the rest of the Gantt pipeline expects.
 */
export function combineDateAndTime(date: Date, time: string): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}T${time}`;
}

/**
 * Resolves a bar's start/end to deterministic ISO strings. `end` is
 * resolved relative to the just-computed `start` date — not the original
 * anchor — so a period that wraps into a new week (e.g. start "Fri", end
 * "Mon") still correctly lands end >= start, however many weeks out the
 * anchor date now is.
 */
export function resolveBarPeriod(
  anchorDate: Date,
  startDay: DayAbbrev,
  startIso: string,
  endDay: DayAbbrev,
  endIso: string,
): { start: string; end: string; startDate: Date; endDate: Date } {
  const startDate = nextOccurrenceOnOrAfter(startDay, anchorDate);
  const endDate = nextOccurrenceOnOrAfter(endDay, startDate);
  return {
    start: combineDateAndTime(startDate, extractTimeOfDay(startIso)),
    end: combineDateAndTime(endDate, extractTimeOfDay(endIso)),
    startDate,
    endDate,
  };
}

/**
 * Same idea as resolveBarPeriod, but for a bar's optional peak window —
 * seeded from the bar's own already-resolved start date (a peak window is
 * always within or immediately adjacent to its bar's period, not anchored
 * to the document's "Issued:" date directly).
 */
export function resolvePeakPeriod(
  barStartDate: Date,
  peakStartDay: DayAbbrev,
  peakStartIso: string,
  peakEndDay: DayAbbrev,
  peakEndIso: string,
): { peak_start: string; peak_end: string } {
  const peakStartDate = nextOccurrenceOnOrAfter(peakStartDay, barStartDate);
  const peakEndDate = nextOccurrenceOnOrAfter(peakEndDay, peakStartDate);
  return {
    peak_start: combineDateAndTime(
      peakStartDate,
      extractTimeOfDay(peakStartIso),
    ),
    peak_end: combineDateAndTime(peakEndDate, extractTimeOfDay(peakEndIso)),
  };
}