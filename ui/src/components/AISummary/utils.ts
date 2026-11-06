import type { IssuedAlert } from '@/types/alert';
import type { DateTime } from 'luxon';
import type { SevereThunderstormLevel } from '../warnings-and-watches-indicators/severe-thunderstorm';

export function formatAreasList(areas: string[]): string {
  const filtered = areas.filter(Boolean).map((area) => {
    if (/^From/i.test(area)) {
      area = `areas ${area.replace(/^From\s+/, 'from')}`;
    }
    return area.trim();
  });
  if (filtered.length === 0) return '';
  if (filtered.length === 1) return filtered[0];

  const last = filtered[filtered.length - 1];
  let beforeLast = filtered.slice(0, -1).join(', ');

  // If the last area already contains 'and', just use comma
  if (last.toLowerCase().startsWith('and')) {
    return `${beforeLast}, ${last}`;
  }

  // Otherwise, add 'and' before the last area
  return `${beforeLast} and ${last}`;
}

export function groupAlerts(alerts: IssuedAlert[]): IssuedAlert[][] {
  const grouped: IssuedAlert[][] = [];

  for (const alert of alerts) {
    const lastGroup = grouped[grouped.length - 1];
    if (grouped.length > 0 && lastGroup[0].headline === alert.headline) {
      lastGroup.push(alert);
    } else {
      grouped.push([alert]);
    }
  }

  return grouped;
}

export function formatAlertDuration(from?: DateTime, to?: DateTime): string {
  let duration = '';
  const isSameDay = from && to && to.hasSame(from, 'day');

  if (from) {
    if (isSameDay) {
      duration += `, from ${from.toFormat('HHmm')}hrs`;
    } else {
      duration += `, from ${from.toFormat('HHmm')}hrs on ${from.toFormat('cccc')}`;
    }
  }

  if (to) {
    if (isSameDay) {
      duration += ` until ${to.toFormat('HHmm')}hrs today`;
    } else {
      duration += ` until ${to.toFormat('HHmm')}hrs on ${to.toFormat('cccc')}`;
    }
  }

  return duration;
}

export const COLOR_CODE_MAP: { [key: string]: SevereThunderstormLevel } = {
  yellow: 'watch',
  orange: 'warning',
  red: 'red warning',
};

const getProgressDesc = (openAICalls: number) => [
  'Get reference data (1/2)...',
  'Get reference data (2/2)...',
  ...Array.from(
    { length: openAICalls },
    (_, i) => `Generating summary (${i + 1}/${openAICalls})...`,
  ),
];

export function getProgressUpdater(openAICalls: number) {
  let index = 0;
  const descs = getProgressDesc(openAICalls);
  return () => {
    if (index < descs.length) {
      return {
        desc: descs[index++],
        value: (index / descs.length) * 100,
      };
    }
  };
}

export function getThunderstormOutlookDate(header: string): string {
  // => e.g. 26 Jan 2026
  // const header = thunderstormOutlookItem.header; // e.g., "Valid from midnight Sun, 25 Jan to noon Mon, 26 Jan"
  const dateRegex =
    /\b\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b/gi;
  const matches = header.match(dateRegex);
  if (matches && matches.length > 0) {
    return matches[matches.length - 1]; // Return the last matched date
  } else {
    console.error('No date found in thunderstorm outlook header:', header);
    return '';
  }
}

// add and to last item in when array
export function formatDuration(when: string[]): string {
  if (when.length === 0) return '';
  if (when.length === 1) return when[0];
  const last = when[when.length - 1];
  const beforeLast = when.slice(0, -1).join(', ');
  return `${beforeLast} and ${last}`;
}

// ------------------------------------------------------------------
// Thunderstorm outlook line wording
//
// Each AI summary line is built here — one place — so the text on screen
// and the text the copy button copies can never drift apart.
// ------------------------------------------------------------------

