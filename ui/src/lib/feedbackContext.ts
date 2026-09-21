// A tiny registry that lets a page tell the Feedback form what is on screen
// (e.g. which Gantt chart is showing), so a bug report arrives with useful
// context without the person having to describe it.
//
// Keep values short and non-sensitive: labels and counts only, never pasted
// text or alert content.

type ContextValue = string | number | boolean;

let current: Record<string, ContextValue> = {};

// Pass undefined to remove a key.
export function setFeedbackContext(
  patch: Record<string, ContextValue | undefined>,
): void {
  const next = { ...current };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined || value === '') {
      delete next[key];
    } else {
      next[key] = value;
    }
  }
  current = next;
}

export function getFeedbackContext(): Record<string, ContextValue> {
  return { ...current };
}
