// ------------------------------------------------------------------
// Deterministic north-to-south ordering for free-text "areas" arrays.
//
// severeWeatherPropmt.ts and thunderstormPropmt.ts both ask the model to
// sort each item's "areas" array north to south (same reference list used
// in ganttPrompt.ts's GEOGRAPHIC ORDERING section). In practice the model
// does NOT reliably follow that instruction — regenerating the same
// outlook repeatedly still produces jumbled orderings (e.g. "Canterbury,
// Wairarapa and Tararua District" instead of "Wairarapa, Tararua District
// and Canterbury"). This mirrors exactly the problem headingParser.ts and
// dateAnchor.ts already solved for the Gantt pipeline: free-text ordering/
// composition is not something to trust the model's own output for when a
// fixed rule can resolve it deterministically in code instead.
//
// sortAreasNorthToSouth re-sorts an "areas" array after extraction, using
// substring matching against REGION_ORDER — so the model's job stays a
// low-error extraction task (which places were mentioned) rather than a
// judgement/ordering task (what order to list them in).
// ------------------------------------------------------------------

// North to south — identical list to ganttPrompt.ts's GEOGRAPHIC ORDERING,
// kept in natural geographic sequence (not sorted by string length — see
// regionOrderIndex below for how longer/more-specific names like
// "Marlborough Sounds" are still preferred over "Marlborough" when both
// could match).
export const REGION_ORDER = [
  'Northland',
  'Great Barrier Island',
  'Auckland',
  'Coromandel Peninsula',
  'Waikato',
  'Bay of Plenty',
  'Taupo',
  'Taumarunui',
  'Gisborne',
  "Hawke's Bay",
  'Taranaki',
  'Taranaki Maunga',
  'Taihape',
  'Whanganui',
  'Manawatu',
  'Horowhenua',
  'Kapiti Coast',
  'Porirua',
  'Wellington',
  'Hutt Valley',
  'Wairarapa',
  'Kaweka Ranges',
  'Ruahine Ranges',
  'Tararua Range',
  'Tararua District',
  'Buller',
  'Grey',
  'Nelson',
  'Tasman',
  'Motueka',
  'Richmond Ranges',
  'Marlborough',
  'Marlborough Sounds',
  'Kaikoura',
  'Westland',
  'Canterbury',
  'Timaru',
  'Otago',
  // Dunedin (~-45.87) and Clutha (~-46.23) are real, distinct districts
  // within/adjoining Otago that the severe weather and thunderstorm
  // outlooks name directly (see ganttPrompt.ts's own "Coastal Dunedin and
  // Clutha" worked example) — not in the original Gantt reference list,
  // but they need their own slot here or they fall through to the -1
  // "unmatched" bucket and get shoved to the end regardless of where they
  // actually sit. Ordered by latitude: Otago (Dunedin) north of Clutha
  // north of Southland.
  'Dunedin',
  'Clutha',
  'Southland',
  'Fiordland',
  'Stewart Island',
] as const;

/**
 * Finds the best-matching REGION_ORDER index for a free-text area string
 * (e.g. "southern Fiordland", "most of Otago", "eastern Marlborough",
 * "Canterbury foothills and high country"). Matching is substring-based
 * and case-insensitive, preferring the LONGEST matching region name so
 * "Marlborough Sounds" is chosen over the shorter "Marlborough" when an
 * area string actually says "Marlborough Sounds", while "eastern
 * Marlborough" (which doesn't contain "Sounds") still correctly matches
 * plain "Marlborough".
 *
 * Returns -1 when no known region name is found anywhere in the string —
 * callers should place these at the end, keeping their original relative
 * order, rather than guessing a position.
 */
function regionOrderIndex(area: string): number {
  const lower = area.toLowerCase();
  let bestIndex = -1;
  let bestLength = -1;
  REGION_ORDER.forEach((region, idx) => {
    const r = region.toLowerCase();
    if (lower.includes(r) && r.length > bestLength) {
      bestIndex = idx;
      bestLength = r.length;
    }
  });
  return bestIndex;
}

/**
 * Re-sorts an "areas" array north to south, deterministically, rather than
 * trusting the model's own ordering. Stable: areas resolving to the same
 * region (or that don't match any known region) keep their original
 * relative order among themselves. Unmatched areas are placed after every
 * matched area.
 */
export function sortAreasNorthToSouth(areas: string[]): string[] {
  return areas
    .map((area, originalIndex) => ({
      area,
      originalIndex,
      order: regionOrderIndex(area),
    }))
    .sort((a, b) => {
      if (a.order === -1 && b.order === -1) {
        return a.originalIndex - b.originalIndex;
      }
      if (a.order === -1) return 1;
      if (b.order === -1) return -1;
      if (a.order !== b.order) return a.order - b.order;
      return a.originalIndex - b.originalIndex;
    })
    .map((x) => x.area);
}