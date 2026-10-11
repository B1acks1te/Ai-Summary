import { z } from 'zod';
import { DAY_ABBREVIATIONS } from './dateAnchor';
import { HAZARD_TYPES, SEVERITIES } from './headingParser';

// heavy rain, strong wind, or heavy snow (https://about.metservice.com/about-severe-weather-warnings#types)
const WATCHES = z.enum([
  'Heavy Rain Watch',
  'Strong Wind Watch',
  'Heavy Snow Watch',
]);

const WARNINGS = z.enum([
  'Heavy Rain Warning',
  'Strong Wind Warning',
  'Heavy Snow Warning',
]);

const IssuredWatcheOrWarning = z.object({
  issuredWatch: WATCHES,
  issuredWarning: WARNINGS,
  issuedRedWarning: z.string(),
  areas: z.array(z.string()),
  quotes: z.array(z.string()).min(1),
  keywords: z.array(z.string()),
});

export const ChanceLevelEnum = z.enum(['Minimal', 'Low', 'Moderate', 'High']);

const UpgradeChanceEventSchema = z.object({
  upgradeTo: WATCHES.or(WARNINGS).or(z.literal('Red Warning')),
  chance: ChanceLevelEnum,
  areas: z.array(z.string()),
  quotes: z.array(z.string()).min(1),
  keywords: z.array(z.string()),
});

export const SevereWeatherAISummarySchema = z.object({
  minimalRisk: z.boolean(),
  IssuredWatcheOrWarnings: z.array(IssuredWatcheOrWarning),
  chanceOfUpgrade: z.array(UpgradeChanceEventSchema),
});

export type SevereWeatherAISummary = z.infer<typeof UpgradeChanceEventSchema>[];

export type SevereWeatherOutlookAISummary = z.infer<
  typeof UpgradeChanceEventSchema
>[];

// Thunderstorm
export const OutlookSchema = z.object({
  risk: z.enum(['Minimal', 'Low', 'Moderate', 'High']),
  areas: z.array(z.string()),
  when: z.array(z.string()),
  quotes: z.array(z.string()).min(1),
  keywords: z.array(z.string()),
});

export const ThunderstormAISummarySchema = z.object({
  outlooks: z.array(OutlookSchema),
});

export type ThunderstormAISummary = z.infer<typeof ThunderstormAISummarySchema>;

// ------------------------------------------------------------
// Gantt — used by the new gantt feature
// ------------------------------------------------------------
export const GanttHazardTypeEnum = z.enum(HAZARD_TYPES);
export const GanttSeverityEnum = z.enum(SEVERITIES);

const GanttDayAbbrevEnum = z.enum(DAY_ABBREVIATIONS);

