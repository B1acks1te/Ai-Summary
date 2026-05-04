import { createServerFn } from '@tanstack/react-start';
import axios from 'axios';
import type { GanttChart } from '@/types/gantt';

type GanttResponse = {
  ok: boolean;
  chart?: GanttChart;
  sourceText?: string;
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
