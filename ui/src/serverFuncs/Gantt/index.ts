import { createServerFn } from '@tanstack/react-start';
import axios from 'axios';
import type { GanttChart, GanttSnapshot } from '@/types/gantt';

type GanttResponse = {
  ok: boolean;
  chart?: GanttChart;
  sourceText?: string;
  // true when the alerts feed is genuinely empty (nothing in force) — not an
  // error, so there is no chart to draw
  noActiveAlerts?: boolean;
  error?: string;
};

export const generateGanttFromInput = createServerFn()
  .inputValidator((data: { input: string }) => data)
  .handler(async ({ data }): Promise<GanttResponse> => {
    try {
      const resp = await axios.post<GanttResponse>(
        `${process.env.MAIN_SERVICES_URL!}/generate-gantt`,
        { input: data.input },
      );
      return resp.data;
    } catch (error) {
      console.error('generateGanttFromInput error:', error);
      return { ok: false, error: `${error}` };
    }
  });

export const generateGanttFromLatest = createServerFn().handler(
  async (): Promise<GanttResponse> => {
    try {
      const resp = await axios.post<GanttResponse>(
        `${process.env.MAIN_SERVICES_URL!}/generate-gantt-from-latest`,
        {},
      );
      return resp.data;
    } catch (error) {
      console.error('generateGanttFromLatest error:', error);
      return { ok: false, error: `${error}` };
    }
  },
);

type SnapshotsResponse = {
  ok: boolean;
  snapshots?: GanttSnapshot[];
  // true when nothing is currently in force (the newest snapshot is then stale)
  noActiveAlerts?: boolean;
  error?: string;
};

// The last up-to-5 auto-captured Gantt snapshots, newest first. Captured
// automatically server-side whenever issued alerts change — nothing here
// triggers a new generation, this only reads what's already stored.
export const getGanttSnapshots = createServerFn().handler(
  async (): Promise<SnapshotsResponse> => {
    try {
      const resp = await axios.get<SnapshotsResponse>(
        `${process.env.MAIN_SERVICES_URL!}/gantt-snapshots`,
      );
      return resp.data;
    } catch (error) {
      console.error('getGanttSnapshots error:', error);
      return { ok: false, error: `${error}` };
    }
  },
);