// This is the schema the AI's tool-use output is validated against — it
// carries extra fields that exist ONLY to let ai-generate.service.ts
// deterministically recompute things afterwards rather than trust the AI's
// own composition of them: start_day/end_day/peak_start_day/peak_end_day
// for dates (see dateAnchor.ts), and qualifier/heading_text for the final
// label text (see headingParser.ts). None of these extraction-only fields
// leave main-services — the public GanttBar/GanttChart types below (used by
// the UI, the snapshot repository, everywhere else) don't have them; this
// schema's `label` field doesn't exist at all, because the AI no longer
// composes it — it's built deterministically in ai-generate.service.ts from
// region + qualifier + a severity/hazard suffix computed by headingParser.ts.
const GanttBarExtractionSchema = z.object({
  // Bare region/area name ONLY — no positional qualifier, no severity text.
  // Keep any fused name-modifying word (e.g. "Inland Canterbury", not
  // "Canterbury") but never a qualifier like "north of Lake Sumner" here —
  // that belongs in `qualifier` below. See ganttPrompt.ts's NAMING RULES.
  region: z.string(),
  // Positional qualifier ONLY, with no surrounding parentheses (e.g. "north
  // of Lake Sumner", "south of Westport", "not including hill country north
  // of Lumsden above 400 metres") — omit entirely when the area has none.
  // Never fold this into `region`, and never drop it when the source has
  // one, however long it is.
  qualifier: z.string().optional(),
  // The exact heading line this bar's "Area:" block sits under, copied
  // VERBATIM from the source — e.g. "Heavy Rain Warning - Orange", "Heavy
  // Rain Watch", "Road Snowfall Warning", "Severe Thunderstorm Watch". This
  // is a COPY task, not a classification task: headingParser.ts
  // deterministically derives hazard_type/severity/the label's colour and
  // hazard wording from this string afterwards, which is what actually
  // guarantees the label is correct — do not paraphrase or abbreviate it.
  // A later "Area:" block that sits under the SAME heading as an earlier
  // one (no new heading line in between) copies that SAME heading text.
  heading_text: z.string(),
  // Fallback only — used ONLY when headingParser.ts can't recognise
  // heading_text (an unfamiliar heading shape). Follow the same hazard/
  // severity rules described throughout this prompt for these.
  hazard_type: GanttHazardTypeEnum,
  severity: GanttSeverityEnum,
  // AI's best-effort full ISO datetime — TRUSTED ONLY for its HH:MM time
  // portion. The DATE portion is recomputed deterministically afterwards
  // from start_day/end_day + the source's "Issued:" anchor date; see
  // ganttPrompt.ts's CRITICAL DATE HANDLING section for why the AI's own
  // date arithmetic isn't trusted on its own. ISO 8601 WITHOUT timezone
  // suffix: YYYY-MM-DDTHH:MM
  start: z.string(),
  end: z.string(),
  // The day-of-week abbreviation AS WRITTEN IN THE SOURCE TEXT for the
  // start and end of this bar's period (e.g. "Thu", "Fri") — copied
  // verbatim / normalised to this 3-letter form, NEVER computed. This is
  // what the deterministic date correction actually anchors on.
  start_day: GanttDayAbbrevEnum,
  end_day: GanttDayAbbrevEnum,
  peak_start: z.string().optional(),
  peak_end: z.string().optional(),
  // Same verbatim day-of-week-abbreviation treatment as start_day/end_day,
  // but for the peak window — only present when peak_start/peak_end are.
  peak_start_day: GanttDayAbbrevEnum.optional(),
  peak_end_day: GanttDayAbbrevEnum.optional(),
  // Approximate latitude of the centre of the location (negative in NZ). Used
  // by the UI to slot locations that aren't in its known list into the right
  // north-to-south position. Optional so a missing value never fails the whole
  // chart.
  latitude: z
    .number()
    .optional()
    .describe(
      'Approximate decimal latitude of the centre of the location, negative for NZ (e.g. Wellington -41.29, Lewis Pass -42.38, Stewart Island -47.0). For a road or pass use the midpoint of the named road.',
    ),
});

export const GanttChartSchema = z.object({
  chart_title: z.string(),
  bars: z.array(GanttBarExtractionSchema),
  notes: z.array(z.string()),
});

// Raw AI tool-use output — day-name and label-composition fields included.
// Used only inside ai-generate.service.ts, before date correction and label
// assembly.
export type GanttBarExtraction = z.infer<typeof GanttBarExtractionSchema>;
export type GanttChartExtraction = z.infer<typeof GanttChartSchema>;

// Public shape — identical to the pre-existing contract — used by
// everything downstream: the UI, snapshot storage, etc. Strips the
// extraction-only fields (day names, qualifier, heading_text) and adds back
// `label` as a field ai-generate.service.ts computes deterministically,
// rather than one the AI composed itself.
export type GanttBar = Omit<
  GanttBarExtraction,
  | 'start_day'
  | 'end_day'
  | 'peak_start_day'
  | 'peak_end_day'
  | 'qualifier'
  | 'heading_text'
> & { label: string };
export type GanttChart = Omit<GanttChartExtraction, 'bars'> & {
  bars: GanttBar[];
};