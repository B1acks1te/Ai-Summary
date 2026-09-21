import { createFileRoute } from '@tanstack/react-router';

// Health check for uptime monitoring and Docker. Reports that the UI is
// serving, and whether it can reach main-services and, through it, MongoDB.
// 200 when everything is fine, 503 when anything is not.
export const Route = createFileRoute('/api/health')({
  server: {
    handlers: {
      GET: async () => {
        let backend: 'up' | 'down' = 'down';
        let db: 'up' | 'down' | 'unknown' = 'unknown';
        try {
          const resp = await fetch(`${process.env.MAIN_SERVICES_URL}/health`, {
            signal: AbortSignal.timeout(4000),
          });
          backend = 'up'; // it answered
          db = resp.ok ? 'up' : 'down';
        } catch {
          backend = 'down';
        }
        const ok = backend === 'up' && db === 'up';
        return Response.json(
          { ok, ui: 'up', backend, db },
          {
            status: ok ? 200 : 503,
            headers: { 'Cache-Control': 'no-store' },
          },
        );
      },
    },
  },
});
