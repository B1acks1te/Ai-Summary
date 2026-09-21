// Thin wrapper around Umami's custom-event API (window.umami.track).
//
// Safe to call from anywhere: it does nothing on the server, when the tracking
// script isn't on the page (local development, or the UMAMI_* settings aren't
// set for this environment), or when a browser extension has blocked it.
// Analytics must never be able to break the app, so everything is wrapped.
//
// Event data is deliberately limited to short labels (which panel, which
// option) - never pasted text, alert content, or anything personal.

type EventData = Record<string, string | number | boolean>;

declare global {
  interface Window {
    umami?: {
      track: (event: string, data?: EventData) => void;
    };
  }
}

export function trackEvent(name: string, data?: EventData): void {
  try {
    if (typeof window === 'undefined') return;
    window.umami?.track(name, data);
  } catch {
    // ignore - analytics is best-effort
  }
}