// A "when" phrase that already starts with its own lead-in word — "until
// late evening", "this afternoon", "overnight". These must NOT be wrapped
// in "During the …" ("During the until late evening" was the bug). Note
// "early"/"late" are deliberately NOT in this list: "early morning" and
// "late afternoon" are plain parts of the day and do take "During the".
const SELF_CONTAINED_WHEN =
  /^(until|till|by|from|after|before|through|throughout|into|during|this|tonight|today|overnight|all day|later|in|on|over|around|about)\b/i;

/**
 * The time lead-in for a thunderstorm line, WITHOUT its trailing comma:
 *   ["afternoon", "evening"]       -> "During the afternoon and evening"
 *   ["until late evening"]         -> "Until late evening"
 *   ["overnight"]                  -> "Overnight"
 *   []                             -> ""   (caller drops the lead-in)
 * "until"/"from"/"by" keep their meaning rather than being turned into
 * "during" — "until late evening" and "during the evening" differ.
 */
export function formatOutlookLeadIn(when: string[]): string {
  const phrase = formatDuration(when.map((w) => w.trim()).filter(Boolean));
  if (!phrase) return '';
  if (/^the\b/i.test(phrase)) return `During ${phrase}`;
  if (SELF_CONTAINED_WHEN.test(phrase)) {
    return phrase.charAt(0).toUpperCase() + phrase.slice(1);
  }
  return `During the ${phrase}`;
}

/**
 * Whether a thunderstorm item is the risk of SEVERE thunderstorms.
 *
 * Trusts the AI's explicit `severe: true`. Summaries stored before that
 * field existed (and any where the model left it out) fall back to the
 * item's own verbatim quotes: severe only when they talk about "risk of
 * severe thunderstorms" and never about a plain "risk of thunderstorms".
 * That is deliberately conservative — a quote that spans both sentences
 * is left as an ordinary item (today's wording) rather than risk
 * mislabelling an ordinary item as severe.
 */
export function isSevereOutlook(outlook: {
  severe?: boolean;
  quotes: string[];
}): boolean {
  if (outlook.severe === true) return true;
  const quoted = outlook.quotes.join(' ');
  return (
    /\brisk of severe thunderstorms?\b/i.test(quoted) &&
    !/\brisk of thunderstorms?\b/i.test(quoted)
  );
}

export type OutlookSentence = {
  // Everything before the (underlined) risk word, including its article.
  before: string;
  // Lower-case risk word, e.g. "moderate".
  risk: string;
  // Everything after the risk word, including the final full stop.
  after: string;
};

/**
 * The three pieces of one thunderstorm line, e.g.
 *   before "Until early evening, there is a "
 *   risk   "moderate"
 *   after  " risk of severe thunderstorms for Auckland and Bay of Plenty."
 * The component renders `risk` underlined between the other two, and the
 * copy button copies the three joined back together.
 */
export function buildOutlookSentence(outlook: {
  risk: string;
  areas: string[];
  when: string[];
  severe?: boolean;
  quotes: string[];
}): OutlookSentence {
  const leadIn = formatOutlookLeadIn(outlook.when);
  const areas = formatAreasList(outlook.areas);
  const hazard = isSevereOutlook(outlook)
    ? 'severe thunderstorms'
    : 'thunderstorms';
  return {
    before: leadIn ? `${leadIn}, there is a ` : 'There is a ',
    risk: outlook.risk.toLowerCase(),
    after: ` risk of ${hazard}${areas ? ` for ${areas}` : ''}.`,
  };
}

// return the latest date, if one of the date is undefined, return null
export function getLatestDate(dates: (Date | undefined)[]): Date | null {
  if (dates.includes(undefined)) return null;
  if (dates.length === 0) return null;
  let latest: Date | null = null;
  for (const date of dates) {
    if (date) {
      if (latest === null || date > latest) {
        latest = date;
      }
    }
  }
  return latest;
}

export function isOneDigitDay(dateStr: string) {
  return /\b\d\s\w{3}\b/.test(dateStr);
}
