import { createServerFn } from '@tanstack/react-start';
import axios from 'axios';

export const NOTICE_LEVELS = ['info', 'warning', 'critical'] as const;
export type NoticeLevel = (typeof NOTICE_LEVELS)[number];

export type NoticeItem = {
  id: string;
  message: string;
  level: NoticeLevel;
  startAt: string | null;
  endAt: string | null;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

type CurrentResponse = {
  ok: boolean;
  notice?: NoticeItem | null;
  error?: string;
};
type ListResponse = { ok: boolean; items?: NoticeItem[]; error?: string };
type WriteResponse = { ok: boolean; notice?: NoticeItem; error?: string };

// Public — no admin key. Both pages call this to decide whether to show a
// banner, and again whenever a NOTICE_UPDATED realtime event arrives.
export const getCurrentNotice = createServerFn({ method: 'GET' }).handler(
  async (): Promise<CurrentResponse> => {
    try {
      const resp = await axios.get<CurrentResponse>(
        `${process.env.MAIN_SERVICES_URL!}/notice/current`,
        { timeout: 10000 },
      );
      return resp.data;
    } catch (error) {
      console.error('getCurrentNotice error:', error);
      // Fail quiet: if this is down, showing no banner is the right default.
      return { ok: false, notice: null };
    }
  },
);

export const listNotices = createServerFn({ method: 'POST' })
  .inputValidator((data: { adminKey: string }) => data)
  .handler(async ({ data }): Promise<ListResponse> => {
    try {
      const resp = await axios.get<ListResponse>(
        `${process.env.MAIN_SERVICES_URL!}/notice`,
        { headers: { 'x-admin-key': data.adminKey }, timeout: 15000 },
      );
      return resp.data;
    } catch (error) {
      console.error('listNotices error:', error);
      return { ok: false, error: 'Could not reach the notice service.' };
    }
  });

export const createNotice = createServerFn({ method: 'POST' })
  .inputValidator(
    (data: {
      adminKey: string;
      message: string;
      level: NoticeLevel;
      startAt: string | null;
      endAt: string | null;
    }) => data,
  )
  .handler(async ({ data }): Promise<WriteResponse> => {
    try {
      const resp = await axios.post<WriteResponse>(
        `${process.env.MAIN_SERVICES_URL!}/notice`,
        {
          message: data.message,
          level: data.level,
          startAt: data.startAt,
          endAt: data.endAt,
        },
        { headers: { 'x-admin-key': data.adminKey }, timeout: 15000 },
      );
      return resp.data;
    } catch (error) {
      console.error('createNotice error:', error);
      return { ok: false, error: 'Could not reach the notice service.' };
    }
  });

export const updateNotice = createServerFn({ method: 'POST' })
  .inputValidator(
    (data: {
      adminKey: string;
      id: string;
      message?: string;
      level?: NoticeLevel;
      startAt?: string | null;
      endAt?: string | null;
      enabled?: boolean;
    }) => data,
  )
  .handler(async ({ data }): Promise<WriteResponse> => {
    try {
      const { adminKey, id, ...patch } = data;
      const resp = await axios.patch<WriteResponse>(
        `${process.env.MAIN_SERVICES_URL!}/notice/${encodeURIComponent(id)}`,
        patch,
        { headers: { 'x-admin-key': adminKey }, timeout: 15000 },
      );
      return resp.data;
    } catch (error) {
      console.error('updateNotice error:', error);
      return { ok: false, error: 'Could not reach the notice service.' };
    }
  });